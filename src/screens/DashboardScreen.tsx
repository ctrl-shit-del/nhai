import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChainBadge } from '../components/ChainBadge';
import type { GUARDEngine } from '../config/GUARDEngine';
import type { GUARDEngineProps } from '../types';

type GuardStats = ReturnType<GUARDEngine['getStats']>;
type DemoRoute = 'Attendance' | 'Enrollment' | 'ChainAudit' | 'Sync';

export function DashboardScreen({ engine }: GUARDEngineProps) {
  const navigation = useNavigation<NavigationProp<Record<DemoRoute, undefined>>>();
  const [stats, setStats] = useState<GuardStats>(() => engine.getStats());

  const refreshStats = () => {
    setStats(engine.getStats());
  };

  useEffect(() => {
    refreshStats();
  }, [engine]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>GUARD Dashboard</Text>
      <View style={styles.grid}>
        <Metric label="Workers" value={stats.enrolledWorkers.toString()} />
        <Metric label="Unsynced" value={stats.unsyncedRecords.toString()} />
        <Metric label="Chain" value={stats.chainLength.toString()} />
      </View>
      <ChainBadge valid={stats.integrity.valid} count={stats.chainLength} />
      <View style={styles.navGrid}>
        <Pressable style={styles.navButton} onPress={() => navigation.navigate('Attendance')}>
          <Text style={styles.navButtonText}>Attendance</Text>
        </Pressable>
        <Pressable style={styles.navButton} onPress={() => navigation.navigate('Enrollment')}>
          <Text style={styles.navButtonText}>Enrollment</Text>
        </Pressable>
        <Pressable style={styles.navButton} onPress={() => navigation.navigate('ChainAudit')}>
          <Text style={styles.navButtonText}>Audit</Text>
        </Pressable>
        <Pressable style={styles.navButton} onPress={() => navigation.navigate('Sync')}>
          <Text style={styles.navButtonText}>Sync</Text>
        </Pressable>
      </View>
      <Pressable style={styles.secondaryButton} onPress={refreshStats}>
        <Text style={styles.secondaryButtonText}>Refresh</Text>
      </Pressable>
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
  grid: {
    flexDirection: 'row',
    gap: 10
  },
  metric: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 12
  },
  metricValue: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '800'
  },
  metricLabel: {
    color: '#6B7280',
    fontSize: 12
  },
  navButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D1D5DB',
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    minWidth: '48%',
    padding: 12
  },
  navButtonText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700'
  },
  navGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#2563EB',
    borderRadius: 6,
    borderWidth: 1,
    padding: 12
  },
  secondaryButtonText: {
    color: '#2563EB',
    fontSize: 15,
    fontWeight: '700'
  }
});
