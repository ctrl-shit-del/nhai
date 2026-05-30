export const GUARD_THRESHOLDS = {
  recognition: 0.72,
  highConfidence: 0.85,
  mediumConfidence: 0.72,
  faceQuality: 0.6,
  EMBEDDING_DIM: 192,
  eyeAspectRatio: 0.22,
  mouthAspectRatio: 0.55,
  passiveSpoof: 0.35,
  gpsSiteRadiusM: 500,
  livenessTimeoutMs: 15_000,
  syncChunkSize: 50,
  purgeAfterAckMs: 24 * 60 * 60 * 1000
} as const;

export const MODEL_PATHS = {
  blazeface: 'models/blazeface.tflite',
  mobileFaceNet: 'models/mobilefacenet.tflite',
  miniFas: 'models/minifas.tflite'
} as const;

export const EMPTY_CHAIN_HASH = '0'.repeat(64);
