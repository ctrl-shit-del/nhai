import { GUARD_THRESHOLDS } from '../config/constants';
import { MerkleChain } from '../security/MerkleChain';
import { AttendanceRecord, GUARDConfig, SyncAck, SyncBatch } from '../types';
import { hmacPlaceholder, sha256Placeholder } from '../utils/hash';

export class SyncEngine {
  constructor(
    private readonly config: GUARDConfig,
    private readonly chain: MerkleChain
  ) {}

  createBatches(records = this.chain.getUnsyncedAttendance()): SyncBatch[] {
    const integrityReport = this.chain.verifyIntegrity();
    if (!integrityReport.valid) {
      throw new Error(`Cannot sync broken chain: ${integrityReport.reason ?? 'UNKNOWN'}`);
    }

    const batches: SyncBatch[] = [];

    for (let index = 0; index < records.length; index += GUARD_THRESHOLDS.syncChunkSize) {
      const chunk = records.slice(index, index + GUARD_THRESHOLDS.syncChunkSize);
      batches.push(this.createBatch(chunk, integrityReport));
    }

    return batches;
  }

  async sync(sendBatch: (batch: SyncBatch) => Promise<SyncAck>): Promise<{ synced: number; purged: number }> {
    let synced = 0;

    for (const batch of this.createBatches()) {
      const ack = await sendBatch(batch);
      this.verifyAck(batch, ack);
      this.chain.markSynced(batch.records.map((record) => record.recordId), ack.committedAt);
      synced += ack.recordCount;
    }

    const purgeBefore = Date.now() - GUARD_THRESHOLDS.purgeAfterAckMs;
    return {
      synced,
      purged: this.chain.purgeSynced(purgeBefore)
    };
  }

  private createBatch(records: AttendanceRecord[], integrityReport = this.chain.verifyIntegrity()): SyncBatch {
    const recordIds = records.map((record) => record.recordId).join('|');
    const checksum = sha256Placeholder(recordIds);
    const createdAt = Date.now();
    const batchId = `batch_${this.config.deviceId}_${createdAt}_${records[0]?.chainIndex ?? 0}`;
    const signingPayload = {
      batchId,
      checksum,
      chainTailHash: records.length > 0 ? records[records.length - 1].chainHash : this.chain.getTailHash(),
      recordCount: records.length
    };

    return {
      batchId,
      siteId: this.config.siteId,
      deviceId: this.config.deviceId,
      chainTailHash: records.length > 0 ? records[records.length - 1].chainHash : this.chain.getTailHash(),
      checksum,
      deviceSignature: hmacPlaceholder(signingPayload, this.config.datalakeAuthToken),
      recordCount: records.length,
      integrityReport,
      createdAt,
      records
    };
  }

  private verifyAck(batch: SyncBatch, ack: SyncAck): void {
    if (ack.status !== 'COMMITTED' || ack.batchId !== batch.batchId || ack.recordCount !== batch.recordCount) {
      throw new Error(`Invalid sync ACK for ${batch.batchId}`);
    }

    if (!ack.serverAck) {
      throw new Error(`Missing signed server ACK for ${batch.batchId}`);
    }
  }
}
