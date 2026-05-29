import { AttendanceRecord, SpoofIncidentRecord } from '../types';

export interface KeyValueStorage {
  getString(key: string): Promise<string | undefined>;
  setString(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ChainSnapshot {
  attendanceRecords: AttendanceRecord[];
  spoofIncidents: SpoofIncidentRecord[];
}

export class MemoryKeyValueStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();

  async getString(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async setString(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}

export class GuardStorage {
  private readonly chainKey: string;

  constructor(
    private readonly storage: KeyValueStorage,
    siteId: string,
    deviceId: string
  ) {
    this.chainKey = `guard:${siteId}:${deviceId}:chain`;
  }

  async saveChain(snapshot: ChainSnapshot): Promise<void> {
    await this.storage.setString(this.chainKey, JSON.stringify(snapshot));
  }

  async loadChain(): Promise<ChainSnapshot | undefined> {
    const raw = await this.storage.getString(this.chainKey);
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as ChainSnapshot;
    return {
      attendanceRecords: parsed.attendanceRecords ?? [],
      spoofIncidents: parsed.spoofIncidents ?? []
    };
  }

  async clearChain(): Promise<void> {
    await this.storage.remove(this.chainKey);
  }
}
