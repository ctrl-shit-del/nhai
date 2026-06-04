import jpeg from 'jpeg-js';
import { Platform } from 'react-native';
import type { ImageFrame } from '../ml/CLAHEPreprocessor';
import {
  ML_FRAME_MAX_DIM,
  downscaleImageFrame,
  prepareCameraCaptureFrame,
  type CameraCaptureOptions,
} from './frameUtils';
import { readJpegExifOrientation } from './jpegExif';
import { pixelBufferToRgb } from './imageUtils';

/**
 * Converts a VisionCamera frame buffer into GUARD's ImageFrame (RGB Uint8Array).
 */
export function arrayBufferToImageFrame(
  buffer: ArrayBuffer,
  width: number,
  height: number,
): ImageFrame | null {
  if (width <= 0 || height <= 0) return null;

  const bytes = new Uint8Array(buffer);
  const rgbSize = width * height * 3;
  const rgbaSize = width * height * 4;

  if (bytes.length === rgbSize) {
    return { width, height, channels: 3, data: bytes };
  }

  // BGRA (iOS) / RGBA (Android) — common VisionCamera pixel formats
  if (bytes.length === rgbaSize) {
    const data = pixelBufferToRgb(bytes, width, height, Platform.OS === 'ios');
    return { width, height, channels: 3, data };
  }

  // NV21 / YUV420 — common when pixelFormat is not rgb
  const yuvSize = Math.floor(width * height * 1.5);
  if (bytes.length >= yuvSize && bytes.length < rgbaSize) {
    const data = yuv420ToRgb(bytes, width, height);
    return { width, height, channels: 3, data };
  }

  console.warn(
    `[frameConversion] Unexpected buffer size ${bytes.length} for ${width}x${height}`,
  );
  return null;
}

/** NV21 (Android default) → interleaved RGB. */
function yuv420ToRgb(yuv: Uint8Array, width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  const frameSize = width * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const yIndex = y * width + x;
      const uvIndex = frameSize + (y >> 1) * width + (x & ~1);
      const Y = yuv[yIndex];
      const V = yuv[uvIndex];
      const U = yuv[uvIndex + 1];

      const r = clampByte(Y + 1.402 * (V - 128));
      const g = clampByte(Y - 0.344 * (U - 128) - 0.714 * (V - 128));
      const b = clampByte(Y + 1.772 * (U - 128));

      const rgbIndex = yIndex * 3;
      rgb[rgbIndex] = r;
      rgb[rgbIndex + 1] = g;
      rgb[rgbIndex + 2] = b;
    }
  }

  return rgb;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Deterministic fallback when real camera buffers are unavailable. */
export function buildSyntheticImageFrame(salt = Date.now() % 256): ImageFrame {
  const w = 112;
  const h = 112;
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < data.length; i++) {
    data[i] = ((i + salt) % 200) + 28;
  }
  return { data, width: w, height: h, channels: 3 };
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

/** Decode a JPEG file from VisionCamera takeSnapshot / takePhoto into RGB ImageFrame. */
export async function jpegFileToImageFrame(
  path: string,
  captureOptions?: CameraCaptureOptions,
): Promise<ImageFrame | null> {
  try {
    const response = await fetch(toFileUri(path));
    if (!response.ok) {
      console.warn(`[frameConversion] Failed to read JPEG file (${response.status}): ${path}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const exifOrientation = readJpegExifOrientation(bytes);
    const decoded = jpeg.decode(bytes, { useTArray: true });
    const { width, height, data } = decoded;

    if (width <= 0 || height <= 0 || data.length < width * height * 4) {
      return null;
    }

    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = data[i * 4];
      rgb[i * 3 + 1] = data[i * 4 + 1];
      rgb[i * 3 + 2] = data[i * 4 + 2];
    }

    let frame: ImageFrame = { width, height, channels: 3, data: rgb };

    if (captureOptions) {
      frame = prepareCameraCaptureFrame(frame, exifOrientation, captureOptions);
      if (exifOrientation !== 1) {
        console.log(
          `[frameConversion] EXIF orient=${exifOrientation} → ${frame.width}x${frame.height}`,
        );
      }
    }

    return downscaleImageFrame(frame, ML_FRAME_MAX_DIM);
  } catch (decodeError) {
    console.warn('[frameConversion] JPEG decode failed:', decodeError);
    return null;
  }
}
