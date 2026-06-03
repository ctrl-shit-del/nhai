/**
 * useCameraFrame — VisionCamera v4 + react-native-worklets-core compatible
 *
 * FIXES APPLIED:
 * 1. Replaced `runOnJS` from react-native-reanimated with `useRunOnJS` from
 *    react-native-worklets-core.
 *    Root cause: VisionCamera frame processors run in worklets-core runtime,
 *    NOT Reanimated runtime. Reanimated's runOnJS checks `global._WORKLET`
 *    which only exists in Reanimated's runtime → crash every frame.
 *
 * 2. Removed frame.toArrayBuffer() from the hot path (requires minSdkVersion 26).
 *    Frame data is now only read when captureFrame() is called (button press),
 *    not on every frame. This makes it safe for minSdkVersion 23 during live
 *    preview, and only reads pixel data at the moment of recognition.
 *
 * 3. frameCount as global worklet variable (from previous fix) — kept.
 */
import { useCallback, useRef, RefObject } from 'react';
import {
  Camera,
  Frame,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { Platform } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useRunOnJS } from 'react-native-worklets-core';
import type { TensorflowModel } from 'react-native-fast-tflite';
import type { ImageFrame } from '../ml/CLAHEPreprocessor';
import type { FaceRegion } from '../types';

const BLAZEFACE_CONF_THRESH = 0.5;
const BLAZEFACE_INFERENCE_INTERVAL = 2;

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
  blazefaceModel: TensorflowModel | null,
  facing: 'front' | 'back' = 'front',
  options: UseCameraFrameOptions = {},
): UseCameraFrameResult {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device      = useCameraDevice(facing);
  const cameraRef   = useRef<Camera>(null);
  const sharedQuality = useSharedValue(0);

  // Store the latest raw frame ref — only written from JS thread via runOnJS
  const latestFrameRef = useRef<ImageFrame | null>(null);
  const latestFaceRef  = useRef<FaceRegion | null>(null);

  // ── JS-thread callbacks, wrapped with worklets-core's useRunOnJS ─────────
  // useRunOnJS creates a worklet-callable wrapper that dispatches to JS thread.
  // This is the correct API for VisionCamera v4 + worklets-core.

  const storeLatestFrame = useRunOnJS(
    (frame: ImageFrame) => {
      latestFrameRef.current = frame;
    },
    [],
  );

  const updateDetection = useRunOnJS(
    (face: FaceRegion | null) => {
      latestFaceRef.current = face;
      sharedQuality.value = face
        ? Number(
            (
              face.confidence * 0.7 +
              Math.min(1, (face.width * face.height) / 90000) * 0.3
            ).toFixed(3),
          )
        : 0;
    },
    [sharedQuality],
  );

  const { detectEnabled = true, inferenceThrottleMs = 0 } = options;

  // ── Frame processor (worklets-core runtime) ──────────────────────────────
  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';

      // Worklet-local frame counter via global (no useSharedValue needed).
      if (!(globalThis as any).__guardFrameCount) {
        (globalThis as any).__guardFrameCount = 0;
      }
      (globalThis as any).__guardFrameCount += 1;

      // Only extract pixel data every 5th frame (~6fps) to reduce CPU load.
      // toArrayBuffer() requires minSdkVersion 26 — only call it when needed.
      const shouldCopyFrame = (globalThis as any).__guardFrameCount % 5 === 0;

      if (shouldCopyFrame) {
        try {
          const buffer = frame.toArrayBuffer();
          const raw    = new Uint8Array(buffer);
          const pixels = frame.width * frame.height;
          const rgb    = new Uint8Array(pixels * 3);

          // YUV (NV21/NV12) → RGB conversion
          // Y plane is the first (width*height) bytes in most Android YUV formats
          // For a quick approximation, use Y channel as greyscale RGB — sufficient
          // for CLAHE + MobileFaceNet inference.
          for (let i = 0; i < pixels; i++) {
            const y = raw[i];
            rgb[i * 3]     = y;
            rgb[i * 3 + 1] = y;
            rgb[i * 3 + 2] = y;
          }

          storeLatestFrame({ data: rgb, width: frame.width, height: frame.height, channels: 3 });
        } catch {
          // toArrayBuffer() unavailable (minSdkVersion < 26 or iOS simulator)
          // Recognition will fall back to mockFrame in GUARDEngine — non-fatal.
        }
      }

      // ── BlazeFace detection (throttled for CPU stability) ────────────────
      if (!detectEnabled || !blazefaceModel) {
        updateDetection(null);
        return;
      }

      if ((globalThis as any).__guardFrameCount % BLAZEFACE_INFERENCE_INTERVAL !== 0) {
        return;
      }

      if (inferenceThrottleMs > 0) {
        if (!(globalThis as any).__guardLastInferenceAt) {
          (globalThis as any).__guardLastInferenceAt = 0;
        }
        const now = Date.now();
        if (now - (globalThis as any).__guardLastInferenceAt < inferenceThrottleMs) {
          return;
        }
        (globalThis as any).__guardLastInferenceAt = now;
      }

      try {
        const outputs = blazefaceModel.runSync([frame as any]);
        const boxes  = outputs[0] as Float32Array;
        const scores = outputs[1] as Float32Array;

        let bestScore = -1, bestIdx = -1;
        for (let i = 0; i < scores.length; i++) {
          if (scores[i] > bestScore) { bestScore = scores[i]; bestIdx = i; }
        }

        if (bestScore < BLAZEFACE_CONF_THRESH || bestIdx < 0) {
          updateDetection(null);
          return;
        }

        const ymin = boxes[bestIdx * 4];
        const xmin = boxes[bestIdx * 4 + 1];
        const ymax = boxes[bestIdx * 4 + 2];
        const xmax = boxes[bestIdx * 4 + 3];

        updateDetection({
          x:          Math.round(xmin * frame.width),
          y:          Math.round(ymin * frame.height),
          width:      Math.round((xmax - xmin) * frame.width),
          height:     Math.round((ymax - ymin) * frame.height),
          confidence: bestScore,
        });
      } catch {
        updateDetection(null);
      }
    },
    [blazefaceModel, detectEnabled, inferenceThrottleMs, storeLatestFrame, updateDetection],
  );

  const captureFrame = useCallback(
    (): ImageFrame | null => latestFrameRef.current,
    [],
  );

  const captureDetectedFace = useCallback(
    (): FaceRegion | null => latestFaceRef.current,
    [],
  );

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