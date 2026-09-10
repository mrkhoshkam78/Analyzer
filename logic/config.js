/**
 * تمام وزن‌ها و آستانه‌های موتور تصمیم — یک نقطه تنظیم
 */
export const CONFIG = Object.freeze({
  minCandles: 30,
  minCandlesADX: 40,
  minCandlesStoch: 20,

  // Technical periods
  rsiPeriod: 14,
  atrPeriod: 14,
  smaFast: 20,
  smaSlow: 50,
  emaFast: 12,
  emaSlow: 26,
  emaSignal: 9,
  momentumPeriod: 10,
  rocPeriod: 12,
  bbPeriod: 20,
  bbStd: 2,
  stochK: 14,
  stochD: 3,
  adxPeriod: 14,
  lookbackSR: 20,
  volumeAvgPeriod: 20,

  // Decision thresholds (score 0–100)
  buyThreshold: 62,
  sellThreshold: 38,

  // Technical component weights (sum ≈ 100 for normalization reference)
  techWeights: Object.freeze({
    trend: 22,
    momentum: 18,
    rsi: 14,
    macd: 14,
    volatility: 10,
    structure: 12, // S/R + breakout
    volume: 10
  }),

  // Combined engine weights
  engineWeights: Object.freeze({
    technical: 0.7,
    fundamental: 0.3 // only applied when fundamental data exists
  }),

  // Risk
  highVolPct: 7,
  lowVolPct: 3,
  highDrawdownPct: 25,

  // Prediction
  defaultHorizonBars: 5,
  predictionAlgoVersion: 'v2.1-hybrid',
  minSamplesForLearning: 5,
  confidenceClamp: Object.freeze({ min: 0.7, max: 1.15 }),

  // Learning: how much past accuracy shifts confidence
  learningStrength: 0.25
});
