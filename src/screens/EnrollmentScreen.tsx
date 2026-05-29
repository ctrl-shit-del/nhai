import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ImageFrame } from '../ml/CLAHEPreprocessor';
import type { GUARDEngineProps, WorkerProfile } from '../types';

const mockFrame: ImageFrame = {
  data: new Uint8Array(112 * 112 * 3).fill(128),
  width: 112,
  height: 112,
  channels: 3
};

export function EnrollmentScreen({ engine }: GUARDEngineProps) {
  const [workerName, setWorkerName] = useState('');
  const [labourContractId, setLabourContractId] = useState('');
  const [ppeNotes, setPpeNotes] = useState('');
  const [sampleCount, setSampleCount] = useState(0);
  const [enrolling, setEnrolling] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const captureSample = () => {
    setError(null);
    setEnrolled(false);
    setSampleCount((current) => Math.min(3, current + 1));
  };

  const saveEnrollment = async () => {
    if (sampleCount < 3 || workerName.trim().length === 0) return;

    setEnrolling(true);
    setError(null);
    setEnrolled(false);

    try {
      const profile: WorkerProfile = {
        workerId: Date.now().toString(),
        workerName: workerName.trim(),
        labourContractId: labourContractId.trim() || undefined,
        ppeNotes: ppeNotes.trim() || undefined,
        enrolledAt: Date.now()
      };
      const samples = [mockFrame, mockFrame, mockFrame];
      await engine.enrollWorker(profile, samples);
      setWorkerName('');
      setLabourContractId('');
      setPpeNotes('');
      setSampleCount(0);
      setEnrolled(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Enrollment failed');
    } finally {
      setEnrolling(false);
    }
  };

  const canSave = sampleCount === 3 && workerName.trim().length > 0 && !enrolling;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Worker Enrollment</Text>
      <TextInput placeholder="Worker name" placeholderTextColor="#6B7280" style={styles.input} value={workerName} onChangeText={setWorkerName} />
      <TextInput placeholder="Labour contract ID" placeholderTextColor="#6B7280" style={styles.input} value={labourContractId} onChangeText={setLabourContractId} />
      <TextInput placeholder="PPE notes" placeholderTextColor="#6B7280" style={styles.input} value={ppeNotes} onChangeText={setPpeNotes} />
      <View style={styles.sampleRow}>
        {[1, 2, 3].map((sampleIndex) => (
          <Text key={sampleIndex} style={[styles.sample, sampleCount >= sampleIndex ? styles.sampleAccepted : null]}>
            {sampleCount >= sampleIndex ? '✓ ' : ''}Sample {sampleIndex}
          </Text>
        ))}
      </View>
      <Pressable style={[styles.secondaryButton, sampleCount >= 3 ? styles.disabledButton : null]} disabled={sampleCount >= 3} onPress={captureSample}>
        <Text style={styles.secondaryButtonText}>Capture Sample</Text>
      </Pressable>
      <Pressable style={[styles.primaryButton, !canSave ? styles.disabledButton : null]} disabled={!canSave} onPress={saveEnrollment}>
        <Text style={styles.primaryButtonText}>{enrolling ? 'Saving...' : 'Save Enrollment'}</Text>
      </Pressable>
      {enrolled ? <Text style={styles.success}>Worker enrolled</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F6F8FA',
    flex: 1,
    gap: 12,
    padding: 16
  },
  title: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '700'
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D1D5DB',
    borderRadius: 6,
    borderWidth: 1,
    color: '#111827',
    padding: 12
  },
  sampleRow: {
    flexDirection: 'row',
    gap: 8
  },
  sample: {
    backgroundColor: '#E7F7ED',
    borderRadius: 6,
    color: '#166534',
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    padding: 10,
    textAlign: 'center'
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
    opacity: 0.5
  },
  error: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '700'
  },
  sampleAccepted: {
    backgroundColor: '#DCFCE7',
    color: '#166534'
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
  success: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '700'
  }
});
