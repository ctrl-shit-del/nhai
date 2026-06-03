import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Camera } from 'react-native-vision-camera';

const CameraView = Camera as any;
import { FaceOverlay } from '../components/FaceOverlay';
import { useCameraFrame } from '../hooks/useCameraFrame';
import type { GUARDEngineProps, WorkerProfile } from '../types';
import type { ImageFrame } from '../ml/CLAHEPreprocessor';

export function EnrollmentScreen({ engine }: GUARDEngineProps) {
  const [workerName,       setWorkerName]       = useState('');
  const [labourContractId, setLabourContractId] = useState('');
  const [ppeNotes,         setPpeNotes]         = useState('');
  const [enrolling,        setEnrolling]        = useState(false);
  const [enrolled,         setEnrolled]         = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [sampleMessage,    setSampleMessage]    = useState('Align face and tap Capture');
  const [sampleCount,      setSampleCount]      = useState(0);
  const [formFocused,      setFormFocused]      = useState(false);

  // Stored real camera frames — one per sample
  const samplesRef = useRef<ImageFrame[]>([]);

  const detectionPaused = formFocused || enrolling || sampleCount >= 3;

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
  } = useCameraFrame(engine.models.blazeface, 'front', {
    detectEnabled: !detectionPaused,
    inferenceThrottleMs: 300,
  });

  // ── Camera permission request ─────────────────────────────────────────────
  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // ── Capture one face sample ───────────────────────────────────────────────
  const captureSample = useCallback(async () => {
    if (sampleCount >= 3) return;

    setError(null);

    // Grab latest frame from frame processor
    const currentFrame = captureFrame();
    if (!currentFrame) {
      setError('No camera frame available. Ensure camera permission is granted.');
      return;
    }

    // Quick face quality pre-check using the last BlazeFace detection
    const detectedFace = captureDetectedFace();
    const quality      = engine.faceEngine.assessQuality(detectedFace);
    if (!quality.accepted) {
      setError(`Sample rejected: ${quality.reasons.join(', ')}. Centre your face and try again.`);
      return;
    }

    // Accept this frame as a valid sample
    samplesRef.current = [...samplesRef.current, currentFrame];
    const nextCount = samplesRef.current.length;
    setSampleCount(nextCount);

    if (nextCount < 3) {
      setSampleMessage(`Sample ${nextCount}/3 captured. Keep face steady.`);
    } else {
      setSampleMessage('3 samples captured. Fill in details and tap Save Enrollment.');
    }
  }, [sampleCount, captureFrame, captureDetectedFace, engine]);

  // ── Run full enrollment ───────────────────────────────────────────────────
  const saveEnrollment = useCallback(async () => {
    if (samplesRef.current.length < 3 || workerName.trim().length === 0) return;

    setEnrolling(true);
    setError(null);
    setEnrolled(false);

    try {
      const profile: WorkerProfile = {
        workerId:        Date.now().toString(),
        workerName:      workerName.trim(),
        labourContractId: labourContractId.trim() || undefined,
        ppeNotes:        ppeNotes.trim() || undefined,
        enrolledAt:      Date.now(),
      };

      // engine.enrollWorker runs CLAHE preprocess → BlazeFace detect → quality check →
      // MobileFaceNet embed (3 samples) → average → privacyTransform → MMKV + in-memory store
      await engine.enrollWorker(profile, samplesRef.current);

      // Reset form
      setWorkerName('');
      setLabourContractId('');
      setPpeNotes('');
      samplesRef.current = [];
      setSampleCount(0);
      setSampleMessage('Align face and tap Capture');
      setEnrolled(true);
    } catch (enrollError) {
      setError(enrollError instanceof Error ? enrollError.message : 'Enrollment failed');
    } finally {
      setEnrolling(false);
    }
  }, [workerName, labourContractId, ppeNotes, engine]);

  const canCapture = sampleCount < 3 && !enrolling;
  const canSave    = sampleCount === 3 && workerName.trim().length > 0 && !enrolling;
  const prompt     = sampleCount < 3 ? 'Align face within frame' : 'All samples captured';

  const handleFormFocus = useCallback(() => setFormFocused(true), []);
  const handleFormBlur = useCallback(() => setFormFocused(false), []);

  return (
    <View style={styles.screen}>
      {/* ── Camera pane ──────────────────────────────────────────────────── */}
      <View style={styles.cameraPane}>
        {device && hasPermission ? (
          <CameraView
            ref={cameraRef as any}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={!enrolled}
            frameProcessor={undefined}
          />
        ) : (
          <Text style={styles.cameraLabel}>
            {hasPermission ? 'Loading camera…' : 'Camera permission required'}
          </Text>
        )}
        {detectionPaused ? (
          <View style={styles.pauseBadge}>
            <Text style={styles.pauseBadgeText}>Detection paused</Text>
          </View>
        ) : null}
        <FaceOverlay prompt={prompt} />
      </View>

      {/* ── Form ─────────────────────────────────────────────────────────── */}
      <View style={styles.form}>
        <Text style={styles.title}>Worker Enrollment</Text>

        <Text style={styles.sampleStatus}>{sampleMessage}</Text>

        {/* Sample progress indicators */}
        <View style={styles.sampleRow}>
          {[1, 2, 3].map((n) => (
            <Text
              key={n}
              style={[styles.sample, sampleCount >= n ? styles.sampleAccepted : styles.samplePending]}
            >
              {sampleCount >= n ? `✓ S${n}` : `S${n}`}
            </Text>
          ))}
        </View>

        <Pressable
          style={[styles.secondaryButton, !canCapture ? styles.disabledButton : null]}
          disabled={!canCapture}
          onPress={captureSample}
        >
          <Text style={styles.secondaryButtonText}>
            {sampleCount >= 3 ? 'All Samples Captured' : `Capture Sample ${sampleCount + 1}/3`}
          </Text>
        </Pressable>

        <TextInput
          placeholder="Worker name *"
          placeholderTextColor="#6B7280"
          style={styles.input}
          value={workerName}
          onChangeText={setWorkerName}
          onFocus={handleFormFocus}
          onBlur={handleFormBlur}
        />
        <TextInput
          placeholder="Labour contract ID (optional)"
          placeholderTextColor="#6B7280"
          style={styles.input}
          value={labourContractId}
          onChangeText={setLabourContractId}
          onFocus={handleFormFocus}
          onBlur={handleFormBlur}
        />
        <TextInput
          placeholder="PPE notes (helmet, mask, etc.)"
          placeholderTextColor="#6B7280"
          style={styles.input}
          value={ppeNotes}
          onChangeText={setPpeNotes}
          onFocus={handleFormFocus}
          onBlur={handleFormBlur}
        />

        <Pressable
          style={[styles.primaryButton, !canSave ? styles.disabledButton : null]}
          disabled={!canSave}
          onPress={saveEnrollment}
        >
          <Text style={styles.primaryButtonText}>
            {enrolling ? 'Enrolling…' : 'Save Enrollment'}
          </Text>
        </Pressable>

        {enrolled ? <Text style={styles.success}>✓ Worker enrolled successfully</Text> : null}
        {error    ? <Text style={styles.errorText}>{error}</Text>                      : null}
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
    height:          280,
    justifyContent:  'center',
    overflow:        'hidden'
  },
  cameraLabel: {
    color:    '#9CA3AF',
    fontSize: 13
  },
  pauseBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: 'absolute',
    right: 12,
    top: 12
  },
  pauseBadgeText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700'
  },
  form: {
    flex:    1,
    gap:     10,
    padding: 16
  },
  title: {
    color:      '#111827',
    fontSize:   20,
    fontWeight: '700'
  },
  sampleStatus: {
    color:    '#4B5563',
    fontSize: 13
  },
  sampleRow: {
    flexDirection: 'row',
    gap:           8
  },
  sample: {
    borderRadius: 6,
    flex:         1,
    fontSize:     12,
    fontWeight:   '700',
    padding:      10,
    textAlign:    'center'
  },
  samplePending: {
    backgroundColor: '#F3F4F6',
    color:           '#9CA3AF'
  },
  sampleAccepted: {
    backgroundColor: '#DCFCE7',
    color:           '#166534'
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor:     '#D1D5DB',
    borderRadius:    6,
    borderWidth:     1,
    color:           '#111827',
    padding:         12
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
  secondaryButton: {
    alignItems:  'center',
    borderColor:  '#2563EB',
    borderRadius: 6,
    borderWidth:  1,
    padding:      12
  },
  secondaryButtonText: {
    color:      '#2563EB',
    fontSize:   15,
    fontWeight: '700'
  },
  disabledButton: {
    opacity: 0.45
  },
  success: {
    color:      '#166534',
    fontSize:   13,
    fontWeight: '700'
  },
  errorText: {
    color:      '#B91C1C',
    fontSize:   13,
    fontWeight: '700'
  }
});

 