import type { ImageFrame } from '../ml/CLAHEPreprocessor';
import type { FaceRegion } from '../types';

/**
 * Crops a face region from an ImageFrame and resizes it to a [size × size] square
 * using nearest-neighbour interpolation, returning a flat Float32Array in HWC layout
 * suitable for direct use as a TFLite model input tensor.
 *
 * @param frame    Source RGB ImageFrame (channels = 3) from the camera frame processor.
 * @param region   Bounding box of the detected face (from BlazeFace).
 * @param size     Target square dimension (e.g. 112 for MobileFaceNet, 80 for MiniFAS, 128 for BlazeFace full-frame).
 * @param normMin  Lower bound of normalisation range (e.g. −1 for MobileFaceNet, 0 for MiniFAS / BlazeFace).
 * @param normMax  Upper bound of normalisation range (e.g.  1 for MobileFaceNet, 1 for MiniFAS / BlazeFace).
 * @returns        Float32Array of length size * size * 3.
 */
export function cropAndNormalize(
  frame: ImageFrame,
  region: FaceRegion,
  size: number,
  normMin: number,
  normMax: number
): Float32Array {
  const out    = new Float32Array(size * size * 3);
  const scaleX = region.width  / size;
  const scaleY = region.height / size;
  const range  = normMax - normMin;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const sx = Math.min(frame.width  - 1, Math.max(0, Math.floor(region.x + col * scaleX)));
      const sy = Math.min(frame.height - 1, Math.max(0, Math.floor(region.y + row * scaleY)));
      const si = (sy * frame.width + sx) * 3;
      const di = (row * size + col) * 3;
      out[di]     = (frame.data[si]     / 255.0) * range + normMin;
      out[di + 1] = (frame.data[si + 1] / 255.0) * range + normMin;
      out[di + 2] = (frame.data[si + 2] / 255.0) * range + normMin;
    }
  }

  return out;
}

/**
 * Returns the full-frame Float32Array normalised to [normMin, normMax], used for
 * feeding an entire frame (after resize) to BlazeFace when no face region is known yet.
 */
export function fullFrameNormalize(
  frame: ImageFrame,
  size: number,
  normMin: number,
  normMax: number
): Float32Array {
  const fullRegion: FaceRegion = { x: 0, y: 0, width: frame.width, height: frame.height, confidence: 1 };
  return cropAndNormalize(frame, fullRegion, size, normMin, normMax);
}

/**
 * Converts a 4-channel pixel buffer to a 3-channel RGB Uint8Array.
 *
 * VisionCamera on iOS produces BGRA_8888 frames; on Android, RGBA_8888 is common.
 * The `isBGRA` flag controls the channel swap.
 *
 * @param buffer Raw 4-channel pixel data from Frame.toArrayBuffer().
 * @param width  Frame width in pixels.
 * @param height Frame height in pixels.
 * @param isBGRA True for iOS BGRA, false for Android RGBA.
 */
export function pixelBufferToRgb(
  buffer: Uint8Array,
  width: number,
  height: number,
  isBGRA: boolean
): Uint8Array {
  const pixels = width * height;
  const rgb    = new Uint8Array(pixels * 3);

  for (let i = 0; i < pixels; i++) {
    if (isBGRA) {
      // BGRA → RGB channel swap (iOS default)
      rgb[i * 3]     = buffer[i * 4 + 2]; // R ← B slot
      rgb[i * 3 + 1] = buffer[i * 4 + 1]; // G unchanged
      rgb[i * 3 + 2] = buffer[i * 4];     // B ← R slot
    } else {
      // RGBA — direct copy of first 3 channels
      rgb[i * 3]     = buffer[i * 4];
      rgb[i * 3 + 1] = buffer[i * 4 + 1];
      rgb[i * 3 + 2] = buffer[i * 4 + 2];
    }
  }

  return rgb;
}
