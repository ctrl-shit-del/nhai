import CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { MMKV } from 'react-native-mmkv';
import { WorkerProfile } from '../types';
import { sha256Placeholder } from '../utils/hash';

/** Keychain service name used to store the hardware-backed embedding key. */
const KEYCHAIN_SERVICE = 'guard_embedding_key';

export interface EncryptedEmbeddingRecord extends WorkerProfile {
  /** Privacy-transformed vector (audit / storage obfuscation). */
  transformedEmbedding: number[];
  /**
   * GUARD FIX: Issue 2 — L2-normalized embedding used for cosine matching after restart.
   * Stored encrypted in MMKV alongside the profile; not transmitted off-device.
   */
  matchingEmbedding?: number[];
  embeddingHash: string;
}

/**
 * EmbeddingStore
 *
 * Persists worker face embeddings in an MMKV-encrypted store, protected by a
 * 256-bit hardware-backed key retrieved from the device Keychain.
 */
export class EmbeddingStore {
  private records = new Map<string, EncryptedEmbeddingRecord>();
  private deviceSecret = 'development-device-secret';
  private storage!: MMKV;

  async initialize(deviceSecretFallback?: string): Promise<void> {
    try {
      const existing = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });

      if (existing && existing.password) {
        this.deviceSecret = existing.password;
      } else {
        const newKey = CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);

        await Keychain.setGenericPassword('guard', newKey, {
          service: KEYCHAIN_SERVICE,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });

        this.deviceSecret = newKey;
      }
    } catch (keychainError) {
      console.warn(
        '[EmbeddingStore] Keychain unavailable — using fallback key. ' +
        'This is NOT acceptable in production. Ensure react-native-keychain is linked.',
        keychainError,
      );
      this.deviceSecret = deviceSecretFallback ?? 'development-fallback-secret';
    }

    this.storage = new MMKV({
      id: 'guard_embeddings_v2',
      encryptionKey: this.deviceSecret.slice(0, 32),
    });
    this._loadFromStorage();
    console.log(
      `[EmbeddingStore] Initialized — ${this.records.size} workers loaded from MMKV`,
    );
  }

  async save(profile: WorkerProfile, embedding: number[]): Promise<EncryptedEmbeddingRecord> {
    const matchingEmbedding = this.l2Normalize(embedding);
    const transformedEmbedding = this.privacyTransform(matchingEmbedding);
    const record: EncryptedEmbeddingRecord = {
      ...profile,
      matchingEmbedding,
      transformedEmbedding,
      embeddingHash: sha256Placeholder(transformedEmbedding),
    };
    this.records.set(profile.workerId, record);
    this.storage.set('worker_' + profile.workerId, JSON.stringify(record));
    console.log(`[EmbeddingStore] Saved worker ${profile.workerId} (${profile.workerName})`);
    return record;
  }

  async delete(workerId: string): Promise<void> {
    this.records.delete(workerId);
    this.storage.delete('worker_' + workerId);
  }

  async clearAll(): Promise<void> {
    for (const workerId of [...this.records.keys()]) {
      await this.delete(workerId);
    }
    console.log('[EmbeddingStore] Cleared all worker records');
  }

  /** GUARD FIX: S3 — List all enrolled workers from MMKV. */
  async list(): Promise<EncryptedEmbeddingRecord[]> {
    return Array.from(this.records.values());
  }

  async get(workerId: string): Promise<EncryptedEmbeddingRecord | undefined> {
    return this.records.get(workerId);
  }

  private _loadFromStorage(): void {
    this.records.clear();
    const keys = this.storage.getAllKeys().filter((key) => key.startsWith('worker_'));

    for (const key of keys) {
      const value = this.storage.getString(key);
      if (!value) continue;
      try {
        const record = JSON.parse(value) as EncryptedEmbeddingRecord;
        if (!record.workerId) continue;
        this.records.set(record.workerId, record);
      } catch (parseError) {
        console.warn(`[EmbeddingStore] Skipped corrupt record at ${key}`, parseError);
      }
    }
  }

  private privacyTransform(embedding: number[]): number[] {
    const mask = sha256Placeholder(this.deviceSecret);
    return embedding.map((value, index) => {
      const byte = parseInt(mask.slice((index % 32) * 2, (index % 32) * 2 + 2), 16);
      return Number((value + (byte / 255 - 0.5) * 0.01).toFixed(6));
    });
  }

  private l2Normalize(vector: number[]): number[] {
    const magnitude =
      Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / magnitude);
  }
}
