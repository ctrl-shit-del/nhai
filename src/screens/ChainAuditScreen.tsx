import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChainBadge } from '../components/ChainBadge';
import type { GUARDEngine } from '../config/GUARDEngine';
import type { AttendanceRecord, ChainIntegrityReport, GUARDEngineProps } from '../types';

export function ChainAuditScreen({ engine }: GUARDEngineProps) {
  const [report, setReport] = useState<ChainIntegrityReport>(() => engine.merkleChain.verifyIntegrity());
  const [records, setRecords] = useState<AttendanceRecord[]>(() => getLastRecords(engine));

  const verifyIntegrity = () => {
    setReport(engine.merkleChain.verifyIntegrity());
    setRecords(getLastRecords(engine));
  };

  useEffect(() => {
    verifyIntegrity();
  }, [engine]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Chain Audit</Text>
      <ChainBadge valid={report.valid} count={report.checkedRecords} />
      <View style={styles.report}>
        <Text style={[styles.status, report.valid ? styles.validText : styles.invalidText]}>
          {report.valid ? '✓ Valid' : '✗ Broken'}
        </Text>
        <Text style={styles.label}>Checked records</Text>
        <Text style={styles.value}>{report.checkedRecords}</Text>
        <Text style={styles.label}>Tail hash</Text>
        <Text style={styles.mono}>{report.tailHash}</Text>
        <Text style={styles.label}>Genesis hash</Text>
        <Text style={styles.mono}>{report.genesisHash}</Text>
      </View>
      <View style={styles.report}>
        <Text style={styles.label}>Last 5 attendance records</Text>
        {records.length === 0 ? <Text style={styles.value}>No attendance records</Text> : null}
        {records.map((record) => (
          <View key={record.recordId} style={styles.recordRow}>
            <Text style={styles.recordName}>{record.workerName}</Text>
            <Text style={styles.value}>{new Date(record.timestamp).toLocaleString()}</Text>
            <Text style={styles.mono}>#{record.chainIndex} {record.chainHash.slice(0, 8)}</Text>
          </View>
        ))}
      </View>
      <Pressable style={styles.secondaryButton} onPress={verifyIntegrity}>
        <Text style={styles.secondaryButtonText}>Verify Integrity</Text>
      </Pressable>
    </View>
  );
}

function getLastRecords(engine: GUARDEngine): AttendanceRecord[] {
  return engine.merkleChain.getAttendanceRecords().slice(-5).reverse();
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
  report: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12
  },
  label: {
    color: '#6B7280',
    fontSize: 12
  },
  invalidText: {
    color: '#B91C1C'
  },
  mono: {
    color: '#111827',
    fontFamily: 'monospace',
    fontSize: 12
  },
  recordName: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700'
  },
  recordRow: {
    borderTopColor: '#E5E7EB',
    borderTopWidth: 1,
    gap: 3,
    paddingTop: 8
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
  },
  status: {
    fontSize: 16,
    fontWeight: '800'
  },
  validText: {
    color: '#166534'
  },
  value: {
    color: '#374151',
    fontSize: 13
  }
});
