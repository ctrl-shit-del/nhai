import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { ChainAuditScreen }  from './src/screens/ChainAuditScreen';
import { DashboardScreen }   from './src/screens/DashboardScreen';
import { EnrollmentScreen }  from './src/screens/EnrollmentScreen';
import { SyncScreen }        from './src/screens/SyncScreen';
import { AttendanceScreen }  from './src/screens/AttendanceScreen';
import { useGUARDEngine }    from './src/hooks/useGUARDEngine';
import { useNetworkMonitor } from './src/hooks/useNetworkMonitor';
import { GuardStorage }      from './src/storage/GuardStorage';
import { MmkvKeyValueStorage } from './src/storage/MmkvKeyValueStorage';
import type { GUARDConfig, SyncAck, SyncBatch } from './src/types';
import { getGuardDeviceInfo } from './src/utils/DeviceInfo';

type RootStackParamList = {
  Dashboard:  undefined;
  Attendance: undefined;
  Enrollment: undefined;
  ChainAudit: undefined;
  Sync:       undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ── Live sync batch sender factory ───────────────────────────────────────────
/**
 * Returns a `sendBatch` function that POSTs to the configured Datalake 3.0
 * sync endpoint. Falls back to a mock ACK when `syncEndpoint` is not configured
 * (development mode — logged with a warning so it is not silently bypassed).
 *
 * The live path:
 *  • Sets `Authorization: Bearer <datalakeAuthToken>` and `X-GUARD-Device` headers.
 *  • Throws on any non-2xx HTTP status to trigger SyncEngine's retry logic.
 *  • Returns the typed `SyncAck` JSON body from the server.
 */
function createSendBatch(config: GUARDConfig): (batch: SyncBatch) => Promise<SyncAck> {
  if (!config.syncEndpoint) {
    console.warn(
      '[GUARD] syncEndpoint not configured — using mock ACK. ' +
      'Set GUARDConfig.syncEndpoint before production deployment.'
    );
    return async (batch: SyncBatch): Promise<SyncAck> => ({
      status:      'COMMITTED',
      batchId:     batch.batchId,
      recordCount: batch.recordCount,
      serverAck:   'mock-ack-' + batch.batchId,
      committedAt: Date.now(),
    });
  }

  return async (batch: SyncBatch): Promise<SyncAck> => {
    const response = await fetch(config.syncEndpoint!, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${config.datalakeAuthToken}`,
        'X-GUARD-Device': config.deviceId,
        'X-GUARD-Site':   config.siteId,
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      throw new Error(
        `[GUARD] Sync HTTP ${response.status} ${response.statusText} — batch ${batch.batchId}`
      );
    }

    return response.json() as Promise<SyncAck>;
  };
}

// ── Root component ────────────────────────────────────────────────────────────
export default function App() {
  const [config, setConfig] = useState<GUARDConfig | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    getGuardDeviceInfo()
      .then((deviceInfo) => {
        if (!mounted) return;

        setConfig({
          siteId:           'NHAI-DEMO-SITE',
          deviceId:         deviceInfo.deviceId,
          datalakeAuthToken: 'demo-device-token',
          // Set syncEndpoint to your Datalake 3.0 backend to activate live sync:
          // syncEndpoint: 'https://datalake.example.gov.in/v1/attendance/sync',

          // Demo site geofence — set lat/lng to your actual site coordinates.
          // siteLocation: { lat: 34.0837, lng: 74.7973, radiusM: 500 },

          requireSupervisorLivenessForEnrollment: false,
          allowLowConfidenceCommit:               true,
        });
      })
      .catch((nextError) => {
        if (mounted) {
          setError(nextError instanceof Error ? nextError.message : 'Device initialization failed');
        }
      });

    return () => { mounted = false; };
  }, []);

  if (error)   return <Splash message={error} />;
  if (!config) return <Splash message="Initializing GUARD device…" loading />;

  return <GuardNavigator config={config} />;
}

// ── Navigation shell ──────────────────────────────────────────────────────────
function GuardNavigator({ config }: { config: GUARDConfig }) {
  // ── Persistent Merkle chain storage (Package 6) ──────────────────────────
  // Replaces MemoryKeyValueStorage — chain survives app restarts.
  // MMKV uses the deviceId as the AES-256 encryption key so the file is
  // only readable on the device that wrote it.
  const storage = useMemo(
    () => new GuardStorage(
      new MmkvKeyValueStorage(`guard_chain_${config.siteId}`, config.deviceId),
      config.siteId,
      config.deviceId,
    ),
    [config]
  );

  const { engine, isReady, error } = useGUARDEngine(config, storage);
  const network     = useNetworkMonitor();
  const wasConnected = useRef(network.isConnected);
  const [syncMessage, setSyncMessage] = useState('Offline-ready');

  // ── Live sync send function (Package 5) ──────────────────────────────────
  const sendBatch = useMemo(() => createSendBatch(config), [config]);

  // ── Auto-sync on network reconnect (SY-01) ────────────────────────────────
  useEffect(() => {
    const reconnected = network.isConnected && !wasConnected.current;
    wasConnected.current = network.isConnected;

    if (!reconnected || !isReady) return;

    engine
      .syncPending(sendBatch)
      .then((result: { synced: number; purged: number }) => {
        setSyncMessage(`Auto-sync: ${result.synced} synced, ${result.purged} purged`);
      })
      .catch((nextError: unknown) => {
        setSyncMessage(nextError instanceof Error ? nextError.message : 'Auto-sync failed');
      });
  }, [engine, isReady, network.isConnected, sendBatch]);

  const status = useMemo(() => {
    if (error)    return error.message;
    if (!isReady) return 'Loading engine…';
    const modelStatus = engine.getStats().modelsLoaded;
    const modelTag = Object.values(modelStatus).every(Boolean) ? '· ML ready' : '· ML mock';
    return `${network.isConnected ? 'Online' : 'Offline'} ${modelTag} · ${syncMessage}`;
  }, [engine, error, isReady, network.isConnected, syncMessage]);

  if (error)    return <Splash message={error.message} />;
  if (!isReady) return <Splash message={status} loading />;

  return (
    <SafeAreaView style={styles.app}>
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>{status}</Text>
      </View>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Dashboard">
          <Stack.Screen name="Dashboard" options={{ title: 'GUARD Dashboard' }}>
            {() => <DashboardScreen engine={engine} />}
          </Stack.Screen>
          <Stack.Screen name="Attendance">
            {() => <AttendanceScreen engine={engine} />}
          </Stack.Screen>
          <Stack.Screen name="Enrollment">
            {() => <EnrollmentScreen engine={engine} />}
          </Stack.Screen>
          <Stack.Screen name="ChainAudit" options={{ title: 'Chain Audit' }}>
            {() => <ChainAuditScreen engine={engine} />}
          </Stack.Screen>
          <Stack.Screen name="Sync">
            {() => <SyncScreen engine={engine} sendBatch={sendBatch} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}

// ── Splash / loading screen ───────────────────────────────────────────────────
function Splash({ message, loading = false }: { message: string; loading?: boolean }) {
  return (
    <SafeAreaView style={styles.splash}>
      {loading ? <ActivityIndicator color="#2563EB" /> : null}
      <Text style={styles.splashText}>{message}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: {
    backgroundColor: '#F6F8FA',
    flex: 1
  },
  splash: {
    alignItems:      'center',
    backgroundColor: '#F6F8FA',
    flex:            1,
    gap:             12,
    justifyContent:  'center',
    padding:         24
  },
  splashText: {
    color:      '#111827',
    fontSize:   15,
    fontWeight: '700',
    textAlign:  'center'
  },
  statusBar: {
    backgroundColor:  '#111827',
    paddingHorizontal: 12,
    paddingVertical:   8
  },
  statusText: {
    color:      '#FFFFFF',
    fontSize:   12,
    fontWeight: '700'
  }
});
