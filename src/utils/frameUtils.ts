import type { ImageFrame } from '../ml/CLAHEPreprocessor';

/** Shared max dimension for camera capture + face ML (enrollment & attendance). */
export const ML_FRAME_MAX_DIM = 640;

export function downscaleImageFrame(
  frame: ImageFrame,
  maxDim: number = ML_FRAME_MAX_DIM,
): ImageFrame {
  const scale = Math.min(1, maxDim / Math.max(frame.width, frame.height));
  if (scale >= 1) return frame;

  const dstW = Math.max(1, Math.round(frame.width * scale));
  const dstH = Math.max(1, Math.round(frame.height * scale));
  const ch = frame.channels;
  const out = new Uint8Array(dstW * dstH * ch);
  const xR = frame.width / dstW;
  const yR = frame.height / dstH;

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(frame.width - 1, Math.floor(x * xR));
      const sy = Math.min(frame.height - 1, Math.floor(y * yR));
      const src = (sy * frame.width + sx) * ch;
      const dst = (y * dstW + x) * ch;
      for (let c = 0; c < ch; c++) out[dst + c] = frame.data[src + c];
    }
  }

  return { width: dstW, height: dstH, channels: frame.channels, data: out };
}

/** Mirror horizontally so front-camera JPEG matches the live preview orientation. */
export function mirrorImageFrameHorizontally(frame: ImageFrame): ImageFrame {
  const { width, height, channels, data } = frame;
  const out = new Uint8Array(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels;
      const dst = (y * width + (width - 1 - x)) * channels;
      for (let c = 0; c < channels; c++) {
        out[dst + c] = data[src + c];
      }
    }
  }

  return { width, height, channels, data: out };
}

function rotateImageFrame180(frame: ImageFrame): ImageFrame {
  const { width, height, channels, data } = frame;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels;
      const dst = ((height - 1 - y) * width + (width - 1 - x)) * channels;
      for (let c = 0; c < channels; c++) out[dst + c] = data[src + c];
    }
  }
  return { width, height, channels, data: out };
}

function flipImageFrameVertical(frame: ImageFrame): ImageFrame {
  const { width, height, channels, data } = frame;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels;
      const dst = ((height - 1 - y) * width + x) * channels;
      for (let c = 0; c < channels; c++) out[dst + c] = data[src + c];
    }
  }
  return { width, height, channels, data: out };
}

export function rotateImageFrame90CW(frame: ImageFrame): ImageFrame {
  const { width, height, channels, data } = frame;
  const newW = height;
  const newH = width;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels;
      const nx = height - 1 - y;
      const ny = x;
      const dst = (ny * newW + nx) * channels;
      for (let c = 0; c < channels; c++) out[dst + c] = data[src + c];
    }
  }
  return { width: newW, height: newH, channels, data: out };
}

export function rotateImageFrame90CCW(frame: ImageFrame): ImageFrame {
  const { width, height, channels, data } = frame;
  const newW = height;
  const newH = width;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * channels;
      const nx = y;
      const ny = width - 1 - x;
      const dst = (ny * newW + nx) * channels;
      for (let c = 0; c < channels; c++) out[dst + c] = data[src + c];
    }
  }
  return { width: newW, height: newH, channels, data: out };
}

/** Apply standard EXIF orientation values (1–8). */
export function applyExifOrientation(frame: ImageFrame, orientation: number): ImageFrame {
  switch (orientation) {
    case 2:
      return mirrorImageFrameHorizontally(frame);
    case 3:
      return rotateImageFrame180(frame);
    case 4:
      return flipImageFrameVertical(frame);
    case 5:
      return rotateImageFrame90CW(mirrorImageFrameHorizontally(frame));
    case 6:
      return rotateImageFrame90CW(frame);
    case 7:
      return rotateImageFrame90CCW(mirrorImageFrameHorizontally(frame));
    case 8:
      return rotateImageFrame90CCW(frame);
    default:
      return frame;
  }
}

/** Force portrait-up (height >= width) so enroll/attendance share the same aspect. */
export function normalizePortraitUp(frame: ImageFrame): ImageFrame {
  if (frame.height >= frame.width) return frame;
  return rotateImageFrame90CW(frame);
}

/** Center-crop to square — removes preview aspect differences between screens. */
export function centerSquareCrop(frame: ImageFrame): ImageFrame {
  const size = Math.min(frame.width, frame.height);
  if (size === frame.width && size === frame.height) return frame;

  const x = Math.floor((frame.width - size) / 2);
  const y = Math.floor((frame.height - size) / 2);
  const ch = frame.channels;
  const out = new Uint8Array(size * size * ch);

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const src = ((y + row) * frame.width + (x + col)) * ch;
      const dst = (row * size + col) * ch;
      for (let c = 0; c < ch; c++) out[dst + c] = frame.data[src + c];
    }
  }

  return { width: size, height: size, channels: ch, data: out };
}

export interface CameraCaptureOptions {
  facing: 'front' | 'back';
  source: 'photo' | 'snapshot';
}

/**
 * Normalize a decoded camera JPEG for face ML:
 * EXIF upright → front-photo mirror → square center crop.
 */
export function prepareCameraCaptureFrame(
  frame: ImageFrame,
  exifOrientation: number,
  options: CameraCaptureOptions,
): ImageFrame {
  let result = applyExifOrientation(frame, exifOrientation);

  if (options.facing === 'front' && options.source === 'photo') {
    result = mirrorImageFrameHorizontally(result);
  }

  return centerSquareCrop(result);
}
