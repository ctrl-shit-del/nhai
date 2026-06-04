import type { FaceRegion } from '../types';

const INPUT_SIZE = 128;
const NUM_ANCHORS = 896;
const CONF_THRESH = 0.5;

const ANCHORS_CONFIG = {
  strides: [8, 16] as const,
  anchorsPerLayer: [2, 6] as const,
};

/** Precomputed anchor centres for the 128×128 BlazeFace / MediaPipe grid. */
function generateAnchors(width: number, height: number): Array<[number, number]> {
  const anchors: Array<[number, number]> = [];

  for (let layer = 0; layer < ANCHORS_CONFIG.strides.length; layer++) {
    const stride = ANCHORS_CONFIG.strides[layer];
    const anchorsNum = ANCHORS_CONFIG.anchorsPerLayer[layer];
    const gridRows = Math.floor((height + stride - 1) / stride);
    const gridCols = Math.floor((width + stride - 1) / stride);

    for (let gridY = 0; gridY < gridRows; gridY++) {
      const anchorY = stride * (gridY + 0.5);
      for (let gridX = 0; gridX < gridCols; gridX++) {
        const anchorX = stride * (gridX + 0.5);
        for (let n = 0; n < anchorsNum; n++) {
          anchors.push([anchorX, anchorY]);
        }
      }
    }
  }

  return anchors;
}

const BLAZEFACE_ANCHORS = generateAnchors(INPUT_SIZE, INPUT_SIZE);

function sigmoid(value: number): number {
  if (value >= 0 && value <= 1) return value;
  return 1 / (1 + Math.exp(-value));
}

function decodeBoxInModelSpace(
  boxes: Float32Array,
  anchorIndex: number,
  valuesPerBox: number,
): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  const anchor = BLAZEFACE_ANCHORS[anchorIndex];
  if (!anchor) return null;

  const base = anchorIndex * valuesPerBox;

  // MediaPipe short-range: [dx, dy, w, h, …] offsets added to anchor (128×128 space).
  if (valuesPerBox >= 16) {
    const dx = boxes[base];
    const dy = boxes[base + 1];
    const w = boxes[base + 2];
    const h = boxes[base + 3];
    const cx = anchor[0] + dx;
    const cy = anchor[1] + dy;
    return {
      xMin: cx - w / 2,
      yMin: cy - h / 2,
      xMax: cx + w / 2,
      yMax: cy + h / 2,
    };
  }

  // TFJS BlazeFace: [logit, dy, dx, h, w, …]
  if (valuesPerBox >= 5) {
    const dy = boxes[base + 1];
    const dx = boxes[base + 2];
    const h = boxes[base + 3];
    const w = boxes[base + 4];
    const cx = anchor[0] + dx;
    const cy = anchor[1] + dy;
    const wNorm = w / INPUT_SIZE;
    const hNorm = h / INPUT_SIZE;
    const cxNorm = cx / INPUT_SIZE;
    const cyNorm = cy / INPUT_SIZE;
    return {
      xMin: (cxNorm - wNorm / 2) * INPUT_SIZE,
      yMin: (cyNorm - hNorm / 2) * INPUT_SIZE,
      xMax: (cxNorm + wNorm / 2) * INPUT_SIZE,
      yMax: (cyNorm + hNorm / 2) * INPUT_SIZE,
    };
  }

  // Legacy flat [ymin, xmin, ymax, xmax] normalised 0–1 fallback.
  if (valuesPerBox === 4) {
    const ymin = boxes[base];
    const xmin = boxes[base + 1];
    const ymax = boxes[base + 2];
    const xmax = boxes[base + 3];
    return {
      xMin: xmin * INPUT_SIZE,
      yMin: ymin * INPUT_SIZE,
      xMax: xmax * INPUT_SIZE,
      yMax: ymax * INPUT_SIZE,
    };
  }

  return null;
}

function isValidModelBox(box: { xMin: number; yMin: number; xMax: number; yMax: number }): boolean {
  const w = box.xMax - box.xMin;
  const h = box.yMax - box.yMin;
  return w >= 20 && h >= 20 && w <= INPUT_SIZE && h <= INPUT_SIZE && box.xMin >= -8 && box.yMin >= -8;
}

function toFaceRegion(
  box: { xMin: number; yMin: number; xMax: number; yMax: number },
  confidence: number,
  frameWidth: number,
  frameHeight: number,
): FaceRegion {
  const scaleX = frameWidth / INPUT_SIZE;
  const scaleY = frameHeight / INPUT_SIZE;

  const x = Math.max(0, Math.round(box.xMin * scaleX));
  const y = Math.max(0, Math.round(box.yMin * scaleY));
  const width = Math.min(frameWidth - x, Math.round((box.xMax - box.xMin) * scaleX));
  const height = Math.min(frameHeight - y, Math.round((box.yMax - box.yMin) * scaleY));

  return { x, y, width, height, confidence };
}

/**
 * Parse BlazeFace / MediaPipe TFLite outputs into a single face region.
 * Handles (896×16) + (896×1) MediaPipe layout and legacy flat tensors.
 */
export function parseBlazeFaceOutputs(
  output0: Float32Array,
  output1: Float32Array,
  frameWidth: number,
  frameHeight: number,
): FaceRegion | null {
  let boxes: Float32Array;
  let scores: Float32Array;
  let embeddedScores = false;

  if (output0.length % NUM_ANCHORS === 0 && output0.length >= NUM_ANCHORS * 4) {
    boxes = output0;
    scores = output1.length >= NUM_ANCHORS ? output1 : output0;
    embeddedScores = output1.length < NUM_ANCHORS;
  } else if (output1.length % NUM_ANCHORS === 0 && output1.length >= NUM_ANCHORS * 4) {
    boxes = output1;
    scores = output0.length >= NUM_ANCHORS ? output0 : output1;
    embeddedScores = output0.length < NUM_ANCHORS;
  } else {
    return parseLegacyFlatOutputs(output0, output1, frameWidth, frameHeight);
  }

  const valuesPerBox = boxes.length / NUM_ANCHORS;
  let best: FaceRegion | null = null;
  let bestScore = CONF_THRESH;

  for (let i = 0; i < NUM_ANCHORS; i++) {
    let score = embeddedScores && valuesPerBox >= 5
      ? sigmoid(boxes[i * valuesPerBox])
      : sigmoid(scores[i] ?? scores[i * (scores.length / NUM_ANCHORS)]);

    if (score < CONF_THRESH) continue;

    const decoded = decodeBoxInModelSpace(boxes, i, valuesPerBox);
    if (!decoded || !isValidModelBox(decoded)) continue;

    if (score > bestScore) {
      bestScore = score;
      best = toFaceRegion(decoded, score, frameWidth, frameHeight);
    }
  }

  return best;
}

function parseLegacyFlatOutputs(
  boxes: Float32Array,
  scores: Float32Array,
  frameWidth: number,
  frameHeight: number,
): FaceRegion | null {
  const count = Math.min(Math.floor(boxes.length / 4), scores.length);
  let bestScore = CONF_THRESH;
  let best: FaceRegion | null = null;

  for (let i = 0; i < count; i++) {
    const score = sigmoid(scores[i]);
    if (score < CONF_THRESH) continue;

    const ymin = boxes[i * 4];
    const xmin = boxes[i * 4 + 1];
    const ymax = boxes[i * 4 + 2];
    const xmax = boxes[i * 4 + 3];

    best = {
      x: Math.round(xmin * frameWidth),
      y: Math.round(ymin * frameHeight),
      width: Math.round((xmax - xmin) * frameWidth),
      height: Math.round((ymax - ymin) * frameHeight),
      confidence: score,
    };
    bestScore = score;
    break;
  }

  return best;
}
