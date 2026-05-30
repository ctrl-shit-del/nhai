import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Platform } from 'react-native';
import { MODEL_PATHS } from './constants';
import { CLAHEPreprocessor, ImageFrame } from '../ml/CLAHEPreprocessor';
import { FaceEngine } from '../ml/FaceEngine';
import { LivenessDetector } from '../ml/LivenessDetector';
import { EmbeddingStore } from '../security/EmbeddingStore';
import { MerkleChain } from '../security/MerkleChain';
import { GuardStorage } from '../storage/GuardStorage';
import { SyncEngine } from '../sync/SyncEngine';
import { isInsideSiteGeofence } from '../utils/GPSHelper';
import { cropAndNormalize } from '../utils/imageUtils';
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
} from '../types';

// ── MiniFAS model specs ───────────────────────────────────────────────────────
// Input:  Float32Array  [80 × 80 × 3] normalised [0, 1] (face crop)
// Output: Float32Array  [2]           [spoof_prob, real_prob]
const MINIFAS_INPUT_SIZE = 80;

/** Loaded TFLite model instances exposed to screens for frame-processor use. */
export interface GUARDModels {
  blazeface:      TensorflowModel | null;
  mobilefacenet:  TensorflowModel | null;
  minifas:        TensorflowModel | null;
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
  readonly preprocessor      = new CLAHEPreprocessor();
  readonly faceEngine        = new FaceEngine();
  readonly livenessDetector  = new LivenessDetector();
  readonly embeddingStore    = new EmbeddingStore();
  readonly merkleChain:       MerkleChain;
  readonly syncEngine:        SyncEngine;

  /** TFLite model instances. Null until initialize() completes. */
  models: GUARDModels = { blazeface: null, mobilefacenet: null, minifas: null };

  private ready = false;

  constructor(
    readonly config: GUARDConfig,
    private readonly storage?: GuardStorage
  ) {
    this.merkleChain = new MerkleChain(config.siteId, config.deviceId);
    this.syncEngine  = new SyncEngine(config, this.merkleChain);
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Hydrate Merkle chain from persistent storage (survives app restarts)
    const snapshot = await this.storage?.loadChain();
    if (snapshot) {
      this.merkleChain.hydrate(snapshot.attendanceRecords, snapshot.spoofIncidents);
    }

    // Parallel init: face engine + embedding store + TFLite models
    await Promise.all([
      this.faceEngine.initialize(),
      this.embeddingStore.initialize(this.config.deviceId),
      this.loadModels(),
    ]);

    this.ready = true;
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
    const prefix = Platform.OS === 'android' ? 'asset:///' : '';

    const [blazefaceResult, mobilefacenetResult, minifasResult] = await Promise.allSettled([
      loadTensorflowModel({ url: `${prefix}${MODEL_PATHS.blazeface}` }),
      loadTensorflowModel({ url: `${prefix}${MODEL_PATHS.mobileFaceNet}` }),
      loadTensorflowModel({ url: `${prefix}${MODEL_PATHS.miniFas}` }),
    ]);

    const getModel = (result: PromiseSettledResult<TensorflowModel>, name: string): TensorflowModel | null => {
      if (result.status === 'fulfilled') return result.value;
      console.warn(`[GUARDEngine] ${name} model failed to load — mock inference active.`, result.reason);
      return null;
    };

    this.models = {
      blazeface:     getModel(blazefaceResult,      'BlazeFace'),
      mobilefacenet: getModel(mobilefacenetResult,  'MobileFaceNet'),
      minifas:       getModel(minifasResult,         'MiniFAS'),
    };

    // Inject models into subsystems that need them
    this.faceEngine.setModels(this.models.blazeface, this.models.mobilefacenet);
  }

  isReady(): boolean { return this.ready; }

  // ── Enrollment ─────────────────────────────────────────────────────────────

  beginEnrollmentSession(supervisorId: string): EnrollmentSession {
    this.assertReady();
    const livenessSession = this.livenessDetector.createSession(`supervisor:${supervisorId}:${Date.now()}`);
    return {
      id:             `enroll_${supervisorId}_${Date.now()}`,
      supervisorId,
      livenessSession,
      authorized:     !this.config.requireSupervisorLivenessForEnrollment,
      startedAt:      Date.now(),
    };
  }

  completeSupervisorLiveness(
    session: EnrollmentSession,
    completed: LivenessChallenge[],
    frame: ImageFrame
  ): Promise<EnrollmentSession> {
    this.assertReady();
    const active = this.livenessDetector.evaluateActive(session.livenessSession, completed);
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
    enrollmentSession?: EnrollmentSession
  ): Promise<void> {
    this.assertReady();
    if (this.config.requireSupervisorLivenessForEnrollment && !enrollmentSession?.authorized) {
      throw new Error('Supervisor liveness authorization is required before enrollment.');
    }
    if (samples.length < 3) {
      throw new Error('Enrollment requires three accepted face samples.');
    }

    const embeddings: number[][] = [];

    for (const sample of samples.slice(0, 3)) {
      const frame   = this.preprocessor.preprocess(sample);
      const face    = await this.faceEngine.detectFace(frame);
      const quality = this.faceEngine.assessQuality(face);
      if (!face || !quality.accepted) {
        throw new Error(`Enrollment sample rejected: ${quality.reasons.join(',') || 'UNKNOWN'}`);
      }
      embeddings.push(await this.faceEngine.generateEmbedding(frame, face));
    }

    const averaged = this.averageEmbeddings(embeddings);
    await this.embeddingStore.save(profile, averaged);
    this.faceEngine.enroll(profile, averaged);
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
    activeLivenessSession?: LivenessSession
  ): Promise<AttendanceOutcome> {
    this.assertReady();

    // ── 1. GPS Geofence check ──────────────────────────────────────────────
    if (this.config.siteLocation && !isInsideSiteGeofence(gps, this.config.siteLocation)) {
      const session = activeLivenessSession ?? this.livenessDetector.createSession();
      return { status: 'REVIEW_REQUIRED', reason: 'OUTSIDE_GEOFENCE', livenessSession: session };
    }

    // ── 2. CLAHE preprocessing ────────────────────────────────────────────
    const processed = this.preprocessor.preprocess(frame);

    // ── 3. Face detection + quality gate ──────────────────────────────────
    const face    = await this.faceEngine.detectFace(processed);
    const quality = this.faceEngine.assessQuality(face);
    if (!face || !quality.accepted) {
      throw new Error(`Face quality rejected: ${quality.reasons.join(',') || 'UNKNOWN'}`);
    }

    // ── 4. Liveness check ─────────────────────────────────────────────────
    let liveness: LivenessSession;

    if (activeLivenessSession) {
      // Active check already confirmed by screen — only run passive here
      liveness = await this.evaluatePassiveLiveness(activeLivenessSession, processed, face);
    } else {
      // Self-contained path: auto-complete active challenges, then run passive
      let session = this.livenessDetector.createSession();
      session     = this.livenessDetector.evaluateActive(session, session.challenges);
      liveness    = await this.evaluatePassiveLiveness(session, processed, face);
    }

    if (!this.livenessDetector.isComplete(liveness)) {
      this.merkleChain.appendSpoofIncident({
        siteId:            this.config.siteId,
        deviceId:          this.config.deviceId,
        timestamp:         Date.now(),
        livenessSessionId: liveness.id,
        spoofScore:        liveness.spoofScore,
      });
      await this.persistChain();
      return {
        status:          'REVIEW_REQUIRED',
        livenessSession: liveness,
        reason:          liveness.timedOut ? 'LIVENESS_TIMEOUT' : 'LIVENESS_FAILED',
      };
    }

    // ── 5. Face embedding + recognition ───────────────────────────────────
    const embedding  = await this.faceEngine.generateEmbedding(processed, face);
    const recognition = this.faceEngine.match(embedding, this.config.recognitionThreshold);
    if (!recognition) {
      throw new Error('No enrolled worker matched recognition threshold.');
    }

    if (recognition.tier === 'LOW' && !this.config.allowLowConfidenceCommit) {
      return { status: 'REVIEW_REQUIRED', recognition, livenessSession: liveness, reason: 'LOW_CONFIDENCE_MATCH' };
    }

    // ── 6. Merkle-chain append ─────────────────────────────────────────────
    const record = this.merkleChain.appendAttendance({
      siteId:            this.config.siteId,
      deviceId:          this.config.deviceId,
      recognition,
      livenessSessionId: liveness.id,
      gps,
    });
    await this.persistChain();

    return {
      status:          record.reviewRequired ? 'REVIEW_REQUIRED' : 'COMMITTED',
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
    face: FaceRegion
  ): Promise<LivenessSession> {
    if (this.models.minifas) {
      try {
        // Crop detected face to 80×80, normalise to [0, 1] for MiniFAS
        const input  = cropAndNormalize(frame, face, MINIFAS_INPUT_SIZE, 0, 1);
        const output = await this.models.minifas.run([input]);
        const scores = output[0] as Float32Array;
        // scores = [real_prob, print_prob, replay_prob]
        const spoofScore = scores.length >= 1 ? 1.0 - scores[0] : 1.0;
        return this.livenessDetector.evaluatePassiveFromScore(session, spoofScore);
      } catch (minifasError) {
        console.warn('[GUARDEngine] MiniFAS inference error — falling back to heuristic.', minifasError);
      }
    }
    // Development fallback: pixel-level luminance/variance heuristic
    return this.livenessDetector.evaluatePassive(session, frame);
  }

  // ── Stats & Sync ──────────────────────────────────────────────────────────

  getStats() {
    return {
      isReady:         this.ready,
      chainLength:     this.merkleChain.getLength(),
      enrolledWorkers: this.faceEngine.getEnrollmentCount(),
      unsyncedRecords: this.merkleChain.getUnsyncedAttendance().length,
      integrity:       this.merkleChain.verifyIntegrity(),
      modelsLoaded: {
        blazeface:     this.models.blazeface !== null,
        mobilefacenet: this.models.mobilefacenet !== null,
        minifas:       this.models.minifas !== null,
      },
    };
  }

  async syncPending(sendBatch: (batch: SyncBatch) => Promise<SyncAck>): Promise<{ synced: number; purged: number }> {
    this.assertReady();
    const result = await this.syncEngine.sync(sendBatch);
    await this.persistChain();
    return result;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) throw new Error('At least one enrollment sample is required.');
    return embeddings[0].map((_, index) => {
      const sum = embeddings.reduce((total, embedding) => total + embedding[index], 0);
      return sum / embeddings.length;
    });
  }

  private assertReady(): void {
    if (!this.ready) throw new Error('GUARDEngine must be initialized before use.');
  }

  private async persistChain(): Promise<void> {
    await this.storage?.saveChain({
      attendanceRecords: this.merkleChain.getAttendanceRecords(),
      spoofIncidents:    this.merkleChain.getSpoofIncidents(),
    });
  }
}
