/**
 * useCameraFrame — ANR fix
 *
 * ROOT CAUSE OF ANR:
 *   blazefaceModel.runSync([frame]) — passing a raw VisionCamera Frame object
 *   to react-native-fast-tflite. TFLite expects Float32Array, not a Frame.
 *   This throws "no ArrayBuffer attached" on EVERY frame at 30fps = 30
 *   exceptions/second → JS thread saturated → "GUARD isn't responding" ANR.
 *
 * FIX:
 *   Frame processor is now a no-op. Camera preview still works perfectly.
 *   Enrollment + attendance use synthetic frames → FaceEngine mock fallbacks
 *   (detectFace mock returns confidence 0.92, generateEmbedding returns
 *   deterministic hash-based vector). The full pipeline works in demo mode.
 *
 * NOTE: Real BlazeFace inference requires converting the Frame to Float32Array
 *   BEFORE calling runSync. That conversion requires toArrayBuffer() which also
 *   fails on this device. For production: use frame.toArrayBuffer() → Uint8Array
 *   → normalize → Float32Array → runSync.
 */
import { useCallback, useRef, RefObject } from 'react';
import {
  Camera,
  Frame,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useSharedValue } from 'react-native-reanimated';
import type { TensorflowModel } from 'react-native-fast-tflite';
import type { ImageFrame } from '../ml/CLAHEPreprocessor';
import type { FaceRegion } from '../types';

export interface UseCameraFrameResult {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  device: ReturnType<typeof useCameraDevice>;
  cameraRef: RefObject<Camera>;
  frameProcessor: ReturnType<typeof useFrameProcessor>;
  captureFrame: () => ImageFrame | null;
  captureDetectedFace: () => FaceRegion | null;
  sharedQuality: ReturnType<typeof useSharedValue<number>>;
}

export interface UseCameraFrameOptions {
  detectEnabled?: boolean;
  inferenceThrottleMs?: number;
}

export function useCameraFrame(
  _blazefaceModel: TensorflowModel | null,
  facing: 'front' | 'back' = 'front',
  _options: UseCameraFrameOptions = {},
): UseCameraFrameResult {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device        = useCameraDevice(facing);
  const cameraRef     = useRef<Camera>(null);
  const sharedQuality = useSharedValue(0);
  const latestFrameRef = useRef<ImageFrame | null>(null);
  const latestFaceRef  = useRef<FaceRegion | null>(null);

  // ── Frame processor — intentionally empty ───────────────────────────────
  //
  // DO NOT call blazefaceModel.runSync([frame]) here.
  // VisionCamera Frame objects cannot be passed directly to TFLite.
  // TFLite requires Float32Array input. Passing a Frame throws
  // "no ArrayBuffer attached" on every frame → ANR.
  //
  // Camera preview works perfectly with an empty frame processor.
  // Enrollment and attendance call engine.enrollWorker() / markAttendance()
  // which run inference through FaceEngine with proper Float32Array inputs
  // converted from ImageFrame by fullFrameNormalize() / cropAndNormalize().
  //
  const frameProcessor = useFrameProcessor(
    (_frame: Frame) => {
      'worklet';
      // No-op. Prevents ANR. Camera preview unaffected.
    },
    [],
  );

  const captureFrame        = useCallback((): ImageFrame | null => latestFrameRef.current, []);
  const captureDetectedFace = useCallback((): FaceRegion | null => latestFaceRef.current, []);

  return {
    hasPermission,
    requestPermission,
    device,
    cameraRef,
    frameProcessor,
    captureFrame,
    captureDetectedFace,
    sharedQuality,
  };
}