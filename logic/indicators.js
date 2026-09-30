/**
 * Technical indicators — deterministic, pure functions.
 * Return null when data is insufficient (never fabricate).
 */
import { CONFIG } from './config.js';

export function isNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

export function last(arr) {
  return arr && arr.length ? arr[arr.length - 1] : null;
}

export function sma(values, period) {
  if (!values || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    if (!isNum(values[i])) return null;
    sum += values[i];
  }
  return sum / period;
}

export function ema(values, period) {
  if (!values || values.length < period) return null;
  for (let i = 0; i < period; i++) if (!isNum(values[i])) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let e = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    if (!isNum(values[i])) return null;
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

export function emaSeries(values, period) {
  if (!values || values.length < period) return [];
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    if (!isNum(values[i])) return [];
    sum += values[i];
  }
  out[period - 1] = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    if (!isNum(values[i]) || out[i - 1] == null) { out[i] = null; continue; }
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Wilder RSI */
export function rsi(closes, period = CONFIG.rsiPeriod) {
  if (!closes || closes.length <= period) return null;
  for (let i = 0; i <= period; i++) if (!isNum(closes[i])) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    if (!isNum(closes[i])) return null;
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  const rs = avgGain / avgLoss;
  if (!Number.isFinite(rs)) return null;
  return 100 - 100 / (1 + rs);
}

/**
 * Adaptive MACD. periods = { fast, slow, signal } optional.
 * Returns line, signal, hist, crossover, momentumDir.
 */
export function macd(closes, periods = null) {
  const fast = periods?.fast ?? CONFIG.emaFast;
  const slow = periods?.slow ?? CONFIG.emaSlow;
  const sigP = periods?.signal ?? CONFIG.emaSignal;
  const empty = {
    macd: null, signal: null, hist: null,
    crossover: null, momentumDir: 'neutral',
    periods: { fast, slow, signal: sigP },
    insufficient: true
  };
  if (!closes || closes.length < slow) return empty;

  const ef = emaSeries(closes, fast);
  const es = emaSeries(closes, slow);
  const macdLine = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (ef[i] != null && es[i] != null) macdLine[i] = ef[i] - es[i];
  }
  // Align signal EMA on full macd series (skip nulls at start)
  const firstValid = macdLine.findIndex(v => v != null);
  if (firstValid < 0) return empty;
  const validSlice = macdLine.slice(firstValid);
  if (validSlice.length < sigP) {
    const m = last(validSlice);
    return {
      macd: m, signal: null, hist: null,
      crossover: null, momentumDir: m != null && m > 0 ? 'bull' : m != null && m < 0 ? 'bear' : 'neutral',
      periods: { fast, slow, signal: sigP },
      insufficient: true
    };
  }
  const sigOnValid = emaSeries(validSlice, sigP);
  // map back to last values
  const m = last(validSlice);
  const signal = last(sigOnValid);
  const hist = m != null && signal != null ? m - signal : null;

  // previous hist for crossover
  let crossover = null;
  if (sigOnValid.length >= 2 && validSlice.length >= 2) {
    const h0 = validSlice[validSlice.length - 2] - (sigOnValid[sigOnValid.length - 2] ?? validSlice[validSlice.length - 2]);
    const h1 = hist;
    if (isNum(h0) && isNum(h1)) {
      if (h0 <= 0 && h1 > 0) crossover = 'bullish';
      else if (h0 >= 0 && h1 < 0) crossover = 'bearish';
    }
  }

  let momentumDir = 'neutral';
  if (isNum(hist)) {
    if (hist > 0) momentumDir = 'bull';
    else if (hist < 0) momentumDir = 'bear';
  } else if (isNum(m)) {
    momentumDir = m > 0 ? 'bull' : m < 0 ? 'bear' : 'neutral';
  }

  return {
    macd: m,
    signal,
    hist,
    crossover,
    momentumDir,
    periods: { fast, slow, signal: sigP },
    insufficient: false
  };
}

/**
 * Fibonacci Retracement + Extension from swing high/low in lookback window.
 * Uses real High/Low only — never fabricates OHLC.
 * @returns { ok, insufficient, swingHigh, swingLow, retracement, extension, nearest, bias }
 */
export function fibonacciLevels(candles, options = {}) {
  const lookback = options.lookback || 60;
  const nearPct = options.nearPct != null ? options.nearPct : 0.004;
  const empty = {
    ok: false, insufficient: true,
    swingHigh: null, swingLow: null,
    retracement: null, extension: null,
    nearest: null, bias: 'neutral'
  };
  if (!candles || candles.length < 10) return empty;

  const n = candles.length;
  const start = Math.max(0, n - lookback);
  let hi = -Infinity, lo = Infinity, hiIdx = -1, loIdx = -1;
  for (let i = start; i < n; i++) {
    const c = candles[i];
    if (!isNum(c.h) || !isNum(c.l) || c.h <= 0 || c.l <= 0) continue;
    if (c.h > hi) { hi = c.h; hiIdx = i; }
    if (c.l < lo) { lo = c.l; loIdx = i; }
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo || hiIdx < 0 || loIdx < 0) {
    return empty;
  }

  const range = hi - lo;
  const retLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const extLevels = [1.272, 1.618];

  // Direction of swing: if low is after high → downtrend retrace from high; else uptrend
  const upSwing = loIdx < hiIdx; // price rose from low to high
  const retracement = {};
  for (const r of retLevels) {
    // standard: from high down for upswing, from low up for downswing
    const price = upSwing ? (hi - range * r) : (lo + range * r);
    retracement[String(r)] = price;
  }
  const extension = {};
  for (const e of extLevels) {
    const price = upSwing ? (hi + range * (e - 1)) : (lo - range * (e - 1));
    extension[String(e)] = price;
  }

  const price = isNum(options.price) ? options.price : (isNum(candles[n - 1].c) ? candles[n - 1].c : null);
  let nearest = null;
  if (isNum(price) && price > 0) {
    let bestDist = Infinity;
    const all = [];
    for (const [k, v] of Object.entries(retracement)) all.push({ kind: 'ret', level: k, price: v });
    for (const [k, v] of Object.entries(extension)) all.push({ kind: 'ext', level: k, price: v });
    for (const item of all) {
      if (!isNum(item.price)) continue;
      const d = Math.abs(item.price - price) / price;
      if (d < bestDist) {
        bestDist = d;
        nearest = { ...item, distancePct: d * 100, near: d <= nearPct };
      }
    }
  }

  let bias = 'neutral';
  if (nearest && nearest.near) {
    // near support-like fib in upswing (higher ratios near low) → bullish bounce potential
    const lvl = parseFloat(nearest.level);
    if (upSwing) {
      if (lvl >= 0.5) bias = 'bull'; // deep retrace zone
      else if (lvl <= 0.236) bias = 'bear'; // near highs
    } else {
      if (lvl >= 0.5) bias = 'bear';
      else if (lvl <= 0.236) bias = 'bull';
    }
  }

  return {
    ok: true,
    insufficient: false,
    swingHigh: hi,
    swingLow: lo,
    swingHighIndex: hiIdx,
    swingLowIndex: loIdx,
    upSwing,
    range,
    retracement,
    extension,
    nearest,
    bias,
    lookback
  };
}

/** Wilder ATR */
export function atr(candles, period = CONFIG.atrPeriod) {
  if (!candles || candles.length <= period) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    if (![c.h, c.l, c.c, prev.c].every(isNum)) return null;
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c)));
  }
  if (tr.length < period) return null;
  let a = 0;
  for (let i = 0; i < period; i++) a += tr[i];
  a /= period;
  for (let i = period; i < tr.length; i++) a = (a * (period - 1) + tr[i]) / period;
  return Number.isFinite(a) ? a : null;
}

export function momentum(closes, period = CONFIG.momentumPeriod) {
  if (!closes || closes.length <= period) return null;
  const cur = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  if (!isNum(cur) || !isNum(past) || past === 0) return null;
  const v = ((cur - past) / past) * 100;
  return Number.isFinite(v) ? v : null;
}

export function roc(closes, period = CONFIG.rocPeriod) {
  return momentum(closes, period); // ROC % same form
}

/** Bollinger: middle=SMA, upper/lower = middle ± k*std */
export function bollinger(closes, period = CONFIG.bbPeriod, k = CONFIG.bbStd) {
  if (!closes || closes.length < period) return { mid: null, upper: null, lower: null, width: null, pctB: null };
  const slice = closes.slice(-period);
  if (!slice.every(isNum)) return { mid: null, upper: null, lower: null, width: null, pctB: null };
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  let varSum = 0;
  for (const x of slice) varSum += (x - mid) ** 2;
  const std = Math.sqrt(varSum / period);
  const upper = mid + k * std;
  const lower = mid - k * std;
  const width = mid !== 0 ? ((upper - lower) / mid) * 100 : null;
  const lastC = closes[closes.length - 1];
  const pctB = upper !== lower ? (lastC - lower) / (upper - lower) : null;
  return { mid, upper, lower, width, pctB };
}

/** Stochastic %K / %D */
export function stochastic(candles, kPeriod = CONFIG.stochK, dPeriod = CONFIG.stochD) {
  if (!candles || candles.length < kPeriod) return { k: null, d: null };
  const slice = candles.slice(-kPeriod);
  let hi = -Infinity, lo = Infinity;
  for (const c of slice) {
    if (isNum(c.h) && c.h > hi) hi = c.h;
    if (isNum(c.l) && c.l < lo) lo = c.l;
  }
  const close = candles[candles.length - 1].c;
  if (!isNum(close) || hi === lo || !Number.isFinite(hi)) return { k: null, d: null };
  const k = ((close - lo) / (hi - lo)) * 100;
  // Simple %D: need series of %K — approximate with last value only if insufficient history
  // Build last dPeriod K values if possible
  const ks = [];
  for (let end = candles.length; end >= kPeriod && ks.length < dPeriod; end--) {
    const s = candles.slice(end - kPeriod, end);
    let h = -Infinity, l = Infinity;
    for (const c of s) {
      if (c.h > h) h = c.h;
      if (c.l < l) l = c.l;
    }
    const cl = candles[end - 1].c;
    if (h !== l && isNum(cl)) ks.unshift(((cl - l) / (h - l)) * 100);
  }
  const d = ks.length >= dPeriod ? ks.reduce((a, b) => a + b, 0) / ks.length : null;
  return { k: Number.isFinite(k) ? k : null, d };
}

/**
 * ADX (Wilder) — needs enough bars
 * Returns { adx, plusDI, minusDI }
 */
export function adx(candles, period = CONFIG.adxPeriod) {
  if (!candles || candles.length < period * 2) {
    return { adx: null, plusDI: null, minusDI: null };
  }
  const plusDM = [], minusDM = [], trArr = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const up = c.h - p.h;
    const down = p.l - c.l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    trArr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  if (trArr.length < period) return { adx: null, plusDI: null, minusDI: null };

  // Wilder smooth first period
  let smTR = 0, smPDM = 0, smMDM = 0;
  for (let i = 0; i < period; i++) {
    smTR += trArr[i]; smPDM += plusDM[i]; smMDM += minusDM[i];
  }
  const dxArr = [];
  let pdi = smTR ? (100 * smPDM) / smTR : 0;
  let mdi = smTR ? (100 * smMDM) / smTR : 0;
  let dx = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
  dxArr.push(dx);

  for (let i = period; i < trArr.length; i++) {
    smTR = smTR - smTR / period + trArr[i];
    smPDM = smPDM - smPDM / period + plusDM[i];
    smMDM = smMDM - smMDM / period + minusDM[i];
    pdi = smTR ? (100 * smPDM) / smTR : 0;
    mdi = smTR ? (100 * smMDM) / smTR : 0;
    dx = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
    dxArr.push(dx);
  }
  if (dxArr.length < period) return { adx: null, plusDI: pdi, minusDI: mdi };
  // ADX = Wilder smooth of DX
  let adxVal = 0;
  for (let i = 0; i < period; i++) adxVal += dxArr[i];
  adxVal /= period;
  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
  }
  return {
    adx: Number.isFinite(adxVal) ? adxVal : null,
    plusDI: Number.isFinite(pdi) ? pdi : null,
    minusDI: Number.isFinite(mdi) ? mdi : null
  };
}

export function supportResistance(candles, lookback = CONFIG.lookbackSR) {
  if (!candles || candles.length < 5) return { support: null, resistance: null };
  const slice = candles.slice(-Math.min(lookback, candles.length));
  let support = Infinity, resistance = -Infinity;
  for (const c of slice) {
    if (isNum(c.l) && c.l < support) support = c.l;
    if (isNum(c.h) && c.h > resistance) resistance = c.h;
  }
  if (!Number.isFinite(support) || !Number.isFinite(resistance)) {
    return { support: null, resistance: null };
  }
  return { support, resistance };
}

export function volumeAnalysis(candles, period = CONFIG.volumeAvgPeriod) {
  const vols = [];
  for (const c of candles) {
    if (isNum(c.v) && c.v >= 0) vols.push(c.v);
  }
  if (vols.length < period) {
    return { avg: null, last: null, ratio: null, spike: false, weak: false, available: false };
  }
  const avg = sma(vols, period);
  const lastV = vols[vols.length - 1];
  const ratio = avg && avg > 0 ? lastV / avg : null;
  return {
    avg, last: lastV, ratio,
    spike: ratio != null && ratio > 1.5,
    weak: ratio != null && ratio < 0.6,
    available: true
  };
}

export function detectBreakout(candles, lookback = 20) {
  if (!candles || candles.length < lookback + 1) return { up: false, down: false };
  const prev = candles.slice(-(lookback + 1), -1);
  let high = -Infinity, low = Infinity;
  for (const c of prev) {
    if (isNum(c.h) && c.h > high) high = c.h;
    if (isNum(c.l) && c.l < low) low = c.l;
  }
  const lastC = candles[candles.length - 1];
  if (!isNum(lastC.c) || !Number.isFinite(high)) return { up: false, down: false };
  return { up: lastC.c > high, down: lastC.c < low };
}

export function maxDrawdown(closes) {
  if (!closes || closes.length < 2) return null;
  let peak = closes[0], maxDd = 0;
  for (let i = 0; i < closes.length; i++) {
    const p = closes[i];
    if (!isNum(p)) continue;
    if (p > peak) peak = p;
    if (peak > 0) {
      const dd = (peak - p) / peak;
      if (Number.isFinite(dd) && dd > maxDd) maxDd = dd;
    }
  }
  return maxDd * 100;
}

export function volatilityPct(candles, period = 20) {
  const a = atr(candles, period);
  const price = candles && candles.length ? candles[candles.length - 1].c : null;
  if (a == null || !isNum(price) || price <= 0) return null;
  const pct = (a / price) * 100;
  return Number.isFinite(pct) ? pct : null;
}
