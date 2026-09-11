/**
 * Adaptive Indicator Configuration by Category / Asset / Timeframe
 * Resolution order: Asset+TF → Category+TF → TF → Default
 */
import { getSymbol } from './symbols.js';
import { CONFIG } from './config.js';

const DEFAULT_MACD = Object.freeze({
  fast: CONFIG.emaFast || 12,
  slow: CONFIG.emaSlow || 26,
  signal: CONFIG.emaSignal || 9
});

const DEFAULT_FIB = Object.freeze({
  lookback: 60,
  nearPct: 0.004 // 0.4% proximity to level
});

/** Timeframe-level defaults */
const TF_MACD = Object.freeze({
  '1m':  { fast: 8,  slow: 17, signal: 9 },
  '5m':  { fast: 10, slow: 21, signal: 9 },
  '15m': { fast: 12, slow: 26, signal: 9 },
  '30m': { fast: 12, slow: 26, signal: 9 },
  '1H':  { fast: 12, slow: 26, signal: 9 },
  '4H':  { fast: 12, slow: 26, signal: 9 },
  '1D':  { fast: 12, slow: 26, signal: 9 },
  '1W':  { fast: 8,  slow: 17, signal: 9 }
});

const TF_FIB = Object.freeze({
  '1m':  { lookback: 40, nearPct: 0.002 },
  '5m':  { lookback: 48, nearPct: 0.0025 },
  '15m': { lookback: 50, nearPct: 0.003 },
  '30m': { lookback: 55, nearPct: 0.0035 },
  '1H':  { lookback: 60, nearPct: 0.004 },
  '4H':  { lookback: 70, nearPct: 0.005 },
  '1D':  { lookback: 80, nearPct: 0.006 },
  '1W':  { lookback: 52, nearPct: 0.008 }
});

/** Category overrides (merged over TF) */
const CAT_MACD = Object.freeze({
  forex: {
    '1m':  { fast: 8,  slow: 17, signal: 9 },
    '5m':  { fast: 8,  slow: 21, signal: 9 },
    '1H':  { fast: 10, slow: 22, signal: 9 },
    '1D':  { fast: 12, slow: 26, signal: 9 }
  },
  metals: {
    '1H':  { fast: 12, slow: 26, signal: 9 },
    '1D':  { fast: 10, slow: 22, signal: 9 },
    '1W':  { fast: 8,  slow: 17, signal: 9 }
  },
  commodity: {
    '1H':  { fast: 12, slow: 26, signal: 9 },
    '1D':  { fast: 12, slow: 26, signal: 9 },
    '4H':  { fast: 10, slow: 24, signal: 9 }
  },
  stocks: {
    '1D':  { fast: 12, slow: 26, signal: 9 },
    '1W':  { fast: 10, slow: 22, signal: 9 }
  }
});

/** Per-asset overrides (highest priority) */
const ASSET_MACD = Object.freeze({
  XAUUSD: {
    '1D': { fast: 10, slow: 22, signal: 9 },
    '1H': { fast: 12, slow: 26, signal: 9 }
  },
  BRENT: {
    '1D': { fast: 12, slow: 26, signal: 9 },
    '4H': { fast: 10, slow: 24, signal: 9 }
  },
  USDEUR: {
    '1H': { fast: 8, slow: 17, signal: 9 },
    '1D': { fast: 12, slow: 26, signal: 9 }
  }
});

const ASSET_FIB = Object.freeze({
  XAUUSD: { '1D': { lookback: 90, nearPct: 0.005 } },
  BRENT:  { '1D': { lookback: 80, nearPct: 0.007 } },
  USDEUR: { '1D': { lookback: 70, nearPct: 0.003 } }
});

function mergeMacd(...parts) {
  let o = { ...DEFAULT_MACD };
  for (const p of parts) {
    if (!p) continue;
    if (p.fast != null) o.fast = p.fast;
    if (p.slow != null) o.slow = p.slow;
    if (p.signal != null) o.signal = p.signal;
  }
  // ensure slow > fast
  if (o.slow <= o.fast) o.slow = o.fast + 1;
  return Object.freeze(o);
}

function mergeFib(...parts) {
  let o = { ...DEFAULT_FIB };
  for (const p of parts) {
    if (!p) continue;
    if (p.lookback != null) o.lookback = p.lookback;
    if (p.nearPct != null) o.nearPct = p.nearPct;
  }
  return Object.freeze(o);
}

/**
 * Resolve adaptive MACD periods for asset + timeframe.
 */
export function getMacdConfig(symbol, timeframe = '1D') {
  const tf = String(timeframe || '1D');
  const meta = getSymbol(symbol);
  const cat = meta?.category || meta?.type || null;
  const sym = String(symbol || '').toUpperCase();

  return mergeMacd(
    TF_MACD[tf],
    cat && CAT_MACD[cat] ? CAT_MACD[cat][tf] : null,
    ASSET_MACD[sym] ? ASSET_MACD[sym][tf] : null
  );
}

/**
 * Resolve adaptive Fibonacci lookback / proximity.
 */
export function getFibConfig(symbol, timeframe = '1D') {
  const tf = String(timeframe || '1D');
  const sym = String(symbol || '').toUpperCase();
  return mergeFib(
    TF_FIB[tf],
    ASSET_FIB[sym] ? ASSET_FIB[sym][tf] : null
  );
}

export function getIndicatorConfig(symbol, timeframe = '1D') {
  return {
    macd: getMacdConfig(symbol, timeframe),
    fibonacci: getFibConfig(symbol, timeframe),
    symbol: String(symbol || '').toUpperCase() || null,
    timeframe: String(timeframe || '1D')
  };
}
