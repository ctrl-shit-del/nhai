import { CLAHEPreprocessor, ImageFrame } from '../ml/CLAHEPreprocessor';
import { FaceEngine } from '../ml/FaceEngine';
import { LivenessDetector } from '../ml/LivenessDetector';
import { EmbeddingStore } from '../security/EmbeddingStore';
import { MerkleChain } from '../security/MerkleChain';
import { GuardStorage } from '../storage/GuardStorage';
import { SyncEngine } from '../sync/SyncEngine';
import { AttendanceOutcome, EnrollmentSession, GPSPoint, GUARDConfig, LivenessChallenge, SyncAck, SyncBatch, WorkerProfile } from '../types';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { ChainAuditScreen } from '../screens/ChainAuditScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { EnrollmentScreen } from '../screens/EnrollmentScreen';
import { SyncScreen } from '../screens/SyncScreen';

export class GUARDEngine {
  readonly preprocessor = new CLAHEPreprocessor();
  readonly faceEngine = new FaceEngine();
  readonly livenessDetector = new LivenessDetector();
  readonly embeddingStore = new EmbeddingStore();
  readonly merkleChain: MerkleChain;
  readonly syncEngine: SyncEngine;

  readonly AttendanceScreen = AttendanceScreen;
  readonly EnrollmentScreen = EnrollmentScreen;
  readonly ChainAuditScreen = ChainAuditScreen;
  readonly SyncScreen = SyncScreen;
  readonly DashboardScreen = DashboardScreen;

  private ready = false;

  constructor(
    readonly config: GUARDConfig,
    private readonly storage?: GuardStorage
  ) {
    this.merkleChain = new MerkleChain(config.siteId, config.deviceId);
    this.syncEngine = new SyncEngine(config, this.merkleChain);
  }

  async initialize(): Promise<void> {
    const snapshot = await this.storage?.loadChain();
    if (snapshot) {
      this.merkleChain.hydrate(snapshot.attendanceRecords, snapshot.spoofIncidents);
    }

    await Promise.all([
      this.faceEngine.initialize(),
      this.embeddingStore.initialize(this.config.deviceId)
    ]);
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  beginEnrollmentSession(supervisorId: string): EnrollmentSession {
    this.assertReady();
    const livenessSession = this.livenessDetector.createSession(`supervisor:${supervisorId}:${Date.now()}`);

    return {
      id: `enroll_${supervisorId}_${Date.now()}`,
      supervisorId,
      livenessSession,
      authorized: !this.config.requireSupervisorLivenessForEnrollment,
      startedAt: Date.now()
    };
  }

  completeSupervisorLiveness(session: EnrollmentSession, completed: LivenessChallenge[], frame: ImageFrame): Promise<EnrollmentSession> {
    this.assertReady();
    const active = this.livenessDetector.evaluateActive(session.livenessSession, completed);

    return this.livenessDetector.evaluatePassive(active, this.preprocessor.preprocess(frame)).then((livenessSession) => ({
      ...session,
      livenessSession,
      authorized: this.livenessDetector.isComplete(livenessSession)
    }));
  }

  async enrollWorker(profile: WorkerProfile, samples: ImageFrame[], enrollmentSession?: EnrollmentSession): Promise<void> {
    this.assertReady();
    if (this.config.requireSupervisorLivenessForEnrollment && !enrollmentSession?.authorized) {
      throw new Error('Supervisor liveness authorization is required before enrollment.');
    }

    if (samples.length < 3) {
      throw new Error('Enrollment requires three accepted face samples.');
    }

    const embeddings: number[][] = [];

    for (const sample of samples.slice(0, 3)) {
      const frame = this.preprocessor.preprocess(sample);
      const face = this.faceEngine.detectFace(frame);
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

  async markAttendance(frame: ImageFrame, gps: GPSPoint): Promise<AttendanceOutcome> {
    this.assertReady();
    const processed = this.preprocessor.preprocess(frame);
    const face = this.faceEngine.detectFace(processed);
    const quality = this.faceEngine.assessQuality(face);
    if (!face || !quality.accepted) {
      throw new Error(`Face quality rejected: ${quality.reasons.join(',') || 'UNKNOWN'}`);
    }

    let liveness = this.livenessDetector.createSession();
    liveness = this.livenessDetector.evaluateActive(liveness, liveness.challenges);
    liveness = await this.livenessDetector.evaluatePassive(liveness, processed);

    if (!this.livenessDetector.isComplete(liveness)) {
      this.merkleChain.appendSpoofIncident({
        siteId: this.config.siteId,
        deviceId: this.config.deviceId,
        timestamp: Date.now(),
        livenessSessionId: liveness.id,
        spoofScore: liveness.spoofScore
      });
      await this.persistChain();
      return {
        status: 'REVIEW_REQUIRED',
        livenessSession: liveness,
        reason: liveness.timedOut ? 'LIVENESS_TIMEOUT' : 'LIVENESS_FAILED'
      };
    }

    const embedding = await this.faceEngine.generateEmbedding(processed, face);
    const recognition = this.faceEngine.match(embedding, this.config.recognitionThreshold);
    if (!recognition) {
      throw new Error('No enrolled worker matched recognition threshold.');
    }

    if (recognition.tier === 'LOW' && !this.config.allowLowConfidenceCommit) {
      return {
        status: 'REVIEW_REQUIRED',
        recognition,
        livenessSession: liveness,
        reason: 'LOW_CONFIDENCE_MATCH'
      };
    }

    const record = this.merkleChain.appendAttendance({
      siteId: this.config.siteId,
      deviceId: this.config.deviceId,
      recognition,
      livenessSessionId: liveness.id,
      gps
    });
    await this.persistChain();

    return {
      status: record.reviewRequired ? 'REVIEW_REQUIRED' : 'COMMITTED',
      record,
      recognition,
      livenessSession: liveness
    };
  }

  getStats() {
    return {
      isReady: this.ready,
      chainLength: this.merkleChain.getLength(),
      enrolledWorkers: this.faceEngine.getEnrollmentCount(),
      unsyncedRecords: this.merkleChain.getUnsyncedAttendance().length,
      integrity: this.merkleChain.verifyIntegrity()
    };
  }

  async syncPending(sendBatch: (batch: SyncBatch) => Promise<SyncAck>): Promise<{ synced: number; purged: number }> {
    this.assertReady();
    const result = await this.syncEngine.sync(sendBatch);
    await this.persistChain();
    return result;
  }

  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
      throw new Error('At least one enrollment sample is required.');
    }

    return embeddings[0].map((_, index) => {
      const sum = embeddings.reduce((total, embedding) => total + embedding[index], 0);
      return sum / embeddings.length;
    });
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new Error('GUARDEngine must be initialized before use.');
    }
  }

  private async persistChain(): Promise<void> {
    await this.storage?.saveChain({
      attendanceRecords: this.merkleChain.getAttendanceRecords(),
      spoofIncidents: this.merkleChain.getSpoofIncidents()
    });
  }
}
