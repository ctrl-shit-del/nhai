import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { ChainAuditScreen } from './src/screens/ChainAuditScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { EnrollmentScreen } from './src/screens/EnrollmentScreen';
import { SyncScreen } from './src/screens/SyncScreen';
import { AttendanceScreen } from './src/screens/AttendanceScreen';
import { useGUARDEngine } from './src/hooks/useGUARDEngine';
import { useNetworkMonitor } from './src/hooks/useNetworkMonitor';
import type { GUARDConfig, SyncAck, SyncBatch } from './src/types';
import { getGuardDeviceInfo } from './src/utils/DeviceInfo';

type RootStackParamList = {
  Dashboard: undefined;
  Attendance: undefined;
  Enrollment: undefined;
  ChainAudit: undefined;
  Sync: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const mockSendBatch = async (batch: SyncBatch): Promise<SyncAck> => ({
  status: 'COMMITTED',
  batchId: batch.batchId,
  recordCount: batch.recordCount,
  serverAck: 'mock-ack-' + batch.batchId,
  committedAt: Date.now()
});

export default function App() {
  const [config, setConfig] = useState<GUARDConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    getGuardDeviceInfo()
      .then((deviceInfo) => {
        if (!mounted) return;

        setConfig({
          siteId: 'NHAI-DEMO-SITE',
          deviceId: deviceInfo.deviceId,
          datalakeAuthToken: 'demo-device-token',
          requireSupervisorLivenessForEnrollment: false,
          allowLowConfidenceCommit: true
        });
      })
      .catch((nextError) => {
        if (mounted) setError(nextError instanceof Error ? nextError.message : 'Device initialization failed');
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (error) return <Splash message={error} />;
  if (!config) return <Splash message="Initializing GUARD device..." loading />;

  return <GuardNavigator config={config} />;
}

function GuardNavigator({ config }: { config: GUARDConfig }) {
  const { engine, isReady, error } = useGUARDEngine(config);
  const network = useNetworkMonitor();
  const wasConnected = useRef(network.isConnected);
  const [syncMessage, setSyncMessage] = useState('Offline-ready');

  useEffect(() => {
    const reconnected = network.isConnected && !wasConnected.current;
    wasConnected.current = network.isConnected;

    if (!reconnected || !isReady) return;

    engine
      .syncPending(mockSendBatch)
      .then((result) => {
        setSyncMessage(`Auto-sync: ${result.synced} synced, ${result.purged} purged`);
      })
      .catch((nextError) => {
        setSyncMessage(nextError instanceof Error ? nextError.message : 'Auto-sync failed');
      });
  }, [engine, isReady, network.isConnected]);

  const status = useMemo(() => {
    if (error) return error.message;
    if (!isReady) return 'Loading engine...';
    return `${network.isConnected ? 'Online' : 'Offline'} · ${syncMessage}`;
  }, [error, isReady, network.isConnected, syncMessage]);

  if (error) return <Splash message={error.message} />;
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
            {() => <SyncScreen engine={engine} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}

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
    alignItems: 'center',
    backgroundColor: '#F6F8FA',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24
  },
  splashText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center'
  },
  statusBar: {
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700'
  }
});
