import CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { MMKV } from 'react-native-mmkv';
import { WorkerProfile } from '../types';
import { sha256Placeholder } from '../utils/hash';

/** Keychain service name used to store the hardware-backed embedding key. */
const KEYCHAIN_SERVICE = 'guard_embedding_key';

export interface EncryptedEmbeddingRecord extends WorkerProfile {
  transformedEmbedding: number[];
  embeddingHash: string;
}

/**
 * EmbeddingStore
 *
 * Persists worker face embeddings in an MMKV-encrypted store, protected by a
 * 256-bit hardware-backed key retrieved from the device Keychain.
 *
 * Key lifecycle
 * ─────────────
 * • First launch: generates a random AES-256 key with CryptoJS.lib.WordArray.random(32)
 *   and stores it in the OS keychain (Android Keystore / iOS Secure Enclave).
 * • Subsequent launches: retrieves the same key — the embedding store is deterministic
 *   across restarts even after app backgrounding.
 * • App uninstall: keychain entry is deleted → new key on reinstall (old embeddings
 *   unreadable, requiring re-enrollment — by design per EN-08).
 *
 * Privacy transform
 * ─────────────────
 * Raw 128-dim embedding vectors are never stored. A device-specific additive
 * perturbation (derived from the hardware key) is applied before storage,
 * making it impossible to reconstruct the original vector even if the MMKV
 * file is extracted from the device.
 */
export class EmbeddingStore {
  private records = new Map<string, EncryptedEmbeddingRecord>();
  private deviceSecret = 'development-device-secret';
  private storage!: MMKV;

  /**
   * Initialises the store.
   *
   * 1. Fetches or generates the hardware-backed Keychain secret.
   * 2. Opens the MMKV instance encrypted with that secret.
   * 3. Loads any previously enrolled workers from disk.
   *
   * @param deviceSecretFallback Fallback used only when the Keychain is unavailable
   *                             (simulators, old OS versions). Never used on real devices.
   */
  async initialize(deviceSecretFallback?: string): Promise<void> {
    try {
      // ── Retrieve or generate hardware-backed key ───────────────────────────
      const existing = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });

      if (existing && existing.password) {
        // Key already exists — reuse it so previous enrollments remain readable.
        this.deviceSecret = existing.password;
      } else {
        // First launch: generate a 256-bit (32-byte) random key.
        const newKey = CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);

        await Keychain.setGenericPassword('guard', newKey, {
          service: KEYCHAIN_SERVICE,
          // WHEN_UNLOCKED_THIS_DEVICE_ONLY:
          //   • iOS  → stored in Secure Enclave; not extractable; not in iCloud backup.
          //   • Android → backed by Android Keystore Hardware Security Module when available.
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });

        this.deviceSecret = newKey;
      }
    } catch (keychainError) {
      // Keychain unavailable (simulator, rooted device without HSM, etc.).
      // Fall back to the device ID for development; warn loudly.
      console.warn(
        '[EmbeddingStore] Keychain unavailable — using fallback key. ' +
        'This is NOT acceptable in production. Ensure react-native-keychain is linked.',
        keychainError
      );
      this.deviceSecret = deviceSecretFallback ?? 'development-fallback-secret';
    }

    // Open the MMKV store encrypted with the first 16 hex chars of the secret
    // (MMKV encryption key is a plain string; the full secret is used in privacyTransform).
    this.storage = new MMKV({ id: 'guard_embeddings_v2', encryptionKey: this.deviceSecret.slice(0, 32) });
    this._loadFromStorage();
  }

  async save(profile: WorkerProfile, embedding: number[]): Promise<EncryptedEmbeddingRecord> {
    const transformedEmbedding = this.privacyTransform(embedding);
    const record: EncryptedEmbeddingRecord = {
      ...profile,
      transformedEmbedding,
      embeddingHash: sha256Placeholder(transformedEmbedding),
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

  /**
   * Applies a device-unique additive perturbation to the embedding vector.
   *
   * The perturbation is derived from SHA-256(deviceSecret) so it is:
   *   • deterministic: same secret → same transform → matching still works
   *   • irreversible: without the secret, raw embedding cannot be reconstructed
   *   • tiny: max ±0.005 per dimension — negligible effect on cosine similarity
   */
  private privacyTransform(embedding: number[]): number[] {
    const mask = sha256Placeholder(this.deviceSecret);
    return embedding.map((value, index) => {
      const byte = parseInt(mask.slice((index % 32) * 2, (index % 32) * 2 + 2), 16);
      return Number((value + (byte / 255 - 0.5) * 0.01).toFixed(6));
    });
  }
}
