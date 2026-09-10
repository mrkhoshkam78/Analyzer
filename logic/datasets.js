/**
 * Per-asset Dataset layer (V5)
 * Independent storage, lazy load, session cache.
 * Historical OHLCV is immutable in storage.
 * Manual prices = Close only — never fabricate OHLC.
 */
import { isAllowedSymbol } from './symbols.js';
import { isNum } from './indicators.js';

const PREFIX = 'oma_v5_';
const VERSION = 5;

/** Session cache: only loaded symbols */
const cache = {
  hist: Object.create(null),
  manual: Object.create(null)
};

function keyHist(symbol) {
  return PREFIX + 'hist_' + symbol;
}
function keyManual(symbol) {
  return PREFIX + 'manual_' + symbol;
}

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    if (obj && obj._v === VERSION) return obj.data;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ _v: VERSION, ts: Date.now(), data }));
    return true;
  } catch {
    return false;
  }
}

function assertSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (!isAllowedSymbol(s)) throw new Error('نماد نامعتبر است.');
  return s;
}

/** Day key YYYY-MM-DD in local time */
export function dayKey(tsOrDate) {
  const d = tsOrDate instanceof Date ? tsOrDate : new Date(tsOrDate);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dayKeyOffset(offsetDays) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return dayKey(d);
}

/**
 * Lazy-load historical OHLCV for one symbol only.
 * Does not load other symbols.
 */
export function loadHistorical(symbol) {
  const s = assertSymbol(symbol);
  if (cache.hist[s] !== undefined) return cache.hist[s];
  const data = readStore(keyHist(s), []) || [];
  cache.hist[s] = data;
  return data;
}

/**
 * Replace historical dataset for one symbol (from validated OHLCV import).
 * Does not touch other symbols. Manual prices remain separate.
 */
export function setHistorical(symbol, candles) {
  const s = assertSymbol(symbol);
  const clean = [];
  for (const c of candles || []) {
    if (![c.o, c.h, c.l, c.c].every(x => isNum(x) && x > 0) || c.h < c.l) continue;
    clean.push({
      o: c.o,
      h: c.h,
      l: c.l,
      c: c.c,
      v: isNum(c.v) && c.v >= 0 ? c.v : null,
      ts: Number.isFinite(c.ts) ? c.ts : null,
      day: c.day || (c.ts != null ? dayKey(c.ts) : null)
    });
  }
  writeStore(keyHist(s), clean);
  cache.hist[s] = clean;
  return clean.length;
}

/** Lazy-load manual closes for one symbol */
export function loadManual(symbol) {
  const s = assertSymbol(symbol);
  if (cache.manual[s] !== undefined) return cache.manual[s];
  const data = readStore(keyManual(s), []) || [];
  cache.manual[s] = data;
  return data;
}

/**
 * Upsert manual close-only prices for one symbol.
 * entries: [{ day: 'YYYY-MM-DD', close: number }]
 * Duplicate day → replace (update).
 */
export function upsertManualPrices(symbol, entries) {
  const s = assertSymbol(symbol);
  const list = loadManual(s).slice();
  const byDay = new Map(list.map(x => [x.day, x]));

  let saved = 0;
  for (const e of entries || []) {
    if (!e || !e.day) continue;
    const close = Number(e.close);
    if (!Number.isFinite(close) || close <= 0) continue;
    byDay.set(e.day, {
      day: e.day,
      close,
      ts: Date.parse(e.day + 'T12:00:00'),
      updatedAt: Date.now()
    });
    saved++;
  }

  const next = Array.from(byDay.values()).sort((a, b) => {
    const ta = a.ts || 0, tb = b.ts || 0;
    return ta - tb;
  });
  writeStore(keyManual(s), next);
  cache.manual[s] = next;
  return { saved, total: next.length };
}

export function clearManual(symbol) {
  const s = assertSymbol(symbol);
  writeStore(keyManual(s), []);
  cache.manual[s] = [];
}

export function clearHistorical(symbol) {
  const s = assertSymbol(symbol);
  writeStore(keyHist(s), []);
  cache.hist[s] = [];
}

/**
 * Drop session cache for a symbol (storage remains).
 */
export function dropSessionCache(symbol) {
  if (!symbol) {
    for (const k of Object.keys(cache.hist)) delete cache.hist[k];
    for (const k of Object.keys(cache.manual)) delete cache.manual[k];
    return;
  }
  const s = String(symbol).toUpperCase();
  delete cache.hist[s];
  delete cache.manual[s];
}

/**
 * Build analysis-ready full OHLCV candles for ONE symbol.
 * - Uses historical OHLCV only for indicator series
 * - Manual closes update Close on matching day at merge-time (hist storage unchanged)
 * - Manual days without hist bar are NOT turned into fake OHLCV
 * Returns { candles, currentPrice, manualOnly, histCount, manualCount }
 */
export function buildAnalysisSeries(symbol) {
  const s = assertSymbol(symbol);
  const hist = loadHistorical(s);
  const manual = loadManual(s);
  const manualByDay = new Map(manual.map(m => [m.day, m.close]));

  const candles = [];
  for (const c of hist) {
    const day = c.day || (c.ts != null ? dayKey(c.ts) : null);
    let close = c.c;
    // Update close only when manual price fits the bar (no OHLC fabrication)
    if (day && manualByDay.has(day)) {
      const mc = manualByDay.get(day);
      if (isNum(mc) && mc >= c.l && mc <= c.h) close = mc;
    }
    candles.push({
      o: c.o,
      h: c.h,
      l: c.l,
      c: close,
      v: c.v != null ? c.v : NaN
    });
  }

  // latest manual close as optional current price
  let currentPrice = null;
  if (manual.length) {
    const last = manual[manual.length - 1];
    if (last && isNum(last.close) && last.close > 0) currentPrice = last.close;
  } else if (candles.length) {
    currentPrice = candles[candles.length - 1].c;
  }

  return {
    candles,
    currentPrice,
    histCount: hist.length,
    manualCount: manual.length,
    hasFullOHLC: candles.length > 0
  };
}

/**
 * Which symbols currently have session cache (for tests / debug).
 */
export function getCachedSymbols() {
  return {
    hist: Object.keys(cache.hist),
    manual: Object.keys(cache.manual)
  };
}

export function getAssetSummary(symbol) {
  const s = assertSymbol(symbol);
  const hist = loadHistorical(s);
  const manual = loadManual(s);
  const lastManual = manual.length ? manual[manual.length - 1] : null;
  const lastHist = hist.length ? hist[hist.length - 1] : null;
  return {
    symbol: s,
    histCount: hist.length,
    manualCount: manual.length,
    lastManualClose: lastManual ? lastManual.close : null,
    lastManualDay: lastManual ? lastManual.day : null,
    lastHistClose: lastHist ? lastHist.c : null
  };
}
