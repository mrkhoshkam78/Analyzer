/**
 * All decision-engine weights and thresholds — single source of truth.
 * Exact parity with logic/config.js (v11.6.0).
 */
import type { AppConfig } from '../types';

export const CONFIG: Readonly<AppConfig> = Object.freeze({
  minCandles: 30,
  minCandlesADX: 40,
  minCandlesStoch: 20,

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

  // Calibrated from score distribution (mean≈52, p90≈59)
  buyThreshold: 57,
  sellThreshold: 43,

  techWeights: Object.freeze({
    trend: 22,
    momentum: 18,
    rsi: 14,
    macd: 14,
    volatility: 10,
    structure: 12,
    volume: 10,
  }),

  engineWeights: Object.freeze({
    technical: 0.7,
    fundamental: 0.3,
  }),

  highVolPct: 7,
  lowVolPct: 3,
  highDrawdownPct: 25,

  defaultHorizonBars: 5,
  predictionAlgoVersion: 'v8.0.1-mpb-memory',
  minSamplesForLearning: 5,
  confidenceClamp: Object.freeze({ min: 0.7, max: 1.15 }),

  learningStrength: 0.25,

  entryMinRR: 1.05,
  entryMinEV_R: -0.08,
  minSamplesForKelly: 30,
  defaultRiskPct: 0.01,
  entryConfluenceMin: 0.35,
  entryEngineVersion: 'v10.0',
});

export const APP_VERSION = '12.0.1';
export const MIGRATION_BASELINE_VERSION = '11.6.0';
