import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WorkerProfile } from '../types';

export interface WorkerCardProps {
  worker: WorkerProfile;
}

export function WorkerCard({ worker }: WorkerCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{worker.workerName}</Text>
      <Text style={styles.meta}>{worker.workerId}</Text>
      {!!worker.labourContractId && <Text style={styles.meta}>{worker.labourContractId}</Text>}
      {!!worker.ppeNotes && <Text style={styles.notes}>{worker.ppeNotes}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 12
  },
  name: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700'
  },
  meta: {
    color: '#4B5563',
    fontSize: 13
  },
  notes: {
    color: '#6B7280',
    fontSize: 12
  }
});
