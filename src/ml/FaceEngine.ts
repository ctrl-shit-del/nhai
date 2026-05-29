import { GUARD_THRESHOLDS } from '../config/constants';
import { FaceQuality, FaceRegion, RecognitionResult, WorkerProfile } from '../types';
import { sha256Placeholder } from '../utils/hash';
import { ImageFrame } from './CLAHEPreprocessor';

export interface StoredEmbedding extends WorkerProfile {
  embedding: number[];
}

export class FaceEngine {
  private enrolled: StoredEmbedding[] = [];
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  detectFace(frame: ImageFrame): FaceRegion | null {
    this.assertReady();
    if (frame.width <= 0 || frame.height <= 0 || frame.data.length === 0) return null;

    return {
      x: Math.round(frame.width * 0.2),
      y: Math.round(frame.height * 0.15),
      width: Math.round(frame.width * 0.6),
      height: Math.round(frame.height * 0.65),
      confidence: 0.92
    };
  }

  assessQuality(region: FaceRegion | null): FaceQuality {
    if (!region) {
      return { score: 0, accepted: false, reasons: ['NO_FACE'] };
    }

    const areaScore = Math.min(1, (region.width * region.height) / 90_000);
    const score = Number(((region.confidence * 0.7) + (areaScore * 0.3)).toFixed(3));

    return {
      score,
      accepted: score >= GUARD_THRESHOLDS.faceQuality,
      reasons: score >= GUARD_THRESHOLDS.faceQuality ? [] : ['LOW_QUALITY']
    };
  }

  async generateEmbedding(frame: ImageFrame, region: FaceRegion): Promise<number[]> {
    this.assertReady();
    const seed = sha256Placeholder({ width: frame.width, height: frame.height, region, sample: Array.from(frame.data.slice(0, 64)) });
    const embedding = Array.from({ length: 128 }, (_, index) => {
      const hex = seed[(index * 2) % seed.length] + seed[(index * 2 + 1) % seed.length];
      return (parseInt(hex, 16) / 127.5) - 1;
    });

    return this.l2Normalize(embedding);
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
      workerId: best.worker.workerId,
      workerName: best.worker.workerName,
      confidence: Number(best.confidence.toFixed(4)),
      tier: best.confidence >= GUARD_THRESHOLDS.highConfidence ? 'HIGH' : best.confidence >= GUARD_THRESHOLDS.mediumConfidence ? 'MEDIUM' : 'LOW',
      embeddingHash: sha256Placeholder(normalized)
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
