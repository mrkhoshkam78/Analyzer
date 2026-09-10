/**
 * Offline Market Analyst V4 – Analysis Engine
 * Pure, deterministic, no DOM, no network.
 * All indicators use Close except Support/Resistance (High/Low) and ATR (True Range).
 *
 * Mathematical standards applied:
 * - EMA: α = 2/(N+1), SMA seed for first value
 * - RSI: Wilder smoothing (initial SMA of gains/losses, then (prev*(N-1)+cur)/N)
 * - MACD: EMA12 − EMA26, Signal = EMA9(MACD)
 * - ATR: True Range + Wilder smoothing (same as RSI)
 * - Momentum: Rate-of-Change % over N periods
 * - Drawdown: peak-to-trough %
 */

export const CONFIG = {
  minCandles: 30,
  rsiPeriod: 14,
  atrPeriod: 14,
  smaFast: 20,
  smaSlow: 50,
  emaFast: 12,
  emaSlow: 26,
  emaSignal: 9,
  momentumPeriod: 10,
  lookbackSR: 20,
  volumeAvgPeriod: 20,
  buyThreshold: 65,
  sellThreshold: 35,
  weights: {
    trendEma20: 7,
    trendEma50: 10,
    rsiOversold: 8,
    rsiOverbought: -8,
    rsiMildBull: 3,
    rsiMildBear: -2,
    macdBull: 7,
    macdBear: -7,
    momentumBull: 5,
    momentumBear: -5,
    nearSupport: 6,
    nearResistance: -5,
    highVolPenalty: -3,
    lowVolBonus: 2,
    volumeSpike: 5,
    volumeWeak: -2,
    breakout: 6,
    riskReward: 4
  }
};

// ---------- Helpers ----------
function isNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function last(arr) {
  return arr.length ? arr[arr.length - 1] : null;
}

function safeDiv(num, den) {
  if (!isNum(num) || !isNum(den) || den === 0) return null;
  const r = num / den;
  return Number.isFinite(r) ? r : null;
}

// ---------- Indicators ----------
export function sma(values, period) {
  if (!values || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    if (!isNum(values[i])) return null;
    sum += values[i];
  }
  return sum / period;
}

/**
 * EMA with standard α = 2/(N+1).
 * Seeded with SMA of the first N values (common industry practice).
 */
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

/** Full EMA series (aligned to input length; leading nulls for warm-up). */
function emaSeries(values, period) {
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
    if (!isNum(values[i]) || out[i - 1] == null) {
      out[i] = null;
      continue;
    }
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/**
 * RSI – Wilder’s method.
 * Initial avgGain/avgLoss = arithmetic mean of first `period` changes.
 * Subsequent: smoothed = (prev * (period-1) + current) / period.
 * Zero-movement (avgGain=0 & avgLoss=0) → 50 (undefined otherwise).
 */
export function rsi(closes, period = CONFIG.rsiPeriod) {
  if (!closes || closes.length <= period) return null;
  for (let i = 0; i <= period; i++) if (!isNum(closes[i])) return null;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
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
 * MACD = EMA(12) − EMA(26)
 * Signal = EMA(9) of the MACD line (computed on the valid MACD series in order).
 * Histogram = MACD − Signal.
 */
export function macd(closes) {
  if (!closes || closes.length < CONFIG.emaSlow) {
    return { macd: null, signal: null, hist: null };
  }
  const ef = emaSeries(closes, CONFIG.emaFast);
  const es = emaSeries(closes, CONFIG.emaSlow);
  if (!ef.length || !es.length) return { macd: null, signal: null, hist: null };

  const macdLine = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (ef[i] != null && es[i] != null) macdLine[i] = ef[i] - es[i];
  }

  // Build contiguous valid MACD values in chronological order for signal EMA
  const valid = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null) valid.push(macdLine[i]);
  }
  if (valid.length < CONFIG.emaSignal) {
    return { macd: last(macdLine.filter(v => v != null)), signal: null, hist: null };
  }

  const sigSeries = emaSeries(valid, CONFIG.emaSignal);
  const signal = last(sigSeries);
  const m = last(macdLine.filter(v => v != null));
  const hist = (m != null && signal != null) ? m - signal : null;
  return { macd: m, signal, hist };
}

/**
 * ATR – True Range + Wilder smoothing (identical recurrence to RSI).
 * First ATR = SMA of the first `period` True Ranges.
 * Then ATR_t = (ATR_{t-1} * (period-1) + TR_t) / period.
 */
export function atr(candles, period = CONFIG.atrPeriod) {
  if (!candles || candles.length <= period) return null;

  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (![c.h, c.l, c.c, prev.c].every(isNum)) return null;
    const range = Math.max(
      c.h - c.l,
      Math.abs(c.h - prev.c),
      Math.abs(c.l - prev.c)
    );
    if (!Number.isFinite(range) || range < 0) return null;
    tr.push(range);
  }
  if (tr.length < period) return null;

  // Seed with SMA of first `period` TRs
  let a = 0;
  for (let i = 0; i < period; i++) a += tr[i];
  a /= period;

  // Wilder smooth the remainder
  for (let i = period; i < tr.length; i++) {
    a = (a * (period - 1) + tr[i]) / period;
  }
  return Number.isFinite(a) ? a : null;
}

/**
 * Momentum as Rate-of-Change (%): (Close − Close_n) / Close_n * 100.
 * Returns null on zero/invalid past price.
 */
export function momentum(closes, period = CONFIG.momentumPeriod) {
  if (!closes || closes.length <= period) return null;
  const cur = closes[closes.length - 1];
  const past = closes[closes.length - 1 - period];
  if (!isNum(cur) || !isNum(past) || past === 0) return null;
  const roc = ((cur - past) / past) * 100;
  return Number.isFinite(roc) ? roc : null;
}

/**
 * Relative volatility = ATR / last Close * 100.
 */
export function volatility(candles, period = 20) {
  if (!candles || candles.length < period + 1) return null;
  const a = atr(candles, period);
  const price = candles[candles.length - 1].c;
  if (a == null || !isNum(price) || price <= 0) return null;
  const pct = (a / price) * 100;
  return Number.isFinite(pct) ? pct : null;
}

export function supportResistance(candles, lookback = CONFIG.lookbackSR) {
  if (!candles || candles.length < 5) return { support: null, resistance: null };
  const n = Math.min(lookback, candles.length);
  const slice = candles.slice(-n);
  let support = Infinity;
  let resistance = -Infinity;
  for (const c of slice) {
    if (!isNum(c.l) || !isNum(c.h)) continue;
    if (c.l < support) support = c.l;
    if (c.h > resistance) resistance = c.h;
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
    return { avg: null, last: null, ratio: null, spike: false, weak: false };
  }
  const avg = sma(vols, period);
  const lastV = vols[vols.length - 1];
  const ratio = (avg != null && avg > 0) ? lastV / avg : null;
  return {
    avg,
    last: lastV,
    ratio: isNum(ratio) ? ratio : null,
    spike: ratio != null && ratio > 1.5,
    weak: ratio != null && ratio < 0.6
  };
}

/**
 * Breakout: last Close vs max High / min Low of the prior `lookback` bars
 * (current bar excluded → no look-ahead).
 */
export function detectBreakout(candles, lookback = 20) {
  if (!candles || candles.length < lookback + 1) return { up: false, down: false };
  const prev = candles.slice(-(lookback + 1), -1);
  let high = -Infinity;
  let low = Infinity;
  for (const c of prev) {
    if (isNum(c.h) && c.h > high) high = c.h;
    if (isNum(c.l) && c.l < low) low = c.l;
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return { up: false, down: false };
  const lastC = candles[candles.length - 1];
  if (!isNum(lastC.c)) return { up: false, down: false };
  return {
    up: lastC.c > high,
    down: lastC.c < low
  };
}

/**
 * Maximum drawdown (peak-to-trough) as percentage of peak.
 * Guards against non-positive peaks.
 */
export function maxDrawdown(closes) {
  if (!closes || closes.length < 2) return null;
  let peak = closes[0];
  let maxDd = 0;
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

// ---------- CSV Parser ----------
/**
 * Parse CSV/TSV/semicolon text → {o,h,l,c,v} candles.
 * - Case-insensitive headers
 * - Date column detected → chronological ascending sort (prevents reverse-order bias)
 * - Rejects non-positive prices, High < Low, non-finite values
 * - Extra columns ignored
 */
export function parseOHLCV(text) {
  if (!text || typeof text !== 'string') return { candles: [], error: 'Empty data' };
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { candles: [], error: 'Need header + at least one row' };

  const first = lines[0];
  const delim = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const headers = first.split(delim).map(h =>
    h.trim().toLowerCase().replace(/["']/g, '').replace(/\s+/g, '')
  );

  const find = (aliases) => {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      for (const a of aliases) {
        if (h === a || h.includes(a)) return i;
      }
    }
    return -1;
  };

  let di = find(['date', 'time', 'timestamp', 'datetime']);
  let oi = find(['open', 'o']);
  let hi = find(['high', 'h']);
  let li = find(['low', 'l']);
  let ci = find(['close', 'c', 'adjclose', 'adj']);
  let vi = find(['volume', 'vol', 'v']);

  // Positional fallback: Date,Open,High,Low,Close[,Volume]
  if ([oi, hi, li, ci].some(x => x < 0)) {
    di = 0; oi = 1; hi = 2; li = 3; ci = 4; vi = 5;
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim).map(x => x.trim().replace(/["']/g, ''));
    const o = +cols[oi], h = +cols[hi], l = +cols[li], c = +cols[ci];
    if (![o, h, l, c].every(isNum)) continue;
    // Reject non-positive prices and inverted bars
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    if (h < l) continue;
    const vRaw = vi >= 0 && cols[vi] !== undefined && cols[vi] !== '' ? +cols[vi] : NaN;
    const v = isNum(vRaw) && vRaw >= 0 ? vRaw : NaN;

    let ts = null;
    if (di >= 0 && cols[di] !== undefined) {
      const parsed = Date.parse(cols[di]);
      if (Number.isFinite(parsed)) ts = parsed;
    }
    rows.push({ o, h, l, c, v, ts });
  }

  if (rows.length === 0) return { candles: [], error: 'No valid OHLC rows found' };

  // Sort ascending by date when a majority of rows have parseable dates
  const dated = rows.filter(r => r.ts != null);
  if (dated.length >= rows.length * 0.5) {
    rows.sort((a, b) => {
      if (a.ts == null && b.ts == null) return 0;
      if (a.ts == null) return 1;
      if (b.ts == null) return -1;
      return a.ts - b.ts;
    });
  }

  // Strip helper field
  const candles = rows.map(({ o, h, l, c, v }) => ({ o, h, l, c, v }));
  return { candles, error: null };
}

// ---------- Decision Engine ----------
export function analyze(candles, options = {}) {
  const cfg = CONFIG;
  if (!candles || candles.length < cfg.minCandles) {
    return {
      ok: false,
      error: `At least ${cfg.minCandles} valid candles required (got ${candles ? candles.length : 0})`
    };
  }

  // Final sanity filter – never let invalid numbers reach indicators
  const clean = [];
  for (const c of candles) {
    if ([c.o, c.h, c.l, c.c].every(x => isNum(x) && x > 0) && c.h >= c.l) {
      clean.push({
        o: c.o, h: c.h, l: c.l, c: c.c,
        v: (isNum(c.v) && c.v >= 0) ? c.v : NaN
      });
    }
  }
  if (clean.length < cfg.minCandles) {
    return {
      ok: false,
      error: `At least ${cfg.minCandles} valid candles required after cleaning (got ${clean.length})`
    };
  }

  const closes = clean.map(c => c.c);
  let price = isNum(options.currentPrice) && options.currentPrice > 0
    ? options.currentPrice
    : last(closes);
  if (!isNum(price) || price <= 0) price = last(closes);

  const e20 = ema(closes, cfg.smaFast);
  const e50 = ema(closes, cfg.smaSlow);
  const r = rsi(closes);
  const m = macd(closes);
  const a = atr(clean);
  const mom = momentum(closes);
  const volPct = volatility(clean);
  const { support, resistance } = supportResistance(clean);
  const volA = volumeAnalysis(clean);
  const brk = detectBreakout(clean);
  const dd = maxDrawdown(closes);

  let score = 50;
  const reasons = [];
  let trend = 'Neutral';

  // Trend (EMA) – equality treated as neutral for that component
  if (e20 != null) {
    if (price > e20) { score += cfg.weights.trendEma20; reasons.push('Price above EMA20'); }
    else if (price < e20) { score -= cfg.weights.trendEma20; reasons.push('Price below EMA20'); }
  }
  if (e50 != null) {
    if (price > e50) {
      score += cfg.weights.trendEma50;
      trend = 'Bullish';
      reasons.push('Price above EMA50 (bullish structure)');
    } else if (price < e50) {
      score -= cfg.weights.trendEma50;
      trend = 'Bearish';
      reasons.push('Price below EMA50 (bearish structure)');
    }
  }
  if (e20 != null && e50 != null) {
    if (e20 > e50 && price > e20) trend = 'Strong Bullish';
    else if (e20 < e50 && price < e20) trend = 'Strong Bearish';
  }

  // RSI
  if (r != null) {
    if (r < 30) { score += cfg.weights.rsiOversold; reasons.push('RSI oversold'); }
    else if (r < 45) score += cfg.weights.rsiMildBull;
    else if (r > 70) { score += cfg.weights.rsiOverbought; reasons.push('RSI overbought'); }
    else if (r > 60) score += cfg.weights.rsiMildBear;
  }

  // MACD (exactly 0 → neutral, no score change)
  if (m.macd != null) {
    if (m.macd > 0) { score += cfg.weights.macdBull; reasons.push('MACD positive'); }
    else if (m.macd < 0) { score += cfg.weights.macdBear; reasons.push('MACD negative'); }
  }

  // Momentum
  if (mom != null) {
    if (mom > 2) { score += cfg.weights.momentumBull; reasons.push('Positive momentum'); }
    else if (mom < -2) { score += cfg.weights.momentumBear; reasons.push('Negative momentum'); }
  }

  // Support / Resistance proximity (relative distance)
  if (support != null && price > 0) {
    const distSup = (price - support) / price;
    if (Number.isFinite(distSup) && distSup < 0.04) {
      score += cfg.weights.nearSupport;
      reasons.push('Near support');
    }
  }
  if (resistance != null && price > 0) {
    const distRes = (resistance - price) / price;
    if (Number.isFinite(distRes) && (distRes < 0.02 || price >= resistance * 0.98)) {
      score += cfg.weights.nearResistance;
      reasons.push('Near resistance');
    }
  }

  // Volatility
  if (volPct != null) {
    if (volPct > 8) { score += cfg.weights.highVolPenalty; reasons.push('Elevated volatility'); }
    else if (volPct < 3.5) { score += cfg.weights.lowVolBonus; }
  }

  // Volume
  if (volA.spike) { score += cfg.weights.volumeSpike; reasons.push('Volume spike'); }
  else if (volA.weak) { score += cfg.weights.volumeWeak; }

  // Breakout
  if (brk.up) { score += cfg.weights.breakout; reasons.push('Upside breakout'); }
  else if (brk.down) { score -= cfg.weights.breakout; reasons.push('Downside breakout'); }

  // Risk/Reward (only when both sides valid and downside > 0)
  const range = (resistance != null && support != null && resistance > support)
    ? resistance - support
    : 0;
  if (range > 0 && price > 0) {
    const upside = resistance - price;
    const downside = price - support;
    if (downside > 0 && Number.isFinite(upside / downside) && upside / downside >= 1.5) {
      score += cfg.weights.riskReward;
    }
  }

  // Clamp – never leave the [0,100] interval
  score = Math.round(Math.max(0, Math.min(100, score)));
  if (!Number.isFinite(score)) score = 50;

  let signal = 'HOLD';
  if (score >= cfg.buyThreshold) signal = 'BUY';
  else if (score <= cfg.sellThreshold) signal = 'SELL';

  // Target / Stop (heuristic from range; never produce NaN)
  let target = price;
  let stop = price;
  if (range > 0 && isNum(price)) {
    if (signal === 'BUY') {
      target = Math.max(resistance, price + range * 0.35);
      stop = Math.max(0, support - range * 0.08);
    } else if (signal === 'SELL') {
      target = Math.min(support, price - range * 0.35);
      stop = resistance + range * 0.08;
    } else {
      target = price + range * 0.15;
      stop = Math.max(0, support - range * 0.05);
    }
  }
  if (!isNum(target)) target = price;
  if (!isNum(stop)) stop = price;

  // Risk level
  let riskLevel = 'Medium';
  if (volPct != null) {
    if (volPct > 7 || (dd != null && dd > 25)) riskLevel = 'High';
    else if (volPct < 3 && (dd == null || dd < 10)) riskLevel = 'Low';
  }

  let lead;
  if (signal === 'BUY') lead = 'Evidence currently favors an upside scenario.';
  else if (signal === 'SELL') lead = 'Evidence currently favors a downside scenario.';
  else lead = 'Signals are mixed; no clear directional edge.';

  const report = `${lead} Trend: ${trend}. Key factors: ${reasons.slice(0, 5).join('; ') || 'none dominant'}.`;

  return {
    ok: true,
    signal,
    score,
    trend,
    riskLevel,
    support,
    resistance,
    target,
    stop,
    price,
    rsi: r,
    macd: m.macd,
    atr: a,
    atrPct: volPct,
    momentum: mom,
    drawdown: dd,
    volumeRatio: volA.ratio,
    breakout: brk,
    report,
    reasons,
    candleCount: clean.length
  };
}
