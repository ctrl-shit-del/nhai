import Geolocation from '@react-native-community/geolocation';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FaceOverlay } from '../components/FaceOverlay';
import type { ImageFrame } from '../ml/CLAHEPreprocessor';
import type { AttendanceOutcome, GPSPoint, GUARDEngineProps, LivenessSession } from '../types';

type AttendanceStatus = 'idle' | 'liveness' | 'processing' | 'success' | 'failed' | 'spoof';

const mockFrame: ImageFrame = {
  data: new Uint8Array(112 * 112 * 3).fill(128),
  width: 112,
  height: 112,
  channels: 3
};

export function AttendanceScreen({ engine }: GUARDEngineProps) {
  const [status, setStatus] = useState<AttendanceStatus>('idle');
  const [livenessSession, setLivenessSession] = useState<LivenessSession | null>(null);
  const [outcome, setOutcome] = useState<AttendanceOutcome | null>(null);
  const [gps, setGps] = useState<GPSPoint | null>(null);
  const [chainLength, setChainLength] = useState(engine.getStats().chainLength);
  const [message, setMessage] = useState('Ready for offline liveness, recognition, GPS capture, and Merkle-chain commit.');

  useEffect(() => {
    Geolocation.getCurrentPosition(
      (position) => {
        setGps({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          capturedAt: Date.now()
        });
      },
      (error) => {
        setMessage(`GPS unavailable: ${error.message}`);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 }
    );
  }, []);

  useEffect(() => {
    if (status !== 'success') return undefined;

    const timer = setTimeout(() => {
      setStatus('idle');
      setOutcome(null);
      setLivenessSession(null);
      setMessage('Ready for offline liveness, recognition, GPS capture, and Merkle-chain commit.');
    }, 3_000);

    return () => clearTimeout(timer);
  }, [status]);

  const beginAttendance = () => {
    const session = engine.livenessDetector.createSession();
    setOutcome(null);
    setLivenessSession(session);
    setStatus('liveness');
    setMessage(`Challenge: ${session.challenges.join(', ')}`);
  };

  const completeChallenge = async () => {
    if (!livenessSession) return;

    setStatus('processing');
    setMessage('Processing liveness and recognition...');

    try {
      const activeSession = engine.livenessDetector.evaluateActive(livenessSession, livenessSession.challenges);
      const passiveSession = await engine.livenessDetector.evaluatePassive(activeSession, mockFrame);
      setLivenessSession(passiveSession);

      if (!engine.livenessDetector.isComplete(passiveSession)) {
        setStatus('spoof');
        setMessage('SPOOF DETECTED');
        return;
      }

      if (!gps) {
        setStatus('failed');
        setMessage('GPS fix required before attendance can be marked.');
        return;
      }

      const nextOutcome = await engine.markAttendance(mockFrame, gps);
      setOutcome(nextOutcome);

      if (nextOutcome.status === 'COMMITTED') {
        setStatus('success');
        setChainLength(engine.getStats().chainLength);
        setMessage(`${nextOutcome.record?.workerName ?? nextOutcome.recognition?.workerName ?? 'Worker'} marked at ${Math.round((nextOutcome.recognition?.confidence ?? 0) * 100)}% confidence.`);
      } else {
        setStatus('failed');
        setMessage(nextOutcome.reason ?? 'Review required');
      }
    } catch (error) {
      setStatus('failed');
      setMessage(error instanceof Error ? error.message : 'Attendance failed');
    }
  };

  const prompt = livenessSession ? livenessSession.challenges.join(', ') : 'Blink, then face forward';

  return (
    <View style={styles.screen}>
      <View style={styles.cameraPane}>
        <Text style={styles.cameraLabel}>Camera preview</Text>
        <FaceOverlay prompt={prompt} />
      </View>
      <View style={styles.panel}>
        <Text style={styles.title}>Attendance</Text>
        <Text style={[styles.body, status === 'spoof' ? styles.spoofText : null]}>{message}</Text>
        {outcome?.status === 'COMMITTED' ? (
          <Text style={styles.body}>
            {outcome.record?.workerName} · Confidence {Math.round((outcome.recognition?.confidence ?? 0) * 100)}%
          </Text>
        ) : null}
        <Text style={styles.counter}>Chain records: {chainLength}</Text>
        {status === 'liveness' ? (
          <Pressable style={styles.primaryButton} onPress={completeChallenge}>
            <Text style={styles.primaryButtonText}>Complete Challenge</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.primaryButton, status === 'processing' ? styles.disabledButton : null]} disabled={status === 'processing'} onPress={beginAttendance}>
            <Text style={styles.primaryButtonText}>{status === 'processing' ? 'Processing...' : 'Mark Attendance'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F6F8FA',
    flex: 1
  },
  cameraPane: {
    alignItems: 'center',
    backgroundColor: '#111827',
    flex: 1,
    justifyContent: 'center',
    minHeight: 420
  },
  cameraLabel: {
    color: '#9CA3AF',
    fontSize: 13
  },
  panel: {
    backgroundColor: '#FFFFFF',
    gap: 10,
    padding: 16
  },
  title: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '700'
  },
  body: {
    color: '#4B5563',
    fontSize: 14
  },
  counter: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700'
  },
  disabledButton: {
    backgroundColor: '#93C5FD'
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
  spoofText: {
    color: '#B91C1C',
    fontWeight: '800'
  }
});
