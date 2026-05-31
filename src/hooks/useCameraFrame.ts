/**
 * useCameraFrame
 *
 * Manages camera permission, device selection and a VisionCamera v4 frame
 * processor that continuously runs BlazeFace detection on every frame.
 *
 * Architecture
 * ────────────
 * ┌──────────────────────────────────────────────────────────────┐
 * │  VisionCamera frame processor (worklet thread)               │
 * │  ┌─────────────┐    ┌────────────────┐                      │
 * │  │  toArrayBuffer│ → │ BGRA→RGB conv. │ → storeLatestFrame  │
 * │  └─────────────┘    └────────────────┘                      │
 * │  If blazefaceModel available:                                │
 * │  ┌──────────────────────────────┐                           │
 * │  │ blazeface.runSync([frame]) → │ → updateDetection         │
 * │  └──────────────────────────────┘  (FaceRegion | null)      │
 * └──────────────────────────────────────────────────────────────┘
 *           ↓ runOnJS (lightweight data only)
 * ┌──────────────────────────────────────────────────────────────┐
 * │  React JS thread                                             │
 * │  latestFrameRef  ← raw RGB ImageFrame (updated every 5th)   │
 * │  sharedFaceRegion, sharedQuality (Reanimated shared values)  │
 * └──────────────────────────────────────────────────────────────┘
 *           ↓ on button tap
 * ┌──────────────────────────────────────────────────────────────┐
 * │  GUARDEngine.markAttendance(captureFrame(), gps)             │
 * │  → MobileFaceNet inference (JS async)                       │
 * │  → MiniFAS inference (JS async)                             │
 * └──────────────────────────────────────────────────────────────┘
 */
import { useCallback, useRef, RefObject } from "react";
import {
  Camera,
  Frame,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from "react-native-vision-camera";
import { Platform } from "react-native";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import type { TensorflowModel } from "react-native-fast-tflite";
import type { ImageFrame } from "../ml/CLAHEPreprocessor";
import type { FaceRegion } from "../types";

const BLAZEFACE_CONF_THRESH = 0.5;

export interface UseCameraFrameResult {
  /** Whether camera permission has been granted. */
  hasPermission: boolean;
  /** Prompts the OS camera permission dialog. */
  requestPermission: () => Promise<boolean>;
  /** Best available camera device for the requested facing. */
  device: ReturnType<typeof useCameraDevice>;
  /** Ref to mount on the <Camera> component for imperative operations. */
  cameraRef: RefObject<Camera>;
  /** Frame processor to pass to <Camera frameProcessor={…}>. */
  frameProcessor: ReturnType<typeof useFrameProcessor>;
  /** Returns the latest stored raw RGB ImageFrame (updated ~6/s). */
  captureFrame: () => ImageFrame | null;
  /** Returns the latest BlazeFace detection result (or null if no face). */
  captureDetectedFace: () => FaceRegion | null;
  /**
   * Reanimated shared value for the quality score (0–1) of the latest detected face.
   * Suitable for animating the FaceOverlay border color without JS round-trips.
   */
  sharedQuality: ReturnType<typeof useSharedValue<number>>;
}

/**
 * @param blazefaceModel  Loaded BlazeFace TFLite model from GUARDEngine.models.blazeface.
 *                        Pass null during initialization; the frame processor degrades
 *                        gracefully by skipping detection.
 * @param facing          'front' (default) for attendance / enrollment.
 */
export function useCameraFrame(
  blazefaceModel: TensorflowModel | null,
  facing: "front" | "back" = "front",
): UseCameraFrameResult {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(facing);
  const cameraRef = useRef<Camera>(null);

  // ── Shared state between worklet and JS threads ──────────────────────────

  const sharedQuality = useSharedValue(0);

  // Raw frame stored in a plain ref — accessed only from the JS thread
  const latestFrameRef = useRef<ImageFrame | null>(null);
  const latestFaceRef = useRef<FaceRegion | null>(null);

  // Frame counter for throttling raw-frame storage (every 5th frame ≈ 6 fps @ 30 fps)
  const frameCount = useSharedValue(0);

  // ── Worklet → JS callbacks ───────────────────────────────────────────────
  const storeLatestFrame = useCallback((frame: ImageFrame) => {
    latestFrameRef.current = frame;
  }, []);

  const updateDetection = useCallback(
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

  // ── Frame processor (runs on VisionCamera's worklet thread) ─────────────
  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      "worklet";

      frameCount.value += 1;
      const shouldStoreFrame = frameCount.value % 5 === 0;

      // Convert 4-channel pixel buffer to RGB Uint8Array
      // On iOS, VisionCamera produces BGRA_8888. On Android, RGBA_8888 is common.
      if (shouldStoreFrame) {
        const buffer = frame.toArrayBuffer();
        const raw = new Uint8Array(buffer);
        const pixels = frame.width * frame.height;
        const isBGRA = Platform.OS === "ios";
        const rgb = new Uint8Array(pixels * 3);

        for (let i = 0; i < pixels; i++) {
          if (isBGRA) {
            rgb[i * 3] = raw[i * 4 + 2]; // R
            rgb[i * 3 + 1] = raw[i * 4 + 1]; // G
            rgb[i * 3 + 2] = raw[i * 4]; // B
          } else {
            rgb[i * 3] = raw[i * 4];
            rgb[i * 3 + 1] = raw[i * 4 + 1];
            rgb[i * 3 + 2] = raw[i * 4 + 2];
          }
        }

        runOnJS(storeLatestFrame)({
          data: rgb,
          width: frame.width,
          height: frame.height,
          channels: 3,
        });
      }

      // ── BlazeFace detection ──────────────────────────────────────────────
      if (!blazefaceModel) {
        runOnJS(updateDetection)(null);
        return;
      }

      try {
        // react-native-fast-tflite accepts VisionCamera Frame directly and
        // resizes to the model's expected input dimensions automatically.
        const outputs = blazefaceModel.runSync([frame as any]);
        const boxes = outputs[0] as Float32Array; // [N × 4]  ymin xmin ymax xmax
        const scores = outputs[1] as Float32Array; // [N]

        let bestScore = -1,
          bestIdx = -1;
        for (let i = 0; i < scores.length; i++) {
          if (scores[i] > bestScore) {
            bestScore = scores[i];
            bestIdx = i;
          }
        }

        if (bestScore < BLAZEFACE_CONF_THRESH || bestIdx < 0) {
          runOnJS(updateDetection)(null);
          return;
        }

        const ymin = boxes[bestIdx * 4];
        const xmin = boxes[bestIdx * 4 + 1];
        const ymax = boxes[bestIdx * 4 + 2];
        const xmax = boxes[bestIdx * 4 + 3];

        runOnJS(updateDetection)({
          x: Math.round(xmin * frame.width),
          y: Math.round(ymin * frame.height),
          width: Math.round((xmax - xmin) * frame.width),
          height: Math.round((ymax - ymin) * frame.height),
          confidence: bestScore,
        });
      } catch {
        runOnJS(updateDetection)(null);
      }
    },
    [blazefaceModel, frameCount, storeLatestFrame, updateDetection],
  );

  // ── JS-thread accessors ──────────────────────────────────────────────────

  /** Snapshots the latest raw RGB frame (updated every ~5th camera frame). */
  const captureFrame = useCallback(
    (): ImageFrame | null => latestFrameRef.current,
    [],
  );

  /** Returns the latest BlazeFace bounding-box result. */
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
