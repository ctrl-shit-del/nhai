/**
 * useCameraFrame — throttled VisionCamera frame capture for enrollment / attendance.
 *
 * GUARD FIX: Issue 1 — Real frames via frame processor + runOnJS (300ms throttle).
 * Avoids passing Frame objects to TFLite (ANR). Stores latest RGB ImageFrame on JS thread.
 */
import { useCallback, useRef, type RefObject } from 'react';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import {
  Camera,
  Frame,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import type { TensorflowModel } from 'react-native-fast-tflite';
import type { ImageFrame } from '../ml/CLAHEPreprocessor';
import type { FaceRegion } from '../types';
import {
  arrayBufferToImageFrame,
  buildSyntheticImageFrame,
} from '../utils/frameConversion';

export interface UseCameraFrameResult {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  device: ReturnType<typeof useCameraDevice>;
  cameraRef: RefObject<Camera>;
  frameProcessor: ReturnType<typeof useFrameProcessor>;
  /** Latest throttled frame from the camera, or synthetic fallback if none yet. */
  captureFrame: () => ImageFrame;
  captureDetectedFace: () => FaceRegion | null;
  /** True when at least one real frame has been stored from the camera. */
  hasRealFrame: () => boolean;
  sharedQuality: ReturnType<typeof useSharedValue<number>>;
}

export interface UseCameraFrameOptions {
  detectEnabled?: boolean;
  inferenceThrottleMs?: number;
}

export function useCameraFrame(
  _blazefaceModel: TensorflowModel | null,
  facing: 'front' | 'back' = 'front',
  options: UseCameraFrameOptions = {},
): UseCameraFrameResult {
  const throttleMs = options.inferenceThrottleMs ?? 300;
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(facing);
  const cameraRef = useRef<Camera>(null);
  const sharedQuality = useSharedValue(0);
  const latestFrameRef = useRef<ImageFrame | null>(null);
  const latestFaceRef = useRef<FaceRegion | null>(null);
  const hasRealFrameRef = useRef(false);
  const lastProcessTs = useSharedValue(0);

  // GUARD FIX: Issue 1 — Store frame on JS thread (called from worklet via runOnJS)
  const storeFrameOnJS = useCallback(
    (width: number, height: number, buffer: ArrayBuffer) => {
      try {
        const imageFrame = arrayBufferToImageFrame(buffer, width, height);
        if (imageFrame) {
          latestFrameRef.current = imageFrame;
          hasRealFrameRef.current = true;
          console.log(
            `[useCameraFrame] Stored frame ${width}x${height} (${imageFrame.data.length} bytes)`,
          );
        }
      } catch (storeError) {
        console.warn('[useCameraFrame] Failed to store frame on JS thread', storeError);
      }
    },
    [],
  );

  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';
      const now = Date.now();
      if (now - lastProcessTs.value < throttleMs) {
        return;
      }
      lastProcessTs.value = now;

      try {
        const buffer = frame.toArrayBuffer();
        runOnJS(storeFrameOnJS)(frame.width, frame.height, buffer);
      } catch {
        // toArrayBuffer may fail inside worklet on some devices — captureFrame uses fallback
      }
    },
    [storeFrameOnJS, throttleMs],
  );

  const captureFrame = useCallback((): ImageFrame => {
    if (latestFrameRef.current) {
      return latestFrameRef.current;
    }
    console.warn(
      '[GUARD] Using synthetic frame fallback — real capture unavailable',
    );
    return buildSyntheticImageFrame();
  }, []);

  const captureDetectedFace = useCallback(
    (): FaceRegion | null => latestFaceRef.current,
    [],
  );

  const hasRealFrame = useCallback((): boolean => hasRealFrameRef.current, []);

  return {
    hasPermission,
    requestPermission,
    device,
    cameraRef,
    frameProcessor,
    captureFrame,
    captureDetectedFace,
    hasRealFrame,
    sharedQuality,
  };
}
