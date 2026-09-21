/**
 * MPB Feature Engine
 * Builds normalized feature vectors for market state and pattern matching.
 * Reuses existing indicator functions; adds structure / position features.
 */
import { CONFIG } from '../config.js';
import {
  isNum, last, sma, ema, rsi, atr, macd, momentum, roc, volatilityPct, bollinger
} from '../indicators.js';

function safe(v, fallback = 0) {
  return isNum(v) ? v : fallback;
}

function zScore(val, mean, sd) {
  if (!isNum(val) || !isNum(sd) || sd <= 0) return 0;
  return (val - mean) / sd;
}

function percentileRank(val, arr) {
  if (!arr.length || !isNum(val)) return 50;
  let below = 0;
  for (const x of arr) if (x <= val) below++;
  return (below / arr.length) * 100;
}

/**
 * Compute rolling mean/sd for a series (last window).
 */
function rollingStats(arr, window) {
  const w = arr.slice(-window);
  if (w.length < 2) return { mean: 0, sd: 1 };
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / (w.length - 1)) || 1;
  return { mean, sd };
}

/**
 * Detect simple swing structure (HH/HL/LH/LL) over lookback.
 */
function structureFeatures(candles, lookback = 20) {
  const n = candles.length;
  if (n < lookback + 5) {
    return { hh: 0, hl: 0, lh: 0, ll: 0, bos: 0, choch: 0, compression: 0 };
  }
  const slice = candles.slice(-lookback - 5);
  let swingHighs = [];
  let swingLows = [];
  for (let i = 2; i < slice.length - 2; i++) {
    const h = slice[i].h;
    const l = slice[i].l;
    if (h > slice[i - 1].h && h > slice[i - 2].h && h >= slice[i + 1].h && h >= slice[i + 2].h) {
      swingHighs.push({ i, h });
    }
    if (l < slice[i - 1].l && l < slice[i - 2].l && l <= slice[i + 1].l && l <= slice[i + 2].l) {
      swingLows.push({ i, l });
    }
  }
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (let i = 1; i < swingHighs.length; i++) {
    if (swingHighs[i].h > swingHighs[i - 1].h) hh++;
    else lh++;
  }
  for (let i = 1; i < swingLows.length; i++) {
    if (swingLows[i].l > swingLows[i - 1].l) hl++;
    else ll++;
  }
  const ranges = slice.map(c => c.h - c.l);
  const recentRange = ranges.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const earlierRange = ranges.slice(0, 5).reduce((a, b) => a + b, 0) / 5 || 1;
  const compression = earlierRange > 0 ? recentRange / earlierRange : 1;

  // crude BOS / CHoCH
  const lastClose = last(candles).c;
  const priorHigh = Math.max(...candles.slice(-lookback, -1).map(c => c.h));
  const priorLow = Math.min(...candles.slice(-lookback, -1).map(c => c.l));
  const bos = lastClose > priorHigh ? 1 : lastClose < priorLow ? -1 : 0;
  const choch = (hh > 0 && ll > 0) || (lh > 0 && hl > 0) ? 1 : 0;

  return {
    hh, hl, lh, ll,
    bos,
    choch,
    compression: Math.min(2, Math.max(0.1, compression)),
    swingHighCount: swingHighs.length,
    swingLowCount: swingLows.length
  };
}

/**
 * Build full feature set + normalized vector for the latest bar.
 * @returns {{ features: object, vector: number[], labels: string[], qualityNote: string|null }}
 */
export function buildFeatures(candles, precomputed = null) {
  if (!candles || candles.length < CONFIG.minCandles) {
    return {
      features: null,
      vector: null,
      labels: [],
      qualityNote: 'INSUFFICIENT_HISTORY'
    };
  }

  const closes = candles.map(c => c.c);
  const highs = candles.map(c => c.h);
  const lows = candles.map(c => c.l);
  const vols = candles.map(c => (isNum(c.v) ? c.v : 0));
  const n = closes.length;
  const price = closes[n - 1];

  const rsiVal = rsi(closes, CONFIG.rsiPeriod);
  const macdRes = macd(closes);
  const atrVal = atr(candles, CONFIG.atrPeriod);
  const mom = momentum(closes, CONFIG.momentumPeriod);
  const rocVal = roc(closes, CONFIG.rocPeriod);
  const volPct = volatilityPct(candles);
  const bb = bollinger(closes);
  const e20 = ema(closes, CONFIG.smaFast);
  const e50 = ema(closes, CONFIG.smaSlow);
  const s20 = sma(closes, CONFIG.smaFast);
  const s50 = sma(closes, CONFIG.smaSlow);

  const ret1 = n > 1 && closes[n - 2] > 0 ? (price - closes[n - 2]) / closes[n - 2] : 0;
  const logRet = n > 1 && closes[n - 2] > 0 ? Math.log(price / closes[n - 2]) : 0;
  const distEma20 = e20 ? (price - e20) / e20 : 0;
  const distEma50 = e50 ? (price - e50) / e50 : 0;

  const body = Math.abs(candles[n - 1].c - candles[n - 1].o);
  const range = candles[n - 1].h - candles[n - 1].l || 1e-9;
  const upperWick = candles[n - 1].h - Math.max(candles[n - 1].o, candles[n - 1].c);
  const lowerWick = Math.min(candles[n - 1].o, candles[n - 1].c) - candles[n - 1].l;
  const bodyRatio = body / range;
  const upperRatio = upperWick / range;
  const lowerRatio = lowerWick / range;

  const struct = structureFeatures(candles);

  // volume proxy
  const volAvg = vols.slice(-CONFIG.volumeAvgPeriod).reduce((a, b) => a + b, 0) / Math.min(CONFIG.volumeAvgPeriod, vols.length) || 1;
  const volRatio = volAvg > 0 ? (vols[n - 1] || 0) / volAvg : 1;

  // normalize key series for vector
  const retSeries = [];
  for (let i = 1; i < n; i++) {
    if (closes[i - 1] > 0) retSeries.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const retStats = rollingStats(retSeries, 30);
  const atrStats = rollingStats(
    candles.slice(-40).map((c, i, a) => (i > 0 ? (c.h - c.l) / c.c : 0)),
    30
  );

  const features = {
    price,
    ret1,
    logRet,
    rsi: safe(rsiVal, 50),
    macdHist: safe(macdRes?.hist, 0),
    macdLine: safe(macdRes?.macd, 0),
    atr: safe(atrVal, 0),
    atrPct: safe(volPct, 0),
    momentum: safe(mom, 0),
    roc: safe(rocVal, 0),
    distEma20,
    distEma50,
    bbWidth: safe(bb?.width, 0),
    bbPos: bb && bb.upper !== bb.lower
      ? (price - bb.lower) / (bb.upper - bb.lower)
      : 0.5,
    bodyRatio,
    upperRatio,
    lowerRatio,
    volRatio,
    trendStrength: e20 && e50 ? (e20 - e50) / e50 : 0,
    ...struct,
    compression: struct.compression
  };

  // Normalized vector (order is fixed for matching)
  const labels = [
    'ret1_z', 'rsi_n', 'macdHist_z', 'atrPct_z', 'mom_z',
    'distEma20', 'distEma50', 'bbPos', 'bodyRatio', 'volRatio_n',
    'trendStrength', 'compression', 'bos', 'hh_n', 'hl_n'
  ];

  const vector = [
    zScore(ret1, retStats.mean, retStats.sd),
    (features.rsi - 50) / 50,
    zScore(features.macdHist, 0, Math.abs(features.macdHist) * 2 + 1e-6),
    zScore(features.atrPct, atrStats.mean * 100, atrStats.sd * 100 + 1e-6),
    zScore(features.momentum, 0, Math.abs(features.momentum) + 1e-6),
    features.distEma20 * 10,
    features.distEma50 * 10,
    features.bbPos * 2 - 1,
    features.bodyRatio * 2 - 1,
    Math.log1p(Math.max(0, features.volRatio)) - 0.5,
    features.trendStrength * 5,
    features.compression - 1,
    features.bos,
    (features.hh - features.lh) / Math.max(1, features.hh + features.lh),
    (features.hl - features.ll) / Math.max(1, features.hl + features.ll)
  ];

  return { features, vector, labels, qualityNote: null };
}

/**
 * Build a short temporal sequence of vectors for sequence matching.
 * window = number of recent bars.
 */
export function buildFeatureSequence(candles, window = 12) {
  if (!candles || candles.length < window + CONFIG.minCandles) return null;
  const seq = [];
  for (let end = candles.length - window; end < candles.length; end++) {
    const slice = candles.slice(0, end + 1);
    const { vector } = buildFeatures(slice);
    if (vector) seq.push(vector);
  }
  return seq.length === window ? seq : null;
}
