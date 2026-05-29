import { MMKV } from 'react-native-mmkv';
import { WorkerProfile } from '../types';
import { sha256Placeholder } from '../utils/hash';

export interface EncryptedEmbeddingRecord extends WorkerProfile {
  transformedEmbedding: number[];
  embeddingHash: string;
}

export class EmbeddingStore {
  private records = new Map<string, EncryptedEmbeddingRecord>();
  private deviceSecret = 'development-device-secret';
  private storage!: MMKV;

  async initialize(deviceSecret?: string): Promise<void> {
    this.deviceSecret = deviceSecret ?? this.deviceSecret;
    this.storage = new MMKV({ id: 'guard_embeddings_' + this.deviceSecret });
    this._loadFromStorage();
  }

  async save(profile: WorkerProfile, embedding: number[]): Promise<EncryptedEmbeddingRecord> {
    const transformedEmbedding = this.privacyTransform(embedding);
    const record: EncryptedEmbeddingRecord = {
      ...profile,
      transformedEmbedding,
      embeddingHash: sha256Placeholder(transformedEmbedding)
    };

    this.records.set(profile.workerId, record);
    this.storage.set('worker_' + profile.workerId, JSON.stringify(record));
    return record;
  }

  async delete(workerId: string): Promise<void> {
    this.records.delete(workerId);
    this.storage.delete('worker_' + workerId);
  }

  async list(): Promise<EncryptedEmbeddingRecord[]> {
    return Array.from(this.records.values());
  }

  async get(workerId: string): Promise<EncryptedEmbeddingRecord | undefined> {
    return this.records.get(workerId);
  }

  private _loadFromStorage(): void {
    this.records.clear();

    for (const key of this.storage.getAllKeys()) {
      if (!key.startsWith('worker_')) continue;

      const value = this.storage.getString(key);
      if (!value) continue;

      const record = JSON.parse(value) as EncryptedEmbeddingRecord;
      this.records.set(record.workerId, record);
    }
  }

  private privacyTransform(embedding: number[]): number[] {
    const mask = sha256Placeholder(this.deviceSecret);
    return embedding.map((value, index) => {
      const byte = parseInt(mask.slice((index % 32) * 2, (index % 32) * 2 + 2), 16);
      return Number((value + (byte / 255 - 0.5) * 0.01).toFixed(6));
    });
  }
}
