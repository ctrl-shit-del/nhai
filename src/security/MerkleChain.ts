import { EMPTY_CHAIN_HASH } from '../config/constants';
import { AttendanceRecord, ChainIntegrityReport, GPSPoint, RecognitionResult, SpoofIncidentRecord } from '../types';
import { sha256Placeholder } from '../utils/hash';

export interface AppendAttendanceInput {
  siteId: string;
  deviceId: string;
  recognition: RecognitionResult;
  livenessSessionId: string;
  gps: GPSPoint;
  timestamp?: number;
}

export class MerkleChain {
  private attendanceRecords: AttendanceRecord[] = [];
  private incidents: SpoofIncidentRecord[] = [];
  private readonly genesisHash: string;

  constructor(siteId: string, deviceId: string) {
    this.genesisHash = sha256Placeholder({
      type: 'GUARD_GENESIS',
      siteId,
      deviceId,
      empty: EMPTY_CHAIN_HASH
    });
  }

  appendAttendance(input: AppendAttendanceInput): AttendanceRecord {
    const previousHash = this.getTailHash();
    const chainIndex = this.attendanceRecords.length + this.incidents.length;
    const timestamp = input.timestamp ?? Date.now();
    const recordId = `${input.siteId}_${input.deviceId}_${chainIndex}_${timestamp}`;
    const unsigned = {
      recordId,
      workerId: input.recognition.workerId,
      workerName: input.recognition.workerName,
      siteId: input.siteId,
      embeddingHash: input.recognition.embeddingHash,
      livenessSessionId: input.livenessSessionId,
      recognitionConfidence: input.recognition.confidence,
      confidenceTier: input.recognition.tier,
      reviewRequired: input.recognition.tier === 'LOW',
      timestamp,
      gpsLat: input.gps.lat,
      gpsLng: input.gps.lng,
      gpsAccuracyM: input.gps.accuracyM,
      chainIndex,
      previousHash,
      deviceId: input.deviceId
    };

    const record: AttendanceRecord = {
      ...unsigned,
      chainHash: sha256Placeholder(unsigned)
    };

    this.attendanceRecords.push(record);
    return record;
  }

  appendSpoofIncident(input: Omit<SpoofIncidentRecord, 'incidentId' | 'previousHash' | 'chainHash' | 'chainIndex'>): SpoofIncidentRecord {
    const previousHash = this.getTailHash();
    const chainIndex = this.attendanceRecords.length + this.incidents.length;
    const unsigned = {
      ...input,
      incidentId: `spoof_${input.deviceId}_${chainIndex}_${input.timestamp}`,
      previousHash,
      chainIndex
    };
    const incident = { ...unsigned, chainHash: sha256Placeholder(unsigned) };
    this.incidents.push(incident);
    return incident;
  }

  verifyIntegrity(): ChainIntegrityReport {
    let previousHash = this.genesisHash;
    const records = [...this.attendanceRecords, ...this.incidents].sort((left, right) => left.chainIndex - right.chainIndex);

    for (const record of records) {
      if (record.previousHash !== previousHash) {
        return {
          valid: false,
          checkedRecords: record.chainIndex,
          genesisHash: this.genesisHash,
          tailHash: previousHash,
          firstBrokenIndex: record.chainIndex,
          reason: 'PREVIOUS_HASH_MISMATCH'
        };
      }

      const { chainHash, syncedAt, ...unsigned } = record as AttendanceRecord;
      const expected = sha256Placeholder(unsigned);
      if (chainHash !== expected) {
        return {
          valid: false,
          checkedRecords: record.chainIndex,
          genesisHash: this.genesisHash,
          tailHash: previousHash,
          firstBrokenIndex: record.chainIndex,
          reason: 'CHAIN_HASH_MISMATCH'
        };
      }

      previousHash = chainHash;
    }

    return {
      valid: true,
      checkedRecords: records.length,
      genesisHash: this.genesisHash,
      tailHash: previousHash
    };
  }

  getUnsyncedAttendance(): AttendanceRecord[] {
    return this.attendanceRecords.filter((record) => !record.syncedAt);
  }

  markSynced(recordIds: string[], syncedAt = Date.now()): void {
    const idSet = new Set(recordIds);
    this.attendanceRecords = this.attendanceRecords.map((record) =>
      idSet.has(record.recordId) ? { ...record, syncedAt } : record
    );
  }

  purgeSynced(olderThan = Date.now()): number {
    const before = this.attendanceRecords.length;
    this.attendanceRecords = this.attendanceRecords.filter((record) => !record.syncedAt || record.syncedAt > olderThan);
    return before - this.attendanceRecords.length;
  }

  getTailHash(): string {
    const all = [...this.attendanceRecords, ...this.incidents].sort((left, right) => left.chainIndex - right.chainIndex);
    return all.length > 0 ? all[all.length - 1].chainHash : this.genesisHash;
  }

  getLength(): number {
    return this.attendanceRecords.length + this.incidents.length;
  }

  getGenesisHash(): string {
    return this.genesisHash;
  }

  getAttendanceRecords(): AttendanceRecord[] {
    return [...this.attendanceRecords];
  }

  getSpoofIncidents(): SpoofIncidentRecord[] {
    return [...this.incidents];
  }

  hydrate(attendanceRecords: AttendanceRecord[], incidents: SpoofIncidentRecord[]): void {
    this.attendanceRecords = [...attendanceRecords].sort((left, right) => left.chainIndex - right.chainIndex);
    this.incidents = [...incidents].sort((left, right) => left.chainIndex - right.chainIndex);
  }
}
