import type { GUARDEngine } from '../config/GUARDEngine';

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export type LivenessChallenge = 'BLINK' | 'SMILE' | 'HEAD_LEFT' | 'HEAD_RIGHT';

export interface SiteLocation {
  /** WGS-84 latitude of the site centroid. */
  lat: number;
  /** WGS-84 longitude of the site centroid. */
  lng: number;
  /** Geofence radius in metres (default: GUARD_THRESHOLDS.gpsSiteRadiusM = 500). */
  radiusM?: number;
}

export interface GUARDConfig {
  siteId: string;
  deviceId: string;
  datalakeAuthToken: string;
  syncEndpoint?: string;
  recognitionThreshold?: number;
  requireSupervisorLivenessForEnrollment?: boolean;
  allowLowConfidenceCommit?: boolean;
  /**
   * Optional site geofence. When set, attendance commits are rejected with
   * OUTSIDE_GEOFENCE if the GPS fix is more than radiusM metres from this point.
   */
  siteLocation?: SiteLocation;
}

export interface GUARDEngineProps {
  engine: GUARDEngine;
}

export interface GPSPoint {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: number;
}

export interface FaceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface FaceQuality {
  score: number;
  accepted: boolean;
  reasons: string[];
}

export interface RecognitionResult {
  workerId: string;
  workerName: string;
  confidence: number;
  tier: ConfidenceTier;
  embeddingHash: string;
}

export interface LivenessSession {
  id: string;
  challenges: LivenessChallenge[];
  startedAt: number;
  expiresAt: number;
  activePassed: boolean;
  passivePassed: boolean;
  spoofScore: number;
  timedOut: boolean;
  completedAt?: number;
}

export interface WorkerProfile {
  workerId: string;
  workerName: string;
  phone?: string;
  labourContractId?: string;
  ppeNotes?: string;
  enrolledAt: number;
}

export interface AttendanceRecord {
  recordId: string;
  workerId: string;
  workerName: string;
  siteId: string;
  embeddingHash: string;
  livenessSessionId: string;
  recognitionConfidence: number;
  confidenceTier: ConfidenceTier;
  reviewRequired: boolean;
  timestamp: number;
  gpsLat: number;
  gpsLng: number;
  gpsAccuracyM: number;
  chainIndex: number;
  previousHash: string;
  chainHash: string;
  deviceId: string;
  syncedAt?: number;
}

export interface SpoofIncidentRecord {
  incidentId: string;
  siteId: string;
  deviceId: string;
  timestamp: number;
  livenessSessionId: string;
  spoofScore: number;
  previousHash: string;
  chainHash: string;
  chainIndex: number;
}

export interface ChainIntegrityReport {
  valid: boolean;
  checkedRecords: number;
  genesisHash: string;
  tailHash: string;
  firstBrokenIndex?: number;
  reason?: string;
}

export interface SyncBatch {
  batchId: string;
  siteId: string;
  deviceId: string;
  chainTailHash: string;
  checksum: string;
  deviceSignature: string;
  recordCount: number;
  integrityReport: ChainIntegrityReport;
  createdAt: number;
  records: AttendanceRecord[];
}

export interface SyncAck {
  status: 'COMMITTED';
  batchId: string;
  recordCount: number;
  serverAck: string;
  committedAt: number;
}

export interface EnrollmentSession {
  id: string;
  supervisorId: string;
  livenessSession: LivenessSession;
  authorized: boolean;
  startedAt: number;
}

export type AttendanceStatus = 'COMMITTED' | 'REVIEW_REQUIRED';

export interface AttendanceOutcome {
  status: AttendanceStatus;
  record?: AttendanceRecord;
  recognition?: RecognitionResult;
  livenessSession: LivenessSession;
  reason?: string;
}
