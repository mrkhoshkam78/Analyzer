/**
 * Market Regime Detection
 * Determines: Trending Bullish / Trending Bearish / Range / High Volatility / Low Volatility / Unclear
 * Used to weight strategies in the ensemble.
 */
import { CONFIG } from './config.js';
import { ema, adx, atr, volatilityPct, bollinger, isNum, last } from './indicators.js';

/**
 * Detect market regime from candles and precomputed indicators (optional).
 * @param {Array} candles OHLCV
 * @param {object} ind optional indicators from runTechnical
 * @returns {{ regime, confidence, details, weights }}
 */
export function detectRegime(candles, ind = null) {
  const result = {
    regime: 'Unclear',
    confidence: 0.4,
    details: {},
    // base strategy weight multipliers by regime
    weights: {}
  };

  if (!candles || candles.length < CONFIG.minCandles) {
    result.weights = defaultWeights('Unclear');
    return result;
  }

  const closes = candles.map(c => c.c);
  const price = ind?.price ?? last(closes);
  const e20 = ind?.ema20 ?? ema(closes, CONFIG.smaFast);
  const e50 = ind?.ema50 ?? ema(closes, CONFIG.smaSlow);
  const adxRes = ind?.adx ?? null;
  const volPct = ind?.atrPct ?? volatilityPct(candles);
  const bb = ind?.bollinger ?? bollinger(closes);
  const atrVal = ind?.atr ?? atr(candles);

  const adxVal = adxRes?.adx ?? null;
  const plusDI = adxRes?.plusDI ?? null;
  const minusDI = adxRes?.minusDI ?? null;

  result.details = {
    adx: adxVal,
    plusDI,
    minusDI,
    atrPct: volPct,
    ema20: e20,
    ema50: e50,
    bbWidth: bb?.width
  };

  // Volatility classification
  const highVol = volPct != null && volPct > CONFIG.highVolPct;
  const lowVol = volPct != null && volPct < CONFIG.lowVolPct;

  // Trend strength
  const strongTrend = adxVal != null && adxVal >= 25;
  const weakTrend = adxVal != null && adxVal < 18;
  const bullEma = e20 != null && e50 != null && price > e20 && e20 > e50;
  const bearEma = e20 != null && e50 != null && price < e20 && e20 < e50;
  const bullDI = plusDI != null && minusDI != null && plusDI > minusDI;
  const bearDI = plusDI != null && minusDI != null && minusDI > plusDI;

  // Range: low ADX + price inside BB mid zone
  const inRangeBB = bb?.pctB != null && bb.pctB > 0.2 && bb.pctB < 0.8;

  let regime = 'Unclear';
  let conf = 0.45;

  if (highVol && strongTrend) {
    // High vol + trend → still trending but flagged
    if (bullEma || bullDI) {
      regime = 'Trending Bullish';
      conf = 0.65;
    } else if (bearEma || bearDI) {
      regime = 'Trending Bearish';
      conf = 0.65;
    } else {
      regime = 'High Volatility';
      conf = 0.7;
    }
  } else if (highVol) {
    regime = 'High Volatility';
    conf = 0.75;
  } else if (lowVol && weakTrend) {
    regime = 'Low Volatility';
    conf = 0.7;
  } else if (strongTrend && (bullEma || bullDI)) {
    regime = 'Trending Bullish';
    conf = Math.min(0.9, 0.55 + (adxVal - 25) / 50);
  } else if (strongTrend && (bearEma || bearDI)) {
    regime = 'Trending Bearish';
    conf = Math.min(0.9, 0.55 + (adxVal - 25) / 50);
  } else if (weakTrend && inRangeBB) {
    regime = 'Range';
    conf = 0.7;
  } else if (bullEma && !strongTrend) {
    regime = 'Trending Bullish';
    conf = 0.5;
  } else if (bearEma && !strongTrend) {
    regime = 'Trending Bearish';
    conf = 0.5;
  } else if (inRangeBB || weakTrend) {
    regime = 'Range';
    conf = 0.55;
  } else {
    regime = 'Unclear';
    conf = 0.4;
  }

  // Override: extreme vol dominates
  if (volPct != null && volPct > CONFIG.highVolPct * 1.5) {
    regime = 'High Volatility';
    conf = Math.max(conf, 0.8);
  }

  result.regime = regime;
  result.confidence = Math.round(conf * 1000) / 1000;
  result.weights = defaultWeights(regime);
  return result;
}

/**
 * Strategy weight multipliers per regime.
 * Keys match strategy ids in strategies.js
 */
function defaultWeights(regime) {
  const base = {
    trendFollowing: 1,
    meanReversion: 1,
    momentum: 1,
    breakout: 1,
    fibStructure: 1,
    fundamental: 0.8
  };

  switch (regime) {
    case 'Trending Bullish':
      return {
        trendFollowing: 1.6,
        meanReversion: 0.4,
        momentum: 1.4,
        breakout: 1.2,
        fibStructure: 1.0,
        fundamental: 0.9
      };
    case 'Trending Bearish':
      return {
        trendFollowing: 1.6,
        meanReversion: 0.4,
        momentum: 1.4,
        breakout: 1.2,
        fibStructure: 1.0,
        fundamental: 0.9
      };
    case 'Range':
      return {
        trendFollowing: 0.4,
        meanReversion: 1.7,
        momentum: 0.6,
        breakout: 0.7,
        fibStructure: 1.3,
        fundamental: 0.8
      };
    case 'High Volatility':
      return {
        trendFollowing: 0.7,
        meanReversion: 0.5,
        momentum: 1.1,
        breakout: 1.3,
        fibStructure: 0.9,
        fundamental: 0.7
      };
    case 'Low Volatility':
      return {
        trendFollowing: 0.8,
        meanReversion: 1.4,
        momentum: 0.7,
        breakout: 0.6,
        fibStructure: 1.2,
        fundamental: 1.0
      };
    case 'Unclear':
    default:
      return {
        trendFollowing: 0.8,
        meanReversion: 0.8,
        momentum: 0.8,
        breakout: 0.7,
        fibStructure: 0.9,
        fundamental: 0.7
      };
  }
}

export { defaultWeights };
