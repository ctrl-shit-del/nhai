import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface ChainBadgeProps {
  valid: boolean;
  count: number;
}

export function ChainBadge({ valid, count }: ChainBadgeProps) {
  return (
    <View style={[styles.badge, valid ? styles.valid : styles.invalid]}>
      <Text style={styles.text}>{valid ? 'CHAIN OK' : 'CHAIN BREAK'}</Text>
      <Text style={styles.count}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  valid: {
    backgroundColor: '#E7F7ED'
  },
  invalid: {
    backgroundColor: '#FDECEC'
  },
  text: {
    color: '#1D1D1F',
    fontSize: 12,
    fontWeight: '700'
  },
  count: {
    color: '#555',
    fontSize: 12
  }
});
