import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SyncProgressBar } from '../components/SyncProgressBar';
import type { GUARDEngineProps, SyncAck, SyncBatch } from '../types';

type SyncState = 'idle' | 'syncing' | 'done' | 'error';

const mockSendBatch = async (batch: SyncBatch): Promise<SyncAck> => ({
  status: 'COMMITTED',
  batchId: batch.batchId,
  recordCount: batch.recordCount,
  serverAck: 'mock-ack-' + batch.batchId,
  committedAt: Date.now()
});

export function SyncScreen({ engine }: GUARDEngineProps) {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncResult, setSyncResult] = useState<{ synced: number; purged: number } | null>(null);
  const [total, setTotal] = useState(engine.getStats().unsyncedRecords);
  const [error, setError] = useState<string | null>(null);

  const startManualSync = async () => {
    const nextTotal = engine.getStats().unsyncedRecords;
    setTotal(nextTotal);
    setSyncState('syncing');
    setSyncResult(null);
    setError(null);

    try {
      const result = await engine.syncPending(mockSendBatch);
      setSyncResult(result);
      setSyncState('done');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Sync failed');
      setSyncState('error');
    }
  };

  const synced = syncState === 'done' ? syncResult?.synced ?? 0 : 0;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Sync</Text>
      <SyncProgressBar synced={synced} total={total} />
      <View style={styles.status}>
        <Text style={styles.statusText}>{getStatusText(syncState, syncResult, error)}</Text>
      </View>
      <Pressable style={[styles.primaryButton, syncState === 'syncing' ? styles.disabledButton : null]} disabled={syncState === 'syncing'} onPress={startManualSync}>
        <Text style={styles.primaryButtonText}>{syncState === 'syncing' ? 'Syncing...' : 'Start Manual Sync'}</Text>
      </Pressable>
    </View>
  );
}

function getStatusText(syncState: SyncState, syncResult: { synced: number; purged: number } | null, error: string | null): string {
  if (syncState === 'syncing') return 'Syncing pending records...';
  if (syncState === 'done' && syncResult) return `${syncResult.synced} records synced, ${syncResult.purged} records purged`;
  if (syncState === 'error') return error ?? 'Sync failed';
  return 'Waiting for connectivity. Records are retained until signed ACK.';
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F6F8FA',
    flex: 1,
    gap: 14,
    padding: 16
  },
  title: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '700'
  },
  status: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12
  },
  statusText: {
    color: '#4B5563',
    fontSize: 14
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 6,
    padding: 12
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700'
  },
  disabledButton: {
    backgroundColor: '#93C5FD'
  }
});
