/**
 * useCameraFrame — VisionCamera capture for enrollment / attendance.
 *
 * Android often cannot CPU-lock GPU frame buffers (toArrayBuffer fails on many
 * devices). Capture uses takeSnapshot / takePhoto and decodes JPEG on the JS thread.
 */
import { useCallback, useRef, type RefObject } from 'react';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import type { TensorflowModel } from 'react-native-fast-tflite';
import type { ImageFrame } from '../ml/CLAHEPreprocessor';
import type { FaceRegion } from '../types';
import {
  buildSyntheticImageFrame,
  jpegFileToImageFrame,
} from '../utils/frameConversion';

export interface UseCameraFrameResult {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  device: ReturnType<typeof useCameraDevice>;
  cameraRef: RefObject<Camera>;
  /** Capture a fresh frame from the camera (snapshot on Android, snapshot/photo on iOS). */
  captureFrame: () => Promise<ImageFrame>;
  captureDetectedFace: () => FaceRegion | null;
  /** True when the last captureFrame() returned a real camera image. */
  hasRealFrame: () => boolean;
}

export interface UseCameraFrameOptions {
  detectEnabled?: boolean;
  inferenceThrottleMs?: number;
  /** Snapshot first — faster for enrollment taps (default: photo first). */
  preferSnapshot?: boolean;
}

export function useCameraFrame(
  _blazefaceModel: TensorflowModel | null,
  facing: 'front' | 'back' = 'front',
  options: UseCameraFrameOptions = {},
): UseCameraFrameResult {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(facing);
  const cameraRef = useRef<Camera>(null);
  const latestFrameRef = useRef<ImageFrame | null>(null);
  const latestFaceRef = useRef<FaceRegion | null>(null);
  const hasRealFrameRef = useRef(false);
  const preferSnapshot = options.preferSnapshot ?? false;

  const captureFrame = useCallback(async (): Promise<ImageFrame> => {
    const camera = cameraRef.current;
    if (camera == null) {
      console.warn('[useCameraFrame] Camera ref not ready');
      return buildSyntheticImageFrame();
    }

    const tryDecode = async (
      path: string,
      label: string,
      source: 'photo' | 'snapshot',
    ): Promise<ImageFrame | null> => {
      const frame = await jpegFileToImageFrame(path, { facing, source });
      if (frame) {
        console.log(
          `[useCameraFrame] ${label} ${frame.width}x${frame.height} (${frame.data.length} bytes)`,
        );
      }
      return frame;
    };

    const tryPhoto = async (): Promise<ImageFrame | null> => {
      try {
        const photo = await camera.takePhoto({ enableShutterSound: false });
        return tryDecode(photo.path, 'Photo captured', 'photo');
      } catch (photoError) {
        console.warn('[useCameraFrame] takePhoto failed:', photoError);
        return null;
      }
    };

    const trySnapshot = async (): Promise<ImageFrame | null> => {
      try {
        const snapshot = await camera.takeSnapshot({ quality: 85 });
        return tryDecode(snapshot.path, 'Snapshot captured', 'snapshot');
      } catch (snapshotError) {
        console.warn('[useCameraFrame] takeSnapshot failed:', snapshotError);
        return null;
      }
    };

    const attempts = preferSnapshot
      ? [trySnapshot, tryPhoto]
      : [tryPhoto, trySnapshot];

    for (const attempt of attempts) {
      const frame = await attempt();
      if (frame) {
        latestFrameRef.current = frame;
        hasRealFrameRef.current = true;
        return frame;
      }
    }

    hasRealFrameRef.current = false;
    console.warn(
      '[GUARD] Using synthetic frame fallback — real capture unavailable',
    );
    return buildSyntheticImageFrame();
  }, [facing, preferSnapshot]);

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
    captureFrame,
    captureDetectedFace,
    hasRealFrame,
  };
}
