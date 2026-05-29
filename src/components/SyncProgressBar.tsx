import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface SyncProgressBarProps {
  synced: number;
  total: number;
}

export function SyncProgressBar({ synced, total }: SyncProgressBarProps) {
  const progress = total <= 0 ? 0 : Math.min(1, synced / total);

  return (
    <View style={styles.container}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.label}>{synced}/{total} records</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8
  },
  track: {
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    height: 8,
    overflow: 'hidden'
  },
  fill: {
    backgroundColor: '#2563EB',
    height: 8
  },
  label: {
    color: '#4B5563',
    fontSize: 12
  }
});
