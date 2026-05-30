import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SyncProgressBar }    from '../components/SyncProgressBar';
import { useNetworkMonitor }  from '../hooks/useNetworkMonitor';
import type { GUARDEngineProps, SyncAck, SyncBatch } from '../types';

type SyncState = 'idle' | 'syncing' | 'done' | 'error';

export interface SyncScreenProps extends GUARDEngineProps {
  /**
   * Live batch sender from App.tsx's createSendBatch().
   * POSTs batches to the configured Datalake 3.0 endpoint and verifies the
   * signed server ACK before returning. Falls back to a mock when syncEndpoint
   * is not configured (development).
   */
  sendBatch: (batch: SyncBatch) => Promise<SyncAck>;
}

export function SyncScreen({ engine, sendBatch }: SyncScreenProps) {
  const network   = useNetworkMonitor();
  const [syncState,  setSyncState]  = useState<SyncState>('idle');
  const [syncResult, setSyncResult] = useState<{ synced: number; purged: number } | null>(null);
  const [total,      setTotal]      = useState(engine.getStats().unsyncedRecords);
  const [error,      setError]      = useState<string | null>(null);

  const startManualSync = async () => {
    const nextTotal = engine.getStats().unsyncedRecords;
    setTotal(nextTotal);
    setSyncState('syncing');
    setSyncResult(null);
    setError(null);

    try {
      // Uses the live fetch-based sendBatch from App.tsx (SY-02 chunked, SY-04 HMAC, SY-05 ACK-gated)
      const result = await engine.syncPending(sendBatch);
      setSyncResult(result);
      setSyncState('done');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Sync failed');
      setSyncState('error');
    }
  };

  const synced   = syncState === 'done' ? syncResult?.synced ?? 0 : 0;
  const canSync  = network.isConnected && syncState !== 'syncing';
  const offline  = !network.isConnected;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Sync</Text>

      {/* Network status pill */}
      <View style={[styles.networkPill, offline ? styles.networkOffline : styles.networkOnline]}>
        <Text style={styles.networkText}>
          {offline
            ? `Offline · ${network.type === 'none' ? 'No network' : 'Unknown'}`
            : `Online · ${network.type === 'cellular' ? 'Cellular' : 'Wi-Fi'}`}
        </Text>
      </View>

      <SyncProgressBar synced={synced} total={total} />

      <View style={styles.statusCard}>
        <Text style={styles.statusText}>{getStatusText(syncState, syncResult, error, offline)}</Text>
        {syncState === 'done' && syncResult && (
          <View style={styles.resultRow}>
            <Metric label="Synced"  value={syncResult.synced.toString()} />
            <Metric label="Purged"  value={syncResult.purged.toString()} />
            <Metric label="Pending" value={(total - syncResult.synced).toString()} />
          </View>
        )}
      </View>

      <Pressable
        style={[styles.primaryButton, !canSync ? styles.disabledButton : null]}
        disabled={!canSync}
        onPress={startManualSync}
      >
        <Text style={styles.primaryButtonText}>
          {syncState === 'syncing'
            ? 'Syncing…'
            : offline
            ? 'Waiting for connectivity…'
            : 'Start Manual Sync'}
        </Text>
      </Pressable>

      {offline && (
        <Text style={styles.offlineNote}>
          Records are retained locally until a signed server ACK is received.
          GUARD will auto-sync when connectivity is restored.
        </Text>
      )}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function getStatusText(
  syncState: SyncState,
  syncResult: { synced: number; purged: number } | null,
  error: string | null,
  offline: boolean
): string {
  if (syncState === 'syncing') return 'Uploading records to Datalake 3.0…';
  if (syncState === 'done' && syncResult) return `Sync complete. Chain integrity verified by server.`;
  if (syncState === 'error') return error ?? 'Sync failed';
  if (offline)               return 'Device is offline. Records are stored locally and cryptographically sealed.';
  return 'Ready to sync. All pending records will be uploaded in 50-record chunks.';
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F6F8FA',
    flex:            1,
    gap:             14,
    padding:         16
  },
  title: {
    color:      '#111827',
    fontSize:   22,
    fontWeight: '700'
  },
  networkPill: {
    alignSelf:       'flex-start',
    borderRadius:    20,
    paddingHorizontal: 12,
    paddingVertical:   5
  },
  networkOnline: { backgroundColor: '#E7F7ED' },
  networkOffline: { backgroundColor: '#FDECEC' },
  networkText: {
    color:      '#374151',
    fontSize:   12,
    fontWeight: '700'
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderColor:     '#E5E7EB',
    borderRadius:    8,
    borderWidth:     1,
    gap:             10,
    padding:         12
  },
  statusText: {
    color:    '#4B5563',
    fontSize: 14
  },
  resultRow: {
    flexDirection: 'row',
    gap:           8
  },
  metric: {
    backgroundColor: '#F6F8FA',
    borderRadius:    6,
    flex:            1,
    padding:         10
  },
  metricValue: {
    color:      '#111827',
    fontSize:   20,
    fontWeight: '800'
  },
  metricLabel: {
    color:    '#6B7280',
    fontSize: 11
  },
  primaryButton: {
    alignItems:      'center',
    backgroundColor: '#2563EB',
    borderRadius:    6,
    padding:         12
  },
  primaryButtonText: {
    color:      '#FFFFFF',
    fontSize:   15,
    fontWeight: '700'
  },
  disabledButton: {
    backgroundColor: '#93C5FD'
  },
  offlineNote: {
    color:      '#6B7280',
    fontSize:   12,
    lineHeight: 18,
    textAlign:  'center'
  }
});
