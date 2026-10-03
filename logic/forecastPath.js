/**
 * Multi-day forecast path builder — v12.1.0
 * Projects OHLC path for N calendar/trading days (default 7).
 * Deterministic pure functions; no look-ahead beyond last known close.
 */
import { CONFIG } from './config.js';
import { atr as atrFn, isNum, last } from './indicators.js';

/**
 * Map horizon in days → number of bars for a timeframe.
 * 1D: 1 day = 1 bar; 4H ≈ 6 bars/day; 1H ≈ 24; 1W ≈ 1/7.
 */
export function horizonDaysToBars(timeframe = '1D', days = CONFIG.forecastHorizonDays || 7) {
  const d = Math.max(1, Math.min(30, Math.round(Number(days) || 7)));
  const tf = String(timeframe || '1D').toUpperCase();
  if (tf === '1H') return d * 24;
  if (tf === '4H') return d * 6;
  if (tf === '1W') return Math.max(1, Math.ceil(d / 7));
  return d; // 1D and default
}

export function barsToApproxDays(timeframe = '1D', bars = 7) {
  const b = Math.max(1, Number(bars) || 1);
  const tf = String(timeframe || '1D').toUpperCase();
  if (tf === '1H') return Math.max(1, Math.round(b / 24));
  if (tf === '4H') return Math.max(1, Math.round(b / 6));
  if (tf === '1W') return b * 7;
  return b;
}

function tfMs(timeframe = '1D') {
  const tf = String(timeframe || '1D').toUpperCase();
  if (tf === '1H') return 3600000;
  if (tf === '4H') return 4 * 3600000;
  if (tf === '1W') return 7 * 86400000;
  return 86400000;
}

/**
 * Build projected candles for the forecast horizon.
 * @param {Array} hist - historical candles (OHLC)
 * @param {object} result - decision/analysis result with signal, target, confidence, atr
 * @param {object} opts - { days, timeframe, nBars }
 */
export function buildForecastPath(hist, result, opts = {}) {
  if (!hist || !hist.length) {
    return { hist: [], future: [], days: [], horizonDays: 0, horizonBars: 0 };
  }
  const lastBar = hist[hist.length - 1];
  const close = Number(lastBar.c);
  if (!Number.isFinite(close) || close <= 0) {
    return { hist, future: [], days: [], horizonDays: 0, horizonBars: 0 };
  }

  const timeframe = opts.timeframe || '1D';
  const horizonDays = Math.max(
    1,
    Math.round(Number(opts.days) || CONFIG.forecastHorizonDays || 7)
  );
  const nFuture =
    opts.nBars != null
      ? Math.max(1, Math.round(Number(opts.nBars)))
      : horizonDaysToBars(timeframe, horizonDays);

  let atr = Number(result?.atr ?? result?.analysis?.indicators?.atr ?? result?.indicators?.atr);
  if (!Number.isFinite(atr) || atr <= 0) {
    try {
      atr = atrFn(hist, CONFIG.atrPeriod);
    } catch (_) {
      atr = null;
    }
  }
  if (!Number.isFinite(atr) || atr <= 0) {
    const slice = hist.slice(-20);
    const ranges = slice
      .map((c) => Number(c.h) - Number(c.l))
      .filter((x) => Number.isFinite(x) && x > 0);
    atr = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : close * 0.004;
  }
  atr = Math.max(atr, close * 0.0008);

  const signal = String(result?.signal || result?.prediction?.signal || 'HOLD').toUpperCase();
  const target = Number(result?.target ?? result?.prediction?.target);
  const stop = Number(result?.stop ?? result?.prediction?.stop);
  const conf0 = Number.isFinite(result?.confidence ?? result?.prediction?.confidence)
    ? Math.max(0.2, Math.min(1, Number(result.confidence ?? result.prediction.confidence)))
    : 0.5;

  let dir = 0;
  if (signal === 'BUY') dir = 1;
  else if (signal === 'SELL') dir = -1;
  else if (Number.isFinite(target)) dir = target > close ? 0.35 : target < close ? -0.35 : 0;

  let totalMove;
  if (Number.isFinite(target) && target !== close && dir !== 0) {
    const toTarget = target - close;
    if ((dir > 0 && toTarget < 0) || (dir < 0 && toTarget > 0)) {
      totalMove = dir * atr * (1.2 + conf0);
    } else {
      // Scale path so day-7 approaches a fraction of distance to target
      totalMove = toTarget * (0.5 + 0.35 * conf0);
    }
  } else if (dir !== 0) {
    totalMove = dir * atr * (1.15 + conf0 * 1.35) * Math.sqrt(horizonDays / 5);
  } else {
    totalMove = 0;
  }

  const stepMs = tfMs(timeframe);
  const lastTs = Number.isFinite(lastBar.ts) ? lastBar.ts : Date.now();
  const future = [];
  let px = close;

  for (let i = 1; i <= nFuture; i++) {
    const progress = i / nFuture;
    const eased = 1 - Math.pow(1 - progress, 1.35);
    const dest = close + totalMove * eased;
    const o = px;
    let c = dest;
    if (dir > 0 && c < o) c = o + Math.abs(atr) * 0.05;
    if (dir < 0 && c > o) c = o - Math.abs(atr) * 0.05;
    if (dir === 0) c = o + atr * 0.08 * Math.sin(i * 2.1);
    const body = Math.abs(c - o);
    const wick = Math.max(atr * 0.25, body * 0.35);
    const h = Math.max(o, c) + wick * 0.55;
    const l = Math.min(o, c) - wick * 0.55;
    const conf = Math.max(0.2, conf0 * (1 - progress * 0.32));
    const bar = {
      o,
      h,
      l,
      c,
      v: null,
      ts: lastTs + i * stepMs,
      forecast: true,
      conf,
      dir,
      dayIndex: i,
      horizonDays,
    };
    future.push(bar);
    px = c;
  }

  // Day-level summary (for 1D: one bar per day; for lower TF: sample end-of-day)
  const days = summarizeByDay(future, horizonDays, close, conf0, signal, target, stop, atr);

  return {
    hist,
    future,
    days,
    horizonDays,
    horizonBars: nFuture,
    direction: signal,
    totalMove,
    atr,
    confidence: conf0,
  };
}

function summarizeByDay(future, horizonDays, entryPrice, conf0, signal, target, stop, atrHint) {
  if (!future.length) return [];
  const AE = CONFIG.accuracyEnhancements || {};
  const tightUntil = AE.layerTightDays ?? 2;
  const wideFrom = AE.layerWideFromDay ?? 5;
  const tightMult = AE.rangeWidthAtrMultTight ?? 0.55;
  const wideMult = AE.rangeWidthAtrMultWide ?? 1.35;
  const atr = Number.isFinite(atrHint) && atrHint > 0 ? atrHint : entryPrice * 0.01;
  const out = [];
  const n = future.length;
  for (let d = 1; d <= horizonDays; d++) {
    const endIdx = Math.min(n, Math.ceil((d / horizonDays) * n)) - 1;
    const startIdx = Math.min(n - 1, Math.ceil(((d - 1) / horizonDays) * n));
    const slice = future.slice(startIdx, endIdx + 1);
    if (!slice.length) continue;
    const lastC = slice[slice.length - 1];
    let hi = Math.max(...slice.map((x) => x.h));
    let lo = Math.min(...slice.map((x) => x.l));
    const mid = lastC.c;
    // Layered uncertainty: days 1-2 tight band; from day 5 widen explicitly
    let bandMult = tightMult + (wideMult - tightMult) * Math.max(0, (d - 1) / Math.max(1, horizonDays - 1));
    if (d <= tightUntil) bandMult = tightMult;
    if (d >= wideFrom) bandMult = Math.max(bandMult, wideMult);
    const band = atr * bandMult;
    hi = Math.max(hi, mid + band);
    lo = Math.min(lo, mid - band);
    const changePct = ((mid - entryPrice) / entryPrice) * 100;
    const layer = d <= tightUntil ? 'tight' : d >= wideFrom ? 'wide' : 'mid';
    out.push({
      day: d,
      open: slice[0].o,
      high: hi,
      low: lo,
      close: mid,
      range: Math.round((hi - lo) * 100) / 100,
      layer,
      pointEstimate: d <= tightUntil,
      changePct: Math.round(changePct * 100) / 100,
      confidence: Math.max(0.15, conf0 * (1 - (d / horizonDays) * 0.38)),
      signal,
      towardTarget:
        Number.isFinite(target) && entryPrice
          ? Math.round(
              (Math.abs(mid - entryPrice) / Math.max(1e-9, Math.abs(target - entryPrice))) * 1000
            ) / 1000
          : null,
      ts: lastC.ts,
    });
  }
  return out;
}

/**
 * Attach 7-day (or N-day) path onto a decision result without mutating unrelated fields.
 */
export function attachForecastToResult(result, candles, options = {}) {
  if (!result || !result.ok) return result;
  const timeframe = options.timeframe || result.data?.timeframe || '1D';
  const days = options.days || CONFIG.forecastHorizonDays || 7;
  const path = buildForecastPath(candles, result, { days, timeframe });
  result.forecast7d = {
    horizonDays: path.horizonDays,
    horizonBars: path.horizonBars,
    days: path.days,
    future: path.future,
    direction: path.direction,
    atr: path.atr,
    confidence: path.confidence,
    disclaimer:
      'مسیر ۷روزه یک برون‌یابی ساختاری از سیگنال، ATR و هدف است — پیش‌بینی قطعی قیمت نیست.',
  };
  if (result.prediction) {
    result.prediction.horizonBars = path.horizonBars;
    result.prediction.horizonDays = path.horizonDays;
    result.prediction.dailyPath = path.days;
    result.prediction.algoVersion = CONFIG.predictionAlgoVersion;
  }
  return result;
}

export { CONFIG };
