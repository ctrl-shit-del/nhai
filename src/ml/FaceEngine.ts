import type { TensorflowModel } from 'react-native-fast-tflite';
import { GUARD_THRESHOLDS } from '../config/constants';
import { FaceQuality, FaceRegion, RecognitionResult, WorkerProfile } from '../types';
import { cropAndNormalize, fullFrameNormalize } from '../utils/imageUtils';
import { sha256Placeholder } from '../utils/hash';
import { ImageFrame } from './CLAHEPreprocessor';

// ── BlazeFace model specs ──────────────────────────────────────────────────────
// Input:  Float32Array  [128 × 128 × 3] normalised [0, 1]
// Output: boxes  Float32Array  [N × 4]  (ymin, xmin, ymax, xmax) in [0, 1]
//         scores Float32Array  [N]       confidence per anchor
const BLAZEFACE_INPUT_SIZE  = 128;
const BLAZEFACE_CONF_THRESH = 0.5;

// ── MobileFaceNet model specs ──────────────────────────────────────────────────
// Input:  Float32Array  [112 × 112 × 3] normalised [−1, 1]
// Output: Float32Array  [128]           raw L2-unnormalised embedding
const MOBILEFACENET_INPUT_SIZE = 112;

export interface StoredEmbedding extends WorkerProfile {
  embedding: number[];
}

export class FaceEngine {
  private enrolled: StoredEmbedding[] = [];
  private initialized = false;

  // TFLite model instances — null until setModels() is called by GUARDEngine.
  private blazefaceModel:      TensorflowModel | null = null;
  private mobilefacenetModel:  TensorflowModel | null = null;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /**
   * Injects loaded TFLite model instances. Called by GUARDEngine after
   * loadModels() completes so the engine retains a single model lifecycle.
   */
  setModels(blazeface: TensorflowModel | null, mobilefacenet: TensorflowModel | null): void {
    this.blazefaceModel     = blazeface;
    this.mobilefacenetModel = mobilefacenet;
  }

  /**
   * Detects the primary face in a frame.
   *
   * Production path: normalises the full frame to 128×128 Float32Array and
   * runs BlazeFace TFLite inference via react-native-fast-tflite.
   *
   * Development fallback: returns a fixed-proportion mock bounding box so
   * the rest of the pipeline can be exercised without physical model files.
   */
  async detectFace(frame: ImageFrame): Promise<FaceRegion | null> {
    this.assertReady();
    if (frame.width <= 0 || frame.height <= 0 || frame.data.length === 0) return null;

    if (this.blazefaceModel) {
      try {
        // Resize entire frame to 128×128, normalise to [0, 1]
        const input  = fullFrameNormalize(frame, BLAZEFACE_INPUT_SIZE, 0, 1);
        const output = await this.blazefaceModel.run([input]);

        const boxes  = output[0] as Float32Array; // [N × 4]
        const scores = output[1] as Float32Array; // [N]

        let bestScore = -1, bestIdx = -1;
        for (let i = 0; i < scores.length; i++) {
          if (scores[i] > bestScore) { bestScore = scores[i]; bestIdx = i; }
        }

        if (bestScore < BLAZEFACE_CONF_THRESH || bestIdx < 0) return null;

        // BlazeFace boxes: [ymin, xmin, ymax, xmax] normalised
        const ymin = boxes[bestIdx * 4];
        const xmin = boxes[bestIdx * 4 + 1];
        const ymax = boxes[bestIdx * 4 + 2];
        const xmax = boxes[bestIdx * 4 + 3];

        return {
          x:          Math.round(xmin * frame.width),
          y:          Math.round(ymin * frame.height),
          width:      Math.round((xmax - xmin) * frame.width),
          height:     Math.round((ymax - ymin) * frame.height),
          confidence: bestScore,
        };
      } catch (modelError) {
        // Model error — fall through to mock
        console.warn('[FaceEngine] BlazeFace inference error:', modelError);
      }
    }

    // ── Development mock ────────────────────────────────────────────────────
    return {
      x:          Math.round(frame.width  * 0.2),
      y:          Math.round(frame.height * 0.15),
      width:      Math.round(frame.width  * 0.6),
      height:     Math.round(frame.height * 0.65),
      confidence: 0.92,
    };
  }

  assessQuality(region: FaceRegion | null): FaceQuality {
    if (!region) {
      return { score: 0, accepted: false, reasons: ['NO_FACE'] };
    }
    const areaScore = Math.min(1, (region.width * region.height) / 90_000);
    const score     = Number(((region.confidence * 0.7) + (areaScore * 0.3)).toFixed(3));
    return {
      score,
      accepted: score >= GUARD_THRESHOLDS.faceQuality,
      reasons:  score >= GUARD_THRESHOLDS.faceQuality ? [] : ['LOW_QUALITY'],
    };
  }

  /**
   * Generates a 128-dim L2-normalised face embedding for a given frame + region.
   *
   * Production path: crops the face to 112×112, normalises to [−1, 1], and
   * runs MobileFaceNet TFLite inference.
   *
   * Development fallback: deterministic SHA-256 based mock vector.
   */
  async generateEmbedding(frame: ImageFrame, region: FaceRegion): Promise<number[]> {
    this.assertReady();

    if (this.mobilefacenetModel) {
      try {
        const input  = cropAndNormalize(frame, region, MOBILEFACENET_INPUT_SIZE, -1, 1);
        const output = await this.mobilefacenetModel.run([input]);
        return this.l2Normalize(Array.from(output[0] as Float32Array));
      } catch (modelError) {
        console.warn('[FaceEngine] MobileFaceNet inference error:', modelError);
      }
    }

    // ── Development mock ────────────────────────────────────────────────────
    const seed      = sha256Placeholder({ width: frame.width, height: frame.height, region, sample: Array.from(frame.data.slice(0, 64)) });
    const embedding = Array.from({ length: 128 }, (_, index) => {
      const hex = seed[(index * 2) % seed.length] + seed[(index * 2 + 1) % seed.length];
      return (parseInt(hex, 16) / 127.5) - 1;
    });
    return this.l2Normalize(embedding);
  }

  /**
   * Converts a raw MobileFaceNet output tensor to a normalised embedding.
   * Use this when the inference runs externally (e.g. inside a frame processor)
   * and the Float32Array result is passed back to the JS thread.
   */
  embedFromFloat32(rawOutput: Float32Array): number[] {
    return this.l2Normalize(Array.from(rawOutput));
  }

  enroll(profile: WorkerProfile, embedding: number[]): void {
    this.enrolled = this.enrolled.filter((worker) => worker.workerId !== profile.workerId);
    this.enrolled.push({ ...profile, embedding: this.l2Normalize(embedding) });
  }

  match(embedding: number[], threshold: number = GUARD_THRESHOLDS.recognition): RecognitionResult | null {
    this.assertReady();
    const normalized = this.l2Normalize(embedding);
    let best: { worker: StoredEmbedding; confidence: number } | null = null;

    for (const worker of this.enrolled) {
      const confidence = this.cosineSimilarity(normalized, worker.embedding);
      if (!best || confidence > best.confidence) {
        best = { worker, confidence };
      }
    }

    if (!best || best.confidence < threshold) return null;

    return {
      workerId:       best.worker.workerId,
      workerName:     best.worker.workerName,
      confidence:     Number(best.confidence.toFixed(4)),
      tier:           best.confidence >= GUARD_THRESHOLDS.highConfidence ? 'HIGH' : best.confidence >= GUARD_THRESHOLDS.mediumConfidence ? 'MEDIUM' : 'LOW',
      embeddingHash:  sha256Placeholder(normalized),
    };
  }

  getEnrollmentCount(): number {
    return this.enrolled.length;
  }

  private cosineSimilarity(left: number[], right: number[]): number {
    return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  }

  private l2Normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / magnitude);
  }

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error('FaceEngine must be initialized before use.');
    }
  }
}
