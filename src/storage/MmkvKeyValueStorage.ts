import { MMKV } from 'react-native-mmkv';
import type { KeyValueStorage } from './GuardStorage';

/**
 * MmkvKeyValueStorage
 *
 * Persistent, encrypted key-value store backed by react-native-mmkv.
 * Implements the {@link KeyValueStorage} interface used by {@link GuardStorage}
 * to survive app restarts.
 *
 * MMKV stores data in a memory-mapped file on disk. The optional `encryptionKey`
 * enables AES-256 encryption at rest (provided natively by MMKV).
 *
 * Usage in App.tsx:
 * ```ts
 * const storage = new GuardStorage(
 *   new MmkvKeyValueStorage('guard_chain_' + config.siteId, config.deviceId),
 *   config.siteId,
 *   config.deviceId,
 * );
 * ```
 */
export class MmkvKeyValueStorage implements KeyValueStorage {
  private readonly store: MMKV;

  /**
   * @param id            Unique store identifier — must be different from the
   *                      embedding store ID to avoid key collisions.
   * @param encryptionKey Optional AES-256 encryption key. Use the device ID or
   *                      a hardware-backed secret for at-rest security.
   */
  constructor(id: string, encryptionKey?: string) {
    this.store = new MMKV({ id, encryptionKey });
  }

  async getString(key: string): Promise<string | undefined> {
    return this.store.getString(key) ?? undefined;
  }

  async setString(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}
