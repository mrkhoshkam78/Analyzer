/**
 * Per-asset Dataset layer V5.01
 * Independent hist/manual per (Asset × Timeframe), lazy load, session cache.
 * Manual: Open + Close only — never invent Volume; H/L only as max/min of known O/C when no hist bar.
 */
import { isNum } from './indicators.js';
import {
  isAllowedSymbol,
  getSymbol,
  getAllSymbols,
  registerCustomAsset
} from './symbols.js';

const PREFIX = 'oma_v5_';
const VERSION = 5; // keep storage version compatible

export const TIMEFRAMES = Object.freeze([
  { id: '1m', label: '1m', kind: 'minute' },
  { id: '5m', label: '5m', kind: 'minute' },
  { id: '15m', label: '15m', kind: 'minute' },
  { id: '30m', label: '30m', kind: 'minute' },
  { id: '1H', label: '1H', kind: 'hour' },
  { id: '4H', label: '4H', kind: 'hour' },
  { id: '1D', label: '1D', kind: 'day' },
  { id: '1W', label: '1W', kind: 'week' }
]);

const cache = {
  hist: Object.create(null),
  manual: Object.create(null)
};

function cacheKey(symbol, tf) {
  return String(symbol).toUpperCase() + '::' + String(tf || '1D');
}
function keyHist(symbol, tf) {
  return PREFIX + 'hist_' + String(symbol).toUpperCase() + '_' + (tf || '1D');
}
function keyManual(symbol, tf) {
  return PREFIX + 'manual_' + String(symbol).toUpperCase() + '_' + (tf || '1D');
}

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    if (obj && obj._v === VERSION) return obj.data;
    // migrate old symbol-only keys silently if present
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
  if (!getSymbol(s) && !isAllowedSymbol(s)) throw new Error('نماد نامعتبر است.');
  return s;
}

function assertTf(tf) {
  const id = String(tf || '1D');
  if (!TIMEFRAMES.some(t => t.id === id)) return '1D';
  return id;
}

export function getTfMeta(tf) {
  return TIMEFRAMES.find(t => t.id === tf) || TIMEFRAMES.find(t => t.id === '1D');
}

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

/** Bucket key for timeframe matching */
export function timeBucketKey(tsOrDate, tf) {
  const d = tsOrDate instanceof Date ? tsOrDate : new Date(tsOrDate);
  if (!Number.isFinite(d.getTime())) return null;
  const meta = getTfMeta(tf);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (meta.kind === 'day' || meta.kind === 'week') return `${y}-${m}-${day}`;
  if (meta.kind === 'hour') return `${y}-${m}-${day}T${hh}`;
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export function loadHistorical(symbol, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const ck = cacheKey(s, t);
  if (cache.hist[ck] !== undefined) return cache.hist[ck];
  // try new key then legacy key without tf
  let data = readStore(keyHist(s, t), null);
  if (data == null && t === '1D') {
    data = readStore(PREFIX + 'hist_' + s, []) || [];
  }
  data = data || [];
  cache.hist[ck] = data;
  return data;
}

export function setHistorical(symbol, candles, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const clean = [];
  for (const c of candles || []) {
    if (![c.o, c.h, c.l, c.c].every(x => isNum(x) && x > 0) || c.h < c.l) continue;
    const ts = Number.isFinite(c.ts) ? c.ts : null;
    clean.push({
      o: c.o, h: c.h, l: c.l, c: c.c,
      v: isNum(c.v) && c.v >= 0 ? c.v : null,
      ts,
      day: c.day || (ts != null ? dayKey(ts) : null),
      bucket: c.bucket || (ts != null ? timeBucketKey(ts, t) : null)
    });
  }
  writeStore(keyHist(s, t), clean);
  cache.hist[cacheKey(s, t)] = clean;
  if (cache.dayIndex) delete cache.dayIndex[cacheKey(s, t)];
  return clean.length;
}

export function loadManual(symbol, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const ck = cacheKey(s, t);
  if (cache.manual[ck] !== undefined) return cache.manual[ck];
  let data = readStore(keyManual(s, t), null);
  if (data == null && t === '1D') {
    // migrate legacy close-only records
    const legacy = readStore(PREFIX + 'manual_' + s, []) || [];
    data = legacy.map(x => ({
      bucket: x.day || x.bucket,
      day: x.day || x.bucket,
      open: isNum(x.open) ? x.open : (isNum(x.close) ? x.close : null),
      close: isNum(x.close) ? x.close : null,
      ts: x.ts || null,
      timeframe: t,
      updatedAt: x.updatedAt || null
    })).filter(x => isNum(x.close) && x.close > 0);
  }
  data = data || [];
  cache.manual[ck] = data;
  return data;
}

/**
 * Upsert manual Open+Close for asset×timeframe.
 * entries: [{ datetime|day|bucket, open, close }]
 */
export function upsertManualPrices(symbol, entries, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const list = loadManual(s, t).slice();
  const byBucket = new Map(list.map(x => [x.bucket, x]));
  let saved = 0;

  for (const e of entries || []) {
    if (!e) continue;
    const open = Number(e.open);
    const close = Number(e.close);
    if (!Number.isFinite(close) || close <= 0) continue;
    if (!Number.isFinite(open) || open <= 0) continue;

    let bucket = e.bucket || e.day || null;
    let ts = e.ts || null;
    if (e.datetime) {
      const d = new Date(e.datetime);
      if (Number.isFinite(d.getTime())) {
        ts = d.getTime();
        bucket = timeBucketKey(d, t);
      }
    }
    if (!bucket && e.day) bucket = e.day;
    if (!bucket) continue;

    byBucket.set(bucket, {
      bucket,
      day: String(bucket).slice(0, 10),
      open,
      close,
      ts: ts || Date.parse(String(bucket).length === 10 ? bucket + 'T12:00:00' : bucket),
      timeframe: t,
      updatedAt: Date.now()
    });
    saved++;
  }

  const next = Array.from(byBucket.values()).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  writeStore(keyManual(s, t), next);
  cache.manual[cacheKey(s, t)] = next;
  if (cache.dayIndex) delete cache.dayIndex[cacheKey(s, t)];
  return { saved, total: next.length };
}

export function clearManual(symbol, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  writeStore(keyManual(s, t), []);
  cache.manual[cacheKey(s, t)] = [];
}

export function dropSessionCache(symbol, tf) {
  if (!symbol) {
    for (const k of Object.keys(cache.hist)) delete cache.hist[k];
    for (const k of Object.keys(cache.manual)) delete cache.manual[k];
    return;
  }
  const s = String(symbol).toUpperCase();
  if (tf) {
    const ck = cacheKey(s, tf);
    delete cache.hist[ck];
    delete cache.manual[ck];
  } else {
    for (const k of Object.keys(cache.hist)) if (k.startsWith(s + '::')) delete cache.hist[k];
    for (const k of Object.keys(cache.manual)) if (k.startsWith(s + '::')) delete cache.manual[k];
  }
}

/**
 * Merge historical + manual for Analysis.
 * - Match by timeframe bucket → replace Open/Close on hist bar (H/L/V kept from hist)
 * - Unmatched manual: enter series using only known O/C bounds (h=max,l=min of o,c); volume=NaN
 * - Never invent volume or external high/low
 */
export function buildAnalysisSeries(symbol, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const hist = loadHistorical(s, t);
  const manual = loadManual(s, t);
  const manualByBucket = new Map(manual.map(m => [m.bucket, m]));

  const candles = [];
  const usedBuckets = new Set();

  for (const c of hist) {
    const bucket = c.bucket || (c.ts != null ? timeBucketKey(c.ts, t) : c.day);
    let o = c.o, close = c.c, h = c.h, l = c.l;
    if (bucket && manualByBucket.has(bucket)) {
      const m = manualByBucket.get(bucket);
      if (isNum(m.open) && m.open > 0) o = m.open;
      if (isNum(m.close) && m.close > 0) close = m.close;
      // keep hist H/L; if O/C fall outside, expand to include real prices (not invent beyond known)
      h = Math.max(h, o, close);
      l = Math.min(l, o, close);
      usedBuckets.add(bucket);
    }
    candles.push({
      o, h, l, c: close,
      v: c.v != null ? c.v : NaN,
      ts: c.ts || null,
      bucket
    });
  }

  // Append unmatched manual records into series (O/C known; H/L = bounds of O/C only)
  for (const m of manual) {
    if (usedBuckets.has(m.bucket)) continue;
    if (!isNum(m.open) || !isNum(m.close) || m.open <= 0 || m.close <= 0) continue;
    const hi = Math.max(m.open, m.close);
    const lo = Math.min(m.open, m.close);
    candles.push({
      o: m.open,
      h: hi,
      l: lo,
      c: m.close,
      v: NaN,
      ts: m.ts || null,
      bucket: m.bucket,
      fromManual: true
    });
  }

  // sort by ts when available
  candles.sort((a, b) => {
    if (a.ts != null && b.ts != null) return a.ts - b.ts;
    if (a.bucket && b.bucket) return String(a.bucket).localeCompare(String(b.bucket));
    return 0;
  });

  let currentPrice = null;
  if (manual.length) {
    const last = manual[manual.length - 1];
    if (last && isNum(last.close)) currentPrice = last.close;
  } else if (candles.length) {
    currentPrice = candles[candles.length - 1].c;
  }

  return {
    candles,
    currentPrice,
    histCount: hist.length,
    manualCount: manual.length,
    mergedCount: candles.length,
    hasFullOHLC: candles.length > 0,
    timeframe: t,
    symbol: s
  };
}

export function getCachedSymbols() {
  return {
    hist: Object.keys(cache.hist),
    manual: Object.keys(cache.manual)
  };
}

export function getAssetSummary(symbol, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const hist = loadHistorical(s, t);
  const manual = loadManual(s, t);
  const lastManual = manual.length ? manual[manual.length - 1] : null;
  return {
    symbol: s,
    timeframe: t,
    histCount: hist.length,
    manualCount: manual.length,
    lastManualClose: lastManual ? lastManual.close : null,
    lastManualOpen: lastManual ? lastManual.open : null,
    lastManualBucket: lastManual ? lastManual.bucket : null
  };
}

export function addCustomAsset(meta) {
  return registerCustomAsset(meta);
}

export function listAssets() {
  return getAllSymbols();
}

/**
 * Index of calendar days (YYYY-MM-DD) that have valid data for Asset×Timeframe.
 * Merges historical + manual. Value = record count that day.
 * Cached per session under cache.dayIndex.
 */
export function getDataDayIndex(symbol, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const ck = cacheKey(s, t);
  if (!cache.dayIndex) cache.dayIndex = Object.create(null);
  // rebuild always from current hist/manual (cheap for typical sizes)
  const hist = loadHistorical(s, t);
  const manual = loadManual(s, t);
  const map = Object.create(null);
  for (const c of hist) {
    const d = c.day || (c.ts != null ? dayKey(c.ts) : (c.bucket ? String(c.bucket).slice(0, 10) : null));
    if (!d) continue;
    map[d] = (map[d] || 0) + 1;
  }
  for (const m of manual) {
    const d = m.day || (m.bucket ? String(m.bucket).slice(0, 10) : null);
    if (!d) continue;
    map[d] = (map[d] || 0) + 1;
  }
  cache.dayIndex[ck] = map;
  return map;
}

export function invalidateDayIndex(symbol, tf) {
  if (!cache.dayIndex) return;
  if (!symbol) {
    cache.dayIndex = Object.create(null);
    return;
  }
  const s = String(symbol).toUpperCase();
  if (tf) delete cache.dayIndex[cacheKey(s, tf)];
  else {
    for (const k of Object.keys(cache.dayIndex)) {
      if (k.startsWith(s + '::')) delete cache.dayIndex[k];
    }
  }
}
