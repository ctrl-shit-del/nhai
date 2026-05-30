import Geolocation                          from '@react-native-community/geolocation';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera }                            from 'react-native-vision-camera';

const CameraView = Camera as any;
import { FaceOverlay }                       from '../components/FaceOverlay';
import { useCameraFrame }                    from '../hooks/useCameraFrame';
import type { AttendanceOutcome, GPSPoint, GUARDEngineProps, LivenessSession } from '../types';

type AttendanceStatus = 'idle' | 'liveness' | 'processing' | 'success' | 'failed' | 'spoof';

export function AttendanceScreen({ engine }: GUARDEngineProps) {
  const [status,          setStatus]          = useState<AttendanceStatus>('idle');
  const [livenessSession, setLivenessSession] = useState<LivenessSession | null>(null);
  const [outcome,         setOutcome]         = useState<AttendanceOutcome | null>(null);
  const [gps,             setGps]             = useState<GPSPoint | null>(null);
  const [chainLength,     setChainLength]     = useState(engine.getStats().chainLength);
  const [message,         setMessage]         = useState('Point camera at your face to mark attendance.');

  // ── Camera + frame processor ─────────────────────────────────────────────
  const {
    hasPermission,
    requestPermission,
    device,
    cameraRef,
    frameProcessor,
    captureFrame,
    captureDetectedFace,
    sharedQuality,
  } = useCameraFrame(engine.models.blazeface, 'front');

  // ── GPS fix (refreshed continuously) ─────────────────────────────────────
  useEffect(() => {
    const watchId = Geolocation.watchPosition(
      (position: any) => {
        setGps({
          lat:        position.coords.latitude,
          lng:        position.coords.longitude,
          accuracyM:  position.coords.accuracy,
          capturedAt: Date.now(),
        });
      },
      (gpsError: any) => { setMessage(`GPS unavailable: ${gpsError.message}`); },
      { enableHighAccuracy: true, distanceFilter: 10 }
    );
    return () => Geolocation.clearWatch(watchId);
  }, []);

  // ── Auto-reset after success ──────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'success') return undefined;
    const timer = setTimeout(() => {
      setStatus('idle');
      setOutcome(null);
      setLivenessSession(null);
      setMessage('Point camera at your face to mark attendance.');
    }, 3_000);
    return () => clearTimeout(timer);
  }, [status]);

  // ── Camera permission request ─────────────────────────────────────────────
  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // ── Step 1: Begin attendance — show liveness challenges ───────────────────
  const beginAttendance = useCallback(() => {
    const session = engine.livenessDetector.createSession();
    setOutcome(null);
    setLivenessSession(session);
    setStatus('liveness');
    setMessage(`Liveness check: ${session.challenges.join(', ')}`);
  }, [engine]);

  // ── Step 2: Complete challenge — process real camera frame ────────────────
  const completeChallenge = useCallback(async () => {
    if (!livenessSession) return;

    setStatus('processing');
    setMessage('Processing liveness and recognition…');

    try {
      // Evaluate active challenge (user confirmed they performed the gesture)
      const activeSession = engine.livenessDetector.evaluateActive(
        livenessSession,
        livenessSession.challenges
      );

      // Capture the latest camera frame for passive liveness + recognition
      const currentFrame = captureFrame();

      if (!currentFrame) {
        setStatus('failed');
        setMessage('No camera frame available. Ensure camera permission is granted.');
        return;
      }

      if (!gps) {
        setStatus('failed');
        setMessage('GPS fix required. Move to an open area and try again.');
        return;
      }

      // GUARDEngine.markAttendance runs:
      //   1. CLAHE preprocessing
      //   2. BlazeFace detection (TFLite or mock)
      //   3. MiniFAS passive liveness (TFLite or heuristic)
      //   4. GPS geofence check (if config.siteLocation set)
      //   5. MobileFaceNet embedding (TFLite or mock)
      //   6. Cosine-similarity match against enrolled workers
      //   7. Merkle-chain commit
      const nextOutcome = await engine.markAttendance(currentFrame, gps, activeSession);
      setOutcome(nextOutcome);

      if (nextOutcome.status === 'COMMITTED') {
        setStatus('success');
        setChainLength(engine.getStats().chainLength);
        setMessage(
          `${nextOutcome.record?.workerName ?? nextOutcome.recognition?.workerName ?? 'Worker'} ` +
          `marked at ${Math.round((nextOutcome.recognition?.confidence ?? 0) * 100)}% confidence.`
        );
      } else if (nextOutcome.reason === 'OUTSIDE_GEOFENCE') {
        setStatus('failed');
        setMessage('Worker is outside the site geofence radius (500 m). Attendance rejected.');
      } else if (nextOutcome.reason === 'LIVENESS_FAILED' || nextOutcome.reason === 'LIVENESS_TIMEOUT') {
        setStatus('spoof');
        setMessage('Liveness check failed. Possible spoofing attempt — incident logged.');
      } else {
        setStatus('failed');
        setMessage(nextOutcome.reason ?? 'Review required');
      }
    } catch (attendanceError) {
      setStatus('failed');
      setMessage(attendanceError instanceof Error ? attendanceError.message : 'Attendance failed');
    }
  }, [livenessSession, engine, captureFrame, gps]);

  const prompt = livenessSession
    ? livenessSession.challenges.join(', ')
    : 'Align face within frame';

  return (
    <View style={styles.screen}>
      {/* ── Camera pane ──────────────────────────────────────────────────── */}
      <View style={styles.cameraPane}>
        {device && hasPermission ? (
          <CameraView
            ref={cameraRef as any}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={status !== 'success'}
            frameProcessor={frameProcessor}
            pixelFormat="rgb"
          />
        ) : (
          <Text style={styles.cameraLabel}>
            {hasPermission ? 'Loading camera…' : 'Camera permission required'}
          </Text>
        )}
        <FaceOverlay
          prompt={prompt}
          spoofWarning={status === 'spoof'}
        />
      </View>

      {/* ── Info panel ───────────────────────────────────────────────────── */}
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
          <Pressable
            style={[styles.primaryButton, status === 'processing' ? styles.disabledButton : null]}
            disabled={status === 'processing'}
            onPress={beginAttendance}
          >
            <Text style={styles.primaryButtonText}>
              {status === 'processing' ? 'Processing…' : 'Mark Attendance'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#F6F8FA',
    flex:            1
  },
  cameraPane: {
    alignItems:      'center',
    backgroundColor: '#111827',
    flex:            1,
    justifyContent:  'center',
    minHeight:       420,
    overflow:        'hidden'
  },
  cameraLabel: {
    color:    '#9CA3AF',
    fontSize: 13
  },
  panel: {
    backgroundColor: '#FFFFFF',
    gap:             10,
    padding:         16
  },
  title: {
    color:      '#111827',
    fontSize:   20,
    fontWeight: '700'
  },
  body: {
    color:    '#4B5563',
    fontSize: 14
  },
  counter: {
    color:      '#111827',
    fontSize:   13,
    fontWeight: '700'
  },
  disabledButton: {
    backgroundColor: '#93C5FD'
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
  spoofText: {
    color:      '#B91C1C',
    fontWeight: '800'
  }
});
