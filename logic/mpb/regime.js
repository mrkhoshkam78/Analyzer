/**
 * MPB Market Regime Engine
 * Multi-factor regime classification (not single-indicator).
 * Complements existing logic/regime.js; does not replace it.
 */
import { CONFIG } from '../config.js';
import { isNum, last, ema, atr, volatilityPct, adx } from '../indicators.js';
import { buildFeatures } from './features.js';

const REGIMES = [
  'BullTrend', 'BearTrend', 'Sideways',
  'HighVol', 'LowVol', 'Compression', 'Expansion',
  'Breakout', 'Reversal', 'Accumulation', 'Distribution', 'Unclear'
];

/**
 * @param {Array} candles
 * @param {object|null} preFeatures
 * @returns {{ primary: string, secondary: string[], confidence: number, scores: object, details: object }}
 */
export function detectMPBRegime(candles, preFeatures = null) {
  const result = {
    primary: 'Unclear',
    secondary: [],
    confidence: 0.3,
    scores: {},
    details: {}
  };

  if (!candles || candles.length < CONFIG.minCandles) {
    return result;
  }

  const feat = preFeatures || buildFeatures(candles).features;
  if (!feat) return result;

  const closes = candles.map(c => c.c);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const adxRes = adx(candles, 14);
  const atrPct = volatilityPct(candles);
  const adxVal = adxRes?.adx ?? 0;
  const plusDI = adxRes?.plusDI ?? 0;
  const minusDI = adxRes?.minusDI ?? 0;

  const trendUp = e20 && e50 && e20 > e50 && feat.distEma20 > 0;
  const trendDown = e20 && e50 && e20 < e50 && feat.distEma20 < 0;
  const strongTrend = adxVal >= 25;
  const highVol = atrPct != null && atrPct > 2.5;
  const lowVol = atrPct != null && atrPct < 0.9;
  const compressing = feat.compression < 0.7;
  const expanding = feat.compression > 1.35;
  const breakoutUp = feat.bos === 1;
  const breakoutDown = feat.bos === -1;
  const hhHl = feat.hh >= 1 && feat.hl >= 1;
  const lhLl = feat.lh >= 1 && feat.ll >= 1;

  const scores = {
    BullTrend: 0,
    BearTrend: 0,
    Sideways: 0,
    HighVol: 0,
    LowVol: 0,
    Compression: 0,
    Expansion: 0,
    Breakout: 0,
    Reversal: 0,
    Accumulation: 0,
    Distribution: 0
  };

  if (trendUp && strongTrend) scores.BullTrend += 0.55;
  if (trendUp) scores.BullTrend += 0.25;
  if (hhHl) scores.BullTrend += 0.2;

  if (trendDown && strongTrend) scores.BearTrend += 0.55;
  if (trendDown) scores.BearTrend += 0.25;
  if (lhLl) scores.BearTrend += 0.2;

  if (!strongTrend && Math.abs(feat.trendStrength) < 0.01) scores.Sideways += 0.5;
  if (feat.bbPos > 0.3 && feat.bbPos < 0.7 && !strongTrend) scores.Sideways += 0.3;

  if (highVol) scores.HighVol += 0.7;
  if (lowVol) scores.LowVol += 0.7;
  if (compressing) scores.Compression += 0.65;
  if (expanding) scores.Expansion += 0.65;

  if (breakoutUp || breakoutDown) scores.Breakout += 0.6;
  if (feat.choch) scores.Reversal += 0.45;
  if (compressing && lowVol && feat.volRatio < 0.9) scores.Accumulation += 0.4;
  if (expanding && highVol && feat.volRatio > 1.2) scores.Distribution += 0.35;

  // normalize roughly
  let best = 'Unclear';
  let bestScore = 0.25;
  const ranked = [];
  for (const [k, v] of Object.entries(scores)) {
    ranked.push([k, v]);
    if (v > bestScore) {
      bestScore = v;
      best = k;
    }
  }
  ranked.sort((a, b) => b[1] - a[1]);

  result.primary = best;
  result.secondary = ranked.slice(1, 3).filter(x => x[1] > 0.3).map(x => x[0]);
  result.confidence = Math.min(0.95, 0.35 + bestScore * 0.55);
  result.scores = scores;
  result.details = {
    adx: adxVal,
    atrPct,
    trendStrength: feat.trendStrength,
    compression: feat.compression,
    bos: feat.bos,
    structure: { hh: feat.hh, hl: feat.hl, lh: feat.lh, ll: feat.ll }
  };

  return result;
}

export { REGIMES };
