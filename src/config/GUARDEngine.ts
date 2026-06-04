import { loadTensorflowModel, TensorflowModel } from "react-native-fast-tflite";
import { Platform } from "react-native";
import { GUARD_THRESHOLDS, MODEL_PATHS } from "./constants";
import { CLAHEPreprocessor, ImageFrame } from "../ml/CLAHEPreprocessor";
import { FaceEngine } from "../ml/FaceEngine";
import { LivenessDetector } from "../ml/LivenessDetector";
import { EmbeddingStore } from "../security/EmbeddingStore";
import { MerkleChain } from "../security/MerkleChain";
import { GuardStorage } from "../storage/GuardStorage";
import { SyncEngine } from "../sync/SyncEngine";
import { isInsideSiteGeofence } from "../utils/GPSHelper";
import { isGpsValid } from "../utils/locationService";
import { cropAndNormalize } from "../utils/imageUtils";
import { downscaleImageFrame, ML_FRAME_MAX_DIM } from "../utils/frameUtils";
import {
  AttendanceOutcome,
  EnrollmentSession,
  FaceRegion,
  GPSPoint,
  GUARDConfig,
  LivenessChallenge,
  LivenessSession,
  SyncAck,
  SyncBatch,
  WorkerProfile,
} from "../types";

// ── MiniFAS model specs ───────────────────────────────────────────────────────
// Input:  Float32Array  [80 × 80 × 3] normalised [0, 1] (face crop)
// Output: Float32Array  [2]           [spoof_prob, real_prob]
const MINIFAS_INPUT_SIZE = 80;

/** Loaded TFLite model instances exposed to screens for frame-processor use. */
export interface GUARDModels {
  blazeface: TensorflowModel | null;
  mobilefacenet: TensorflowModel | null;
  minifas: TensorflowModel | null;
}

/**
 * GUARDEngine
 *
 * Central facade that wires all GUARD subsystems together and exposes
 * a three-call integration API for Datalake 3.0:
 *
 *   1. `new GUARDEngine(config, storage)`
 *   2. `await guard.initialize()`
 *   3. Mount `guard.AttendanceScreen`, `guard.EnrollmentScreen`, etc.
 */
export class GUARDEngine {
  readonly preprocessor = new CLAHEPreprocessor();
  readonly faceEngine = new FaceEngine();
  readonly livenessDetector = new LivenessDetector();
  readonly embeddingStore = new EmbeddingStore();
  readonly merkleChain: MerkleChain;
  readonly syncEngine: SyncEngine;

  /** TFLite model instances. Null until initialize() completes. */
  models: GUARDModels = { blazeface: null, mobilefacenet: null, minifas: null };

  private ready = false;

  constructor(
    readonly config: GUARDConfig,
    private readonly storage?: GuardStorage,
  ) {
    this.merkleChain = new MerkleChain(config.siteId, config.deviceId);
    this.syncEngine = new SyncEngine(config, this.merkleChain);
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Hydrate Merkle chain from persistent storage (survives app restarts)
    const snapshot = await this.storage?.loadChain();
    if (snapshot) {
      this.merkleChain.hydrate(
        snapshot.attendanceRecords,
        snapshot.spoofIncidents,
      );
    }

    // Parallel init: face engine + embedding store + TFLite models
    await Promise.all([
      this.faceEngine.initialize(),
      this.embeddingStore.initialize(this.config.deviceId),
      this.loadModels(),
    ]);

    // GUARD FIX: Issue 2 — Reload in-memory match index from MMKV after restart
    await this.hydrateFaceEngineFromStore();

    this.ready = true;
    console.log('[GUARDEngine] initialize() complete');
  }

  /** Exposed for screens that mount before navigation splash clears. */
  isEngineReady(): boolean {
    return this.ready;
  }

  /**
   * GUARD FIX: Issue 2 — Populate FaceEngine.enrolled[] from persisted records.
   * Uses matchingEmbedding when present; falls back to transformedEmbedding for legacy rows.
   */
  private async hydrateFaceEngineFromStore(): Promise<void> {
    const storedRecords = await this.embeddingStore.list();
    let hydrated = 0;

    for (const record of storedRecords) {
      const usingLegacy =
        !record.matchingEmbedding || record.matchingEmbedding.length === 0;
      const embedding = usingLegacy
        ? record.transformedEmbedding
        : record.matchingEmbedding;

      if (!embedding || embedding.length === 0) {
        console.warn(
          `[GUARDEngine] Skipping worker ${record.workerId} — no embedding data`,
        );
        continue;
      }

      if (usingLegacy) {
        console.warn(
          `[GUARDEngine] Worker ${record.workerName} uses legacy embedding — re-enroll for reliable matching`,
        );
      }

      if (this.faceEngine.hasWorker(record.workerId)) {
        continue;
      }

      const profile: WorkerProfile = {
        workerId: record.workerId,
        workerName: record.workerName,
        phone: record.phone,
        labourContractId: record.labourContractId,
        ppeNotes: record.ppeNotes,
        enrolledAt: record.enrolledAt,
      };

      this.faceEngine.enroll(profile, embedding);
      hydrated += 1;
    }

    console.log(
      `[GUARDEngine] Hydrated ${hydrated} workers into FaceEngine from MMKV (${storedRecords.length} on disk)`,
    );
  }

  /**
   * Loads all three TFLite model files from the native asset bundle.
   *
   * • Android: `android/app/src/main/assets/models/` accessed via `asset:///` URL.
   * • iOS:     models added to the Xcode target are accessed by filename directly.
   *
   * Uses `Promise.allSettled` so a missing model degrades gracefully to mock mode
   * rather than crashing the app. A console warning is emitted for each failure.
   */
  private async loadModels(): Promise<void> {
    const [blazefaceResult, mobilefacenetResult, minifasResult] =
      await Promise.allSettled([
        loadTensorflowModel(
          require("../../android/app/src/main/assets/models/blazeface.tflite"),
        ),
        loadTensorflowModel(
          require("../../android/app/src/main/assets/models/mobilefacenet.tflite"),
        ),
        loadTensorflowModel(
          require("../../android/app/src/main/assets/models/minifas.tflite"),
        ),
      ]);

    const getModel = (
      result: PromiseSettledResult<TensorflowModel>,
      name: string,
    ): TensorflowModel | null => {
      if (result.status === "fulfilled") return result.value;
      console.warn(
        `[GUARDEngine] ${name} model failed to load — mock inference active.`,
        result.reason,
      );
      return null;
    };

    this.models = {
      blazeface: getModel(blazefaceResult, "BlazeFace"),
      mobilefacenet: getModel(mobilefacenetResult, "MobileFaceNet"),
      minifas: getModel(minifasResult, "MiniFAS"),
    };

    // Inject models into subsystems that need them
    this.faceEngine.setModels(this.models.blazeface, this.models.mobilefacenet);
  }

  isReady(): boolean {
    return this.ready;
  }

  private async yieldToUI(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  // ── Enrollment ─────────────────────────────────────────────────────────────

  beginEnrollmentSession(supervisorId: string): EnrollmentSession {
    this.assertReady();
    const livenessSession = this.livenessDetector.createSession(
      `supervisor:${supervisorId}:${Date.now()}`,
    );
    return {
      id: `enroll_${supervisorId}_${Date.now()}`,
      supervisorId,
      livenessSession,
      authorized: !this.config.requireSupervisorLivenessForEnrollment,
      startedAt: Date.now(),
    };
  }

  completeSupervisorLiveness(
    session: EnrollmentSession,
    completed: LivenessChallenge[],
    frame: ImageFrame,
  ): Promise<EnrollmentSession> {
    this.assertReady();
    const active = this.livenessDetector.evaluateActive(
      session.livenessSession,
      completed,
    );
    return this.livenessDetector
      .evaluatePassive(active, this.preprocessor.preprocess(frame))
      .then((livenessSession) => ({
        ...session,
        livenessSession,
        authorized: this.livenessDetector.isComplete(livenessSession),
      }));
  }

  async enrollWorker(
    profile: WorkerProfile,
    samples: ImageFrame[],
    enrollmentSession?: EnrollmentSession,
  ): Promise<void> {
    this.assertReady();
    if (
      this.config.requireSupervisorLivenessForEnrollment &&
      !enrollmentSession?.authorized
    ) {
      throw new Error(
        "Supervisor liveness authorization is required before enrollment.",
      );
    }
    if (samples.length < 3) {
      throw new Error("Enrollment requires three accepted face samples.");
    }

    const embeddings: number[][] = [];

    for (const sample of samples.slice(0, 3)) {
      await yield_();
      const frame = this.prepareRecognitionFrame(sample);
      const face = await this.faceEngine.detectFace(frame);
      const quality = this.faceEngine.assessQuality(face, frame);
      if (!face || !quality.accepted) {
        throw new Error(
          `Enrollment sample rejected: ${quality.reasons.join(",") || "UNKNOWN"}`,
        );
      }
      embeddings.push(await this.faceEngine.generateEmbedding(frame, face));
    }

    const averaged = this.l2NormalizeEmbedding(this.averageEmbeddings(embeddings));

    // Replace stale rows for the same display name (old pipeline embeddings).
    const existing = await this.embeddingStore.list();
    for (const record of existing) {
      if (
        record.workerName.toLowerCase() === profile.workerName.toLowerCase() &&
        record.workerId !== profile.workerId
      ) {
        await this.embeddingStore.delete(record.workerId);
        this.faceEngine.removeWorker(record.workerId);
        console.log(
          `[GUARDEngine] Replaced prior enrollment for ${record.workerName} (${record.workerId})`,
        );
      }
    }

    const selfCheck = this.faceEngine.similarity(embeddings[0], averaged);
    console.log(
      `[GUARDEngine] Enroll self-check: sample1 vs template ${(selfCheck * 100).toFixed(1)}%`,
    );

    await this.embeddingStore.save(profile, averaged);
    this.faceEngine.enroll(profile, averaged);
  }

  async deleteWorker(workerId: string): Promise<void> {
    this.assertReady();
    await this.embeddingStore.delete(workerId);
    this.faceEngine.removeWorker(workerId);
  }

  async clearAllWorkers(): Promise<void> {
    this.assertReady();
    const records = await this.embeddingStore.list();
    for (const record of records) {
      this.faceEngine.removeWorker(record.workerId);
    }
    this.faceEngine.clearAll();
    await this.embeddingStore.clearAll();
    console.log('[GUARDEngine] All workers cleared from device');
  }

  // ── Attendance ─────────────────────────────────────────────────────────────

  /**
   * Runs the full attendance pipeline on a captured camera frame.
   *
   * Pipeline:
   *   CLAHE preprocess → BlazeFace detect → quality gate →
   *   passive liveness (MiniFAS or heuristic) → geofence check →
   *   MobileFaceNet embed → cosine match → Merkle-chain commit
   *
   * @param frame               Raw RGB ImageFrame from the front camera.
   * @param gps                 GPS fix captured at the same moment.
   * @param activeLivenessSession If the screen already ran the active liveness
   *                             challenge (blink/smile), pass the evaluated session
   *                             here and the engine will only run the passive check.
   *                             If omitted, the engine auto-completes active challenges
   *                             (legacy / internal path).
   */
  async markAttendance(
    frame: ImageFrame,
    gps: GPSPoint,
    activeLivenessSession?: LivenessSession,
  ): Promise<AttendanceOutcome> {
    this.assertReady();

    // Extend liveness window — photo + ML pipeline can exceed the UI challenge timer.
    let livenessSession = activeLivenessSession
      ? {
          ...activeLivenessSession,
          expiresAt: Date.now() + GUARD_THRESHOLDS.livenessTimeoutMs,
        }
      : undefined;

    // ── 1. GPS Geofence check (skipped when fix unavailable — PRD allows indoor commit)
    if (
      this.config.siteLocation &&
      isGpsValid(gps) &&
      !isInsideSiteGeofence(gps, this.config.siteLocation)
    ) {
      const session =
        livenessSession ?? this.livenessDetector.createSession();
      return {
        status: "REVIEW_REQUIRED",
        reason: "OUTSIDE_GEOFENCE",
        livenessSession: session,
      };
    }

    // ── 2. Downscale to ML resolution (no CLAHE — keeps enroll/attendance consistent)
    await yield_();
    const processed = this.prepareRecognitionFrame(frame);
    await this.yieldToUI();

    // ── 3. Face detection + quality gate ──────────────────────────────────
    await yield_();
    const face = await this.faceEngine.detectFace(processed);
    const quality = this.faceEngine.assessQuality(face, processed);
    if (!face || !quality.accepted) {
      throw new Error(
        `Face quality rejected: ${quality.reasons.join(",") || "UNKNOWN"}`,
      );
    }

    await this.yieldToUI();

    // ── 4. Liveness check ─────────────────────────────────────────────────
    let liveness: LivenessSession;

    if (livenessSession) {
      // Active check already confirmed by screen — only run passive here
      liveness = await this.evaluatePassiveLiveness(
        livenessSession,
        processed,
        face,
      );
    } else {
      // Self-contained path: auto-complete active challenges, then run passive
      let session = this.livenessDetector.createSession();
      session = this.livenessDetector.evaluateActive(
        session,
        session.challenges,
      );
      liveness = await this.evaluatePassiveLiveness(session, processed, face);
    }

    await this.yieldToUI();

    if (!this.livenessDetector.isComplete(liveness)) {
      this.merkleChain.appendSpoofIncident({
        siteId: this.config.siteId,
        deviceId: this.config.deviceId,
        timestamp: Date.now(),
        livenessSessionId: liveness.id,
        spoofScore: liveness.spoofScore,
      });
      await this.persistChain();
      return {
        status: "REVIEW_REQUIRED",
        livenessSession: liveness,
        reason: liveness.timedOut ? "LIVENESS_TIMEOUT" : "LIVENESS_FAILED",
      };
    }

    // ── 5. Face embedding + recognition ───────────────────────────────────
    await yield_();
    const embedding = await this.faceEngine.generateEmbedding(processed, face);
    console.log(
      `[GUARDEngine] Recognition frame ${processed.width}x${processed.height} ` +
        `face=${face.width}x${face.height}@${face.confidence.toFixed(2)}`,
    );
    const recognition = this.faceEngine.match(
      embedding,
      this.config.recognitionThreshold ??
        (this.config.allowLowConfidenceCommit
          ? 0.55
          : undefined),
    );
    if (!recognition) {
      console.warn(
        `[GUARDEngine] No match — enrolled=${this.faceEngine.getEnrollmentCount()} ` +
          `threshold=${this.config.recognitionThreshold ?? (this.config.allowLowConfidenceCommit ? 0.55 : GUARD_THRESHOLDS.recognition)}`,
      );
      throw new Error("No enrolled worker matched recognition threshold.");
    }

    console.log(
      `[GUARDEngine] Matched ${recognition.workerName} at ${(recognition.confidence * 100).toFixed(1)}% (${recognition.tier})`,
    );

    if (recognition.tier === "LOW" && !this.config.allowLowConfidenceCommit) {
      return {
        status: "REVIEW_REQUIRED",
        recognition,
        livenessSession: liveness,
        reason: "LOW_CONFIDENCE_MATCH",
      };
    }

    // ── 6. Merkle-chain append ─────────────────────────────────────────────
    const record = this.merkleChain.appendAttendance({
      siteId: this.config.siteId,
      deviceId: this.config.deviceId,
      recognition,
      livenessSessionId: liveness.id,
      gps,
    });
    await this.persistChain();

    return {
      status: record.reviewRequired ? "REVIEW_REQUIRED" : "COMMITTED",
      record,
      recognition,
      livenessSession: liveness,
    };
  }

  /**
   * Runs passive liveness using MiniFAS TFLite model when available,
   * or falls back to the pixel-level heuristic in LivenessDetector.
   */
  private async evaluatePassiveLiveness(
    session: LivenessSession,
    frame: ImageFrame,
    face: FaceRegion,
  ): Promise<LivenessSession> {
    if (this._isFlatFrame(frame)) {
      console.log(
        "[GUARDEngine] Mock frame detected — skipping passive liveness.",
      );
      return this.livenessDetector.evaluatePassiveFromScore(session, 0.0);
    }

    let minifasSession: LivenessSession | null = null;

    if (this.models.minifas) {
      try {
        const input = cropAndNormalize(frame, face, MINIFAS_INPUT_SIZE, 0, 1);
        const output = await this.models.minifas.run([input]);
        const scores = output[0] as Float32Array;
        const spoofScore = miniFasSpoofScore(scores);
        const probs = softmaxLogits(scores);
        console.log(
          `[GUARDEngine] MiniFAS raw=[${formatScores(scores)}] ` +
            `probs=[${formatScores(probs)}] spoofScore=${spoofScore.toFixed(3)}`,
        );
        minifasSession = this.livenessDetector.evaluatePassiveFromScore(
          session,
          spoofScore,
        );
        if (minifasSession.passivePassed) return minifasSession;
      } catch (minifasError) {
        console.warn(
          "[GUARDEngine] MiniFAS error — falling back to heuristic.",
          minifasError,
        );
      }
    }

    // GPU preview snapshots often fail MiniFAS even for live faces.
    // After the user completes the active challenge, allow pixel heuristic.
    if (session.activePassed) {
      const heuristic = await this.livenessDetector.evaluatePassive(
        session,
        frame,
      );
      console.log(
        `[GUARDEngine] Passive heuristic spoofScore=${heuristic.spoofScore.toFixed(3)} passed=${heuristic.passivePassed}`,
      );
      if (heuristic.passivePassed) return heuristic;
    }

    return (
      minifasSession ??
      this.livenessDetector.evaluatePassive(session, frame)
    );
  }

  /** Returns true if every pixel in the frame has the same value — mockFrame indicator. */
  private _isFlatFrame(frame: ImageFrame): boolean {
    if (frame.data.length < 10) return true;
    const ref = frame.data[0];
    for (let i = 1; i < Math.min(frame.data.length, 500); i++) {
      if (frame.data[i] !== ref) return false;
    }
    return true;
  }

  // ── Stats & Sync ──────────────────────────────────────────────────────────

  getStats() {
    return {
      isReady: this.ready,
      chainLength: this.merkleChain.getLength(),
      enrolledWorkers: this.faceEngine.getEnrollmentCount(),
      unsyncedRecords: this.merkleChain.getUnsyncedAttendance().length,
      integrity: this.merkleChain.verifyIntegrity(),
      modelsLoaded: {
        blazeface: this.models.blazeface !== null,
        mobilefacenet: this.models.mobilefacenet !== null,
        minifas: this.models.minifas !== null,
      },
    };
  }

  async syncPending(
    sendBatch: (batch: SyncBatch) => Promise<SyncAck>,
  ): Promise<{ synced: number; purged: number }> {
    this.assertReady();
    const result = await this.syncEngine.sync(sendBatch);
    await this.persistChain();
    return result;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Shared downscale path for enrollment + attendance (no CLAHE on embeddings). */
  private prepareRecognitionFrame(frame: ImageFrame): ImageFrame {
    return downscaleImageFrame(frame, ML_FRAME_MAX_DIM);
  }

  private l2NormalizeEmbedding(vector: number[]): number[] {
    const magnitude =
      Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / magnitude);
  }

  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0)
      throw new Error("At least one enrollment sample is required.");
    return embeddings[0].map((_, index) => {
      const sum = embeddings.reduce(
        (total, embedding) => total + embedding[index],
        0,
      );
      return sum / embeddings.length;
    });
  }

  private assertReady(): void {
    if (!this.ready)
      throw new Error("GUARDEngine must be initialized before use.");
  }

  private async persistChain(): Promise<void> {
    await this.storage?.saveChain({
      attendanceRecords: this.merkleChain.getAttendanceRecords(),
      spoofIncidents: this.merkleChain.getSpoofIncidents(),
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Yield to the JS event loop so the UI thread stays responsive. */
const yield_ = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function formatScores(scores: Float32Array): string {
  return Array.from(scores.slice(0, 4))
    .map((v) => v.toFixed(3))
    .join(", ");
}

function softmaxLogits(logits: Float32Array): Float32Array {
  const values = Array.from(logits);
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return new Float32Array(exps.map((e) => e / sum));
}

/**
 * MiniFAS outputs raw logits (not probabilities).
 * 3-class: [fake, replay/print, live] — live is the last index.
 * 2-class: [spoof, real].
 */
function miniFasSpoofScore(scores: Float32Array): number {
  const probs = softmaxLogits(scores);

  if (probs.length >= 3) {
    const realProb = probs[probs.length - 1];
    return Math.max(0, Math.min(1, 1.0 - realProb));
  }
  if (probs.length >= 2) {
    return Math.max(0, Math.min(1, probs[0]));
  }
  return Math.max(0, Math.min(1, 1.0 - probs[0]));
}