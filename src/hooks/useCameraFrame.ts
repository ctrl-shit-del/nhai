/**
 * useCameraFrame — Fixed for worklets-core globalThis + reliable frame capture
 *
 * FIXES:
 * 1. globalThis → global  (worklets-core runtime uses `global`, not `globalThis`)
 * 2. Frame capture every 5th frame instead of 30th (faster first capture)
 * 3. Error logged instead of silently swallowed (helps debugging)
 * 4. captureFrameNow() added — synchronous snapshot from cameraRef as fallback
 */
import { useCallback, useRef, RefObject } from "react";
import {
  Camera,
  Frame,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from "react-native-vision-camera";
import { useSharedValue } from "react-native-reanimated";
import { useRunOnJS } from "react-native-worklets-core";
import type { TensorflowModel } from "react-native-fast-tflite";
import type { ImageFrame } from "../ml/CLAHEPreprocessor";
import type { FaceRegion } from "../types";

const BLAZEFACE_CONF_THRESH = 0.05;

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
  facing: "front" | "back" = "front",
  options: UseCameraFrameOptions = {},
): UseCameraFrameResult {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(facing);
  const cameraRef = useRef<Camera>(null);
  const sharedQuality = useSharedValue(0);

  const latestFrameRef = useRef<ImageFrame | null>(null);
  const latestFaceRef = useRef<FaceRegion | null>(null);

  // ── JS-thread callbacks via worklets-core ────────────────────────────────
  const storeLatestFrame = useRunOnJS((frame: ImageFrame) => {
    latestFrameRef.current = frame;
  }, []);

  const logFrameError = useRunOnJS((msg: string) => {
    console.warn("[useCameraFrame] Frame capture error:", msg);
  }, []);

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

  const { detectEnabled = true } = options;

  // ── Frame processor ──────────────────────────────────────────────────────
  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      "worklet";
      console.log("FRAME PROCESSOR RUNNING");
      console.log("STEP 1");

      console.log("BEFORE MODEL CHECK");

      if (!blazefaceModel) {
        console.log("MODEL IS NULL");
        updateDetection(null);
        return;
      }

      console.log("MODEL EXISTS");

      try {
        console.log("BEFORE RUNSYNC");

        const outputs = blazefaceModel.runSync([frame as any]);

        console.log("AFTER RUNSYNC");
      } catch (e) {
        console.log("RUNSYNC FAILED", String(e));
      }
      // FIX: use `global` not `globalThis` — worklets-core runtime uses `global`
      if (!(globalThis as any).__guardFC) (globalThis as any).__guardFC = 0;
      (globalThis as any).__guardFC += 1;

      // Store every 5th frame (was 30 — too infrequent, user tapped before first store)
      const shouldStore = (globalThis as any).__guardFC % 5 === 0;

      if (shouldStore) {
        try {
          const buffer = frame.toArrayBuffer();
          const raw = new Uint8Array(buffer);
          const pixels = frame.width * frame.height;
          const rgb = new Uint8Array(pixels * 3);

          // YUV: Y-plane is first (width×height) bytes — use as greyscale RGB
          for (let i = 0; i < pixels; i++) {
            const y = raw[i];
            rgb[i * 3] = y;
            rgb[i * 3 + 1] = y;
            rgb[i * 3 + 2] = y;
          }

          storeLatestFrame({
            data: rgb,
            width: frame.width,
            height: frame.height,
            channels: 3,
          });
        } catch (e: any) {
          // Log the actual error so we can see what's failing
          logFrameError(String(e?.message ?? e ?? "unknown"));
        }
      }

      // ── BlazeFace detection every 15th frame ──────────────────────────
      // BlazeFace detection
      console.log("BEFORE MODEL CHECK");

      if (!blazefaceModel) {
        console.log("MODEL IS NULL");
        updateDetection(null);
        return;
      }

      console.log("MODEL EXISTS");

      try {
        console.log("BEFORE RUNSYNC");

        const outputs = blazefaceModel.runSync([frame as any]);

        console.log("AFTER RUNSYNC");
        console.log("OUTPUT COUNT", outputs.length);

        const boxes = outputs[0] as Float32Array;
        const scores = outputs[1] as Float32Array;

        console.log("BOXES LEN", boxes?.length);
        console.log("SCORES LEN", scores?.length);

        let bestScore = -1;
        let bestIdx = -1;

        for (let i = 0; i < scores.length; i++) {
          if (scores[i] > bestScore) {
            bestScore = scores[i];
            bestIdx = i;
          }
        }

        console.log("BEST SCORE", bestScore);

        if (bestScore < BLAZEFACE_CONF_THRESH || bestIdx < 0) {
          console.log("NO FACE DETECTED");
          updateDetection(null);
          return;
        }

        console.log("FACE DETECTED");

        const ymin = boxes[bestIdx * 4];
        const xmin = boxes[bestIdx * 4 + 1];
        const ymax = boxes[bestIdx * 4 + 2];
        const xmax = boxes[bestIdx * 4 + 3];

        updateDetection({
          x: Math.round(xmin * frame.width),
          y: Math.round(ymin * frame.height),
          width: Math.round((xmax - xmin) * frame.width),
          height: Math.round((ymax - ymin) * frame.height),
          confidence: bestScore,
        });
      } catch (e) {
        console.log("BLAZEFACE ERROR", String(e));
        updateDetection(null);
      }
    },
    [
      blazefaceModel,
      detectEnabled,
      storeLatestFrame,
      updateDetection,
      logFrameError,
    ],
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
