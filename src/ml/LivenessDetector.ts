import { GUARD_THRESHOLDS } from '../config/constants';
import { LivenessChallenge, LivenessSession } from '../types';
import { sha256Placeholder } from '../utils/hash';
import { ImageFrame } from './CLAHEPreprocessor';

export class LivenessDetector {
  createSession(seed = Date.now().toString()): LivenessSession {
    const pool: LivenessChallenge[] = ['BLINK', 'SMILE', 'HEAD_LEFT', 'HEAD_RIGHT'];
    const hash = sha256Placeholder(seed);
    const challenges = Array.from({ length: 2 }, (_, index) => pool[parseInt(hash[index], 16) % pool.length]);
    const startedAt = Date.now();

    return {
      id: `ls_${Date.now()}_${hash.slice(0, 6)}`,
      challenges,
      startedAt,
      expiresAt: startedAt + GUARD_THRESHOLDS.livenessTimeoutMs,
      activePassed: false,
      passivePassed: false,
      spoofScore: 1,
      timedOut: false
    };
  }

  evaluateActive(session: LivenessSession, completed: LivenessChallenge[]): LivenessSession {
    const timedOut = Date.now() > session.expiresAt;
    const activePassed = session.challenges.every((challenge) => completed.includes(challenge));
    return {
      ...session,
      timedOut,
      activePassed: !timedOut && activePassed,
      completedAt: !timedOut && activePassed && session.passivePassed ? Date.now() : session.completedAt
    };
  }

  // NOTE: Production implementation should replace this heuristic with
  // MiniFAS TFLite inference via react-native-fast-tflite.
  // Model: minivision-tech/Silent-Face-Anti-Spoofing (minifas.tflite ~1MB)
  // Input: 80x80 RGB Float32Array normalized to [0,1]
  // Output: [spoof_prob, real_prob] — use scores[1] as passivePassed signal
  async evaluatePassive(session: LivenessSession, frame: ImageFrame): Promise<LivenessSession> {
    const timedOut = Date.now() > session.expiresAt;
    const data = frame.data;
    const pixelCount = Math.max(1, data.length / 3);

    // Signal 1: mean luminance (real faces ~100-160, blank/overexposed fail)
    let lumSum = 0;
    for (let i = 0; i < data.length; i += 3) {
      lumSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const meanLum = lumSum / pixelCount;
    const lumScore = (meanLum > 60 && meanLum < 200) ? 1.0 : 0.2;

    // Signal 2: local variance (printed photos have low spatial variance)
    let varSum = 0;
    const sampleStep = Math.max(1, Math.floor(data.length / (300 * 3))) * 3;
    let sampleCount = 0;
    for (let i = 0; i < data.length - sampleStep; i += sampleStep) {
      const diff = data[i] - data[i + sampleStep];
      varSum += diff * diff;
      sampleCount++;
    }
    const localVariance = varSum / Math.max(1, sampleCount);
    const varianceScore = Math.min(1.0, localVariance / 800);

    // Signal 3: color channel separation (screens show unnatural channel ratios)
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    for (let i = 0; i < data.length; i += 3) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
    }
    const rMean = rSum / pixelCount;
    const gMean = gSum / pixelCount;
    const bMean = bSum / pixelCount;
    const channelSpread = Math.max(rMean, gMean, bMean) - Math.min(rMean, gMean, bMean);
    const colorScore = (channelSpread > 8 && channelSpread < 80) ? 1.0 : 0.4;

    // Weighted combination — tune weights toward real-face characteristics
    const spoofScore = Number(
      (1.0 - (lumScore * 0.3 + varianceScore * 0.5 + colorScore * 0.2)).toFixed(3)
    );
    const passivePassed = !timedOut && spoofScore <= GUARD_THRESHOLDS.passiveSpoof;

    return {
      ...session,
      timedOut,
      spoofScore,
      passivePassed,
      completedAt: session.activePassed && passivePassed ? Date.now() : session.completedAt
    };
  }

  isComplete(session: LivenessSession): boolean {
    return !session.timedOut && session.activePassed && session.passivePassed;
  }

  /**
   * Evaluates passive liveness directly from a MiniFAS TFLite model spoof score.
   *
   * Use this instead of `evaluatePassive()` when MiniFAS inference runs via
   * react-native-fast-tflite and returns `[spoof_prob, real_prob]` output tensors.
   *
   * @param session   The active-checked liveness session.
   * @param spoofScore Normalised spoof probability where 0 = definitely real,
   *                   1 = definitely spoofed (derived as `1 − scores[1]` from the model).
   */
  evaluatePassiveFromScore(session: LivenessSession, spoofScore: number): LivenessSession {
    const timedOut     = Date.now() > session.expiresAt;
    const passivePassed = !timedOut && spoofScore <= GUARD_THRESHOLDS.passiveSpoof;
    return {
      ...session,
      timedOut,
      spoofScore,
      passivePassed,
      completedAt: session.activePassed && passivePassed ? Date.now() : session.completedAt,
    };
  }
}
