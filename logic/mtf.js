/**
 * Multi-Timeframe Analysis Engine V7.0.1
 * Top-down: 1W → 1D → 1H → 15m/5m roles.
 * Uses only available TFs; never fabricates candles.
 * No look-ahead: higher TF candles must close at or before asOfTs.
 */
import { CONFIG } from './config.js';
import { runTechnical } from './technical.js';
import { isNum, last } from './indicators.js';

/** Preferred hierarchy (id → role) */
export const TF_ROLES = Object.freeze({
  '1W': 'macro',
  '1D': 'primary',
  '4H': 'intermediate',
  '1H': 'intermediate',
  '30m': 'setup',
  '15m': 'setup',
  '5m': 'entry',
  '1m': 'entry'
});

export const TF_ORDER = ['1W', '1D', '4H', '1H', '30m', '15m', '5m', '1m'];

/**
 * Filter candles so only bars with ts <= asOfTs are used (no future HTF leakage).
 */
export function filterCandlesAsOf(candles, asOfTs) {
  if (!candles || !candles.length) return [];
  if (asOfTs == null || !Number.isFinite(asOfTs)) return candles.slice();
  return candles.filter(c => {
    const t = c.ts != null ? c.ts : (c.date ? Date.parse(c.date) : null);
    if (t == null) return true; // undated daily seeds treated as historical
    return t <= asOfTs;
  });
}

/**
 * Analyze one TF series → trend label + score + structure snapshot.
 */
function analyzeTf(candles, symbol, tf) {
  if (!candles || candles.length < Math.min(20, CONFIG.minCandles)) {
    return {
      tf,
      ok: false,
      reason: `داده ${tf} ناکافی (${candles?.length || 0})`,
      trend: null,
      score: null,
      support: null,
      resistance: null
    };
  }
  const tech = runTechnical(candles, { symbol, timeframe: tf });
  if (!tech.ok) {
    return { tf, ok: false, reason: tech.error, trend: null, score: null };
  }
  return {
    tf,
    ok: true,
    role: TF_ROLES[tf] || 'other',
    trend: tech.trend,
    score: tech.score,
    support: tech.indicators?.support ?? null,
    resistance: tech.indicators?.resistance ?? null,
    atr: tech.indicators?.atr ?? null,
    atrPct: tech.indicators?.atrPct ?? null,
    candleCount: candles.length,
    price: tech.indicators?.price
  };
}

/**
 * Direction from trend label.
 */
function trendDir(trend) {
  if (!trend) return 0;
  if (/Bull/i.test(trend)) return 1;
  if (/Bear/i.test(trend)) return -1;
  return 0;
}

/**
 * Multi-timeframe agreement.
 * @param {object} seriesMap { '1D': candles[], '1H': candles[], ... }
 * @param {object} opts { symbol, asOfTs, primaryTf }
 */
export function runMultiTimeframe(seriesMap, opts = {}) {
  const symbol = opts.symbol || 'UNKNOWN';
  const asOfTs = opts.asOfTs ?? null;
  const primaryTf = opts.primaryTf || '1D';

  const results = {};
  const available = [];

  for (const tf of TF_ORDER) {
    const raw = seriesMap?.[tf];
    if (!raw || !raw.length) continue;
    const filtered = filterCandlesAsOf(raw, asOfTs);
    const a = analyzeTf(filtered, symbol, tf);
    results[tf] = a;
    if (a.ok) available.push(a);
  }

  // Ensure primary is analyzed if present under another key
  if (!results[primaryTf] && seriesMap?.[primaryTf]) {
    const filtered = filterCandlesAsOf(seriesMap[primaryTf], asOfTs);
    results[primaryTf] = analyzeTf(filtered, symbol, primaryTf);
    if (results[primaryTf].ok) available.push(results[primaryTf]);
  }

  if (!available.length) {
    return {
      ok: false,
      error: 'هیچ تایم‌فریمی با داده کافی در دسترس نیست',
      frames: results,
      agreement: 0,
      agreementLabel: 'Insufficient',
      higherTrend: null,
      alignment: 'unknown',
      dataQualityPenalty: 0.4
    };
  }

  // Higher TF = first available in TF_ORDER among ok
  const higher = available.find(a => a.role === 'macro' || a.role === 'primary') || available[0];
  const intermediate = available.find(a => a.role === 'intermediate');
  const setup = available.find(a => a.role === 'setup');
  const entry = available.find(a => a.role === 'entry');

  const dirs = available.map(a => trendDir(a.trend));
  const nonZero = dirs.filter(d => d !== 0);
  let agreement = 0;
  let agreementLabel = 'Insufficient';
  let alignment = 'mixed';

  if (nonZero.length >= 2) {
    const bull = nonZero.filter(d => d > 0).length;
    const bear = nonZero.filter(d => d < 0).length;
    const majority = Math.max(bull, bear);
    agreement = majority / nonZero.length;
    if (agreement >= 0.85) {
      agreementLabel = 'Strong Agreement';
      alignment = bull > bear ? 'bullish' : 'bearish';
    } else if (agreement >= 0.6) {
      agreementLabel = 'Moderate Agreement';
      alignment = bull > bear ? 'bullish' : 'bearish';
    } else {
      agreementLabel = 'Conflict';
      alignment = 'conflict';
    }
  } else if (nonZero.length === 1) {
    agreement = 0.5;
    agreementLabel = 'Single TF';
    alignment = nonZero[0] > 0 ? 'bullish' : 'bearish';
  } else {
    agreementLabel = 'Neutral/Unclear';
    alignment = 'neutral';
  }

  // HTF vs LTF conflict flag
  const hDir = trendDir(higher?.trend);
  const lDir = trendDir((entry || setup || intermediate)?.trend);
  const htfLtfConflict = hDir !== 0 && lDir !== 0 && hDir !== lDir;

  return {
    ok: true,
    frames: results,
    availableTfs: available.map(a => a.tf),
    higherTrend: higher?.trend || null,
    higherTf: higher?.tf || null,
    intermediateTrend: intermediate?.trend || null,
    setupTrend: setup?.trend || null,
    entryTrend: entry?.trend || null,
    agreement: Math.round(agreement * 1000) / 1000,
    agreementLabel,
    alignment,
    htfLtfConflict,
    dataQualityPenalty: available.length < 2 ? 0.15 : 0,
    summary: buildMtfSummary(higher, intermediate, setup, entry, agreementLabel, alignment)
  };
}

function buildMtfSummary(h, mid, setup, entry, label, alignment) {
  const parts = [];
  if (h) parts.push(`${h.tf}: ${h.trend}`);
  if (mid) parts.push(`${mid.tf}: ${mid.trend}`);
  if (setup) parts.push(`${setup.tf}: ${setup.trend}`);
  if (entry) parts.push(`${entry.tf}: ${entry.trend}`);
  return `${parts.join(' | ') || '—'} → ${label} (${alignment})`;
}

/**
 * Resample lower TF candles to higher TF (OHLC).
 * Only for derivation when higher TF missing — no look-ahead within bar.
 */
export function resampleOHLCV(candles, targetTf) {
  if (!candles || candles.length < 2) return [];
  const meta = {
    '5m': 5, '15m': 15, '30m': 30, '1H': 60, '4H': 240, '1D': 1440, '1W': 10080
  };
  const minutes = meta[targetTf];
  if (!minutes) return [];

  const buckets = new Map();
  for (const c of candles) {
    const ts = c.ts != null ? c.ts : (c.date ? Date.parse(c.date) : null);
    if (ts == null || !isNum(c.c)) continue;
    const bucketTs = Math.floor(ts / (minutes * 60000)) * (minutes * 60000);
    let b = buckets.get(bucketTs);
    if (!b) {
      b = { o: c.o ?? c.c, h: c.h ?? c.c, l: c.l ?? c.c, c: c.c, v: c.v || 0, ts: bucketTs, n: 1 };
      buckets.set(bucketTs, b);
    } else {
      if (isNum(c.h)) b.h = Math.max(b.h, c.h);
      if (isNum(c.l)) b.l = Math.min(b.l, c.l);
      b.c = c.c;
      b.v += c.v || 0;
      b.n++;
    }
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}
