/** Shared domain types — OMA v12 migration */

export type Timeframe = '1D' | '4H' | '1H' | '1W' | string;

export type Signal = 'BUY' | 'SELL' | 'HOLD';

export type AssetCategory = 'metals' | 'commodity' | 'forex' | 'stocks' | string;

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  /** epoch ms */
  ts?: number;
  /** YYYY-MM-DD */
  day?: string;
  /** HH:MM:SS for intraday */
  t?: string;
}

export interface SymbolMeta {
  symbol: string;
  name: string;
  category: AssetCategory;
  /** display decimals */
  digits?: number;
  tickSize?: number;
  spreadTypical?: number;
  custom?: boolean;
}

export interface MacdConfig {
  fast: number;
  slow: number;
  signal: number;
}

export interface FibConfig {
  lookback: number;
  nearPct: number;
}

export interface TechWeights {
  trend: number;
  momentum: number;
  rsi: number;
  macd: number;
  volatility: number;
  structure: number;
  volume: number;
}

export interface EngineWeights {
  technical: number;
  fundamental: number;
}

export interface AppConfig {
  minCandles: number;
  minCandlesADX: number;
  minCandlesStoch: number;
  rsiPeriod: number;
  atrPeriod: number;
  smaFast: number;
  smaSlow: number;
  emaFast: number;
  emaSlow: number;
  emaSignal: number;
  momentumPeriod: number;
  rocPeriod: number;
  bbPeriod: number;
  bbStd: number;
  stochK: number;
  stochD: number;
  adxPeriod: number;
  lookbackSR: number;
  volumeAvgPeriod: number;
  buyThreshold: number;
  sellThreshold: number;
  techWeights: TechWeights;
  engineWeights: EngineWeights;
  highVolPct: number;
  lowVolPct: number;
  highDrawdownPct: number;
  defaultHorizonBars: number;
  predictionAlgoVersion: string;
  minSamplesForLearning: number;
  confidenceClamp: { min: number; max: number };
  learningStrength: number;
  entryMinRR: number;
  entryMinEV_R: number;
  minSamplesForKelly: number;
  defaultRiskPct: number;
  entryConfluenceMin: number;
  entryEngineVersion: string;
}

export interface Factor {
  key: string;
  dir: 'bull' | 'bear' | 'neutral' | string;
  text: string;
}

export interface TechnicalResult {
  ok: boolean;
  error?: string;
  score: number | null;
  factors: Factor[];
  indicators?: Record<string, unknown>;
  trendLabel?: string;
  [key: string]: unknown;
}

export interface DecisionResult {
  ok: boolean;
  signal: Signal;
  combinedScore: number | null;
  technicalScore: number | null;
  fundamentalScore: number | null;
  confidence: number | null;
  factors: Factor[];
  entry?: EntryResult | null;
  [key: string]: unknown;
}

export interface EntryResult {
  ok: boolean;
  mode?: string;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  rr?: number | null;
  evR?: number | null;
  reason?: string;
  [key: string]: unknown;
}

export interface BacktestMetrics {
  accuracy?: number;
  dirAcc?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  winRate?: number;
  falseSignalRate?: number;
  samples?: number;
  [key: string]: unknown;
}

export interface MpbResult {
  ok: boolean;
  regime?: string;
  confidence?: number;
  scenarios?: unknown[];
  analogues?: unknown[];
  features?: Record<string, number | null>;
  dataQuality?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AdxResult {
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
}

export interface BollingerResult {
  mid: number | null;
  upper: number | null;
  lower: number | null;
  pctB: number | null;
  width: number | null;
}

export interface StochResult {
  k: number | null;
  d: number | null;
}

export interface MacdResult {
  macd: number | null;
  signal: number | null;
  hist: number | null;
}

export interface VolumeAnalysisResult {
  avg: number | null;
  last: number | null;
  ratio: number | null;
  spike: boolean;
  weak: boolean;
  available: boolean;
}

export interface SRResult {
  support: number | null;
  resistance: number | null;
}

export interface BreakoutResult {
  up: boolean;
  down: boolean;
}

export interface FibLevels {
  levels: Record<string, number | null>;
  near?: string | null;
  swingHigh?: number | null;
  swingLow?: number | null;
  [key: string]: unknown;
}
