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
import { XAUUSD_1D_SEED } from './xauusd_seed.js';
import { BRENT_1D_SEED } from './brent_seed.js';

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

  // Auto-seed bundled 1D historical data if store is empty
  if ((!data || data.length === 0) && t === '1D') {
    let seed = null;
    if (s === 'XAUUSD' && Array.isArray(XAUUSD_1D_SEED) && XAUUSD_1D_SEED.length) seed = XAUUSD_1D_SEED;
    else if (s === 'BRENT' && Array.isArray(BRENT_1D_SEED) && BRENT_1D_SEED.length) seed = BRENT_1D_SEED;
    if (seed) {
      data = seed.map(c => ({
        o: c.o, h: c.h, l: c.l, c: c.c, v: c.v ?? 0,
        ts: c.ts,
        day: c.day || (c.ts != null ? dayKey(c.ts) : null),
        bucket: c.day || (c.ts != null ? timeBucketKey(c.ts, t) : null)
      }));
      writeStore(keyHist(s, t), data);
    }
  }

  cache.hist[ck] = data;
  return data;
}

/**
 * V10.0.1 — Load OHLCV from project data/ folder (relative paths).
 * Paths: data/{SYM}/{sym}-{tf}.csv , data/{SYM}/{TF}.csv , aliases 1D/4H/1H
 * Safe on file:// (fails silently). Call once per symbol×tf when store is sparse.
 */
export async function ensureProjectData(symbol, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const existing = loadHistorical(s, t);
  if (existing && existing.length >= 30) return { ok: true, source: 'store', count: existing.length };

  const symLower = s.toLowerCase();
  const tLower = t.toLowerCase();
  const candidates = [
    `data/${s}/${symLower}-${tLower}.csv`,
    `data/${s}/${symLower}-1d.csv`,
    `data/${s}/${t}.csv`,
    `data/${s}/${tLower}.csv`,
    `data/${s}_${t}.csv`,
    `data/${s}_${tLower}.csv`,
    `data/${s}/1D.csv`,
    `data/${s}/4H.csv`,
    `data/${s}/1H.csv`,
    `data/${s}_1D.csv`
  ];
  if (t === '1D') {
    candidates.unshift(`data/${s}/${symLower}-1d.csv`, `data/${s}/1D.csv`);
  } else if (t === '4H') {
    candidates.unshift(`data/${s}/${symLower}-4h.csv`, `data/${s}/4H.csv`);
  } else if (t === '1H') {
    candidates.unshift(`data/${s}/${symLower}-1h.csv`, `data/${s}/1H.csv`);
  }

  const seen = new Set();
  for (const path of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.length < 40) continue;
      const result = importHistoricalCsv(s, t, text, 'skip');
      if (result && result.ok) {
        const after = loadHistorical(s, t);
        return { ok: true, source: path, count: after.length, added: result.added || 0 };
      }
    } catch {
      /* file:// or missing — ignore */
    }
  }
  return { ok: false, source: null, count: existing?.length || 0 };
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
        if (ts == null) ts = d.getTime();
        // Keep explicit day/bucket (form date) so calendar bias matches selected day
        if (!bucket) bucket = timeBucketKey(d, t);
      }
    }
    if (!bucket && e.day) bucket = e.day;
    if (!bucket) continue;

    byBucket.set(bucket, {
      bucket,
      day: e.day || String(bucket).slice(0, 10),
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

/**
 * Per-day bias for calendar: +1 bullish (close>open), -1 bearish (close<open), 0 flat/unknown.
 * Manual records override historical for the same day.
 */
export function getDataDayBias(symbol, tf = '1D') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const hist = loadHistorical(s, t);
  const manual = loadManual(s, t);
  const map = Object.create(null);
  for (const c of hist) {
    const d = c.day || (c.ts != null ? dayKey(c.ts) : (c.bucket ? String(c.bucket).slice(0, 10) : null));
    if (!d) continue;
    const o = isNum(c.o) ? c.o : (isNum(c.open) ? c.open : null);
    const cl = isNum(c.c) ? c.c : (isNum(c.close) ? c.close : null);
    if (o == null || cl == null || o <= 0) continue;
    map[d] = cl > o ? 1 : cl < o ? -1 : 0;
  }
  for (const m of manual) {
    const d = m.day || (m.bucket ? String(m.bucket).slice(0, 10) : null);
    if (!d) continue;
    if (!isNum(m.open) || !isNum(m.close) || m.open <= 0) continue;
    map[d] = m.close > m.open ? 1 : m.close < m.open ? -1 : 0;
  }
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

/**
 * Normalize date/datetime strings (MT5: 2025.01.02 or 2025.01.02 15:00:00).
 * Returns { ts, day } or nulls.
 */
function parseBarDateTime(rawDate, rawTime) {
  let day = null;
  let ts = null;
  const dPart = String(rawDate || '').trim();
  const tPart = String(rawTime || '').trim();
  if (!dPart) return { ts: null, day: null };

  // YYYY.MM.DD or YYYY-MM-DD or YYYY/MM/DD
  let normDay = dPart;
  const mDot = dPart.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (mDot) {
    normDay = `${mDot[1]}-${mDot[2].padStart(2, '0')}-${mDot[3].padStart(2, '0')}`;
    day = normDay;
  } else if (/^\d{4}-\d{2}-\d{2}/.test(dPart)) {
    day = dPart.slice(0, 10);
    normDay = day;
  }

  // Combined datetime in first column: "2025-01-02 15:00:00" or "2025.01.02 15:00"
  let timeStr = tPart;
  if (!timeStr && dPart.includes(' ')) {
    const sp = dPart.split(/\s+/);
    if (sp.length >= 2) {
      const m2 = sp[0].match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
      if (m2) {
        day = `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
        normDay = day;
        timeStr = sp[1];
      }
    }
  }

  if (/^\d{10,13}$/.test(dPart)) {
    ts = Number(dPart.length === 10 ? Number(dPart) * 1000 : dPart);
    day = dayKey(ts);
    return { ts, day };
  }

  if (normDay && /^\d{4}-\d{2}-\d{2}$/.test(normDay)) {
    const hm = (timeStr || '12:00:00').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    const hh = hm ? hm[1].padStart(2, '0') : '12';
    const mm = hm ? hm[2] : '00';
    const ss = hm && hm[3] ? hm[3] : '00';
    // Use local noon/default so calendar day matches CSV date (avoid UTC day-shift)
    const local = new Date(`${normDay}T${hh}:${mm}:${ss}`);
    if (Number.isFinite(local.getTime())) {
      ts = local.getTime();
      day = normDay;
    } else {
      const parsed = Date.parse(`${normDay}T${hh}:${mm}:${ss}`);
      if (Number.isFinite(parsed)) {
        ts = parsed;
        day = normDay;
      }
    }
  } else {
    const parsed = Date.parse(dPart);
    if (Number.isFinite(parsed)) {
      ts = parsed;
      day = dayKey(ts);
    }
  }
  return { ts, day };
}

/**
 * Parse OHLCV CSV text → candles[].
 * Accepts: date/datetime, optional time, open, high, low, close, volume/tickvol.
 * MT5-style dates (2025.01.02) supported. Does not invent volume; null if missing.
 */
export function parseOhlcvCsv(text, tf = '1D') {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { ok: false, error: 'CSV خالی یا ناقص', candles: [] };

  const header = lines[0].split(/[,;\t]/).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));
  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = idx(['datetime', 'timestamp', 'date', 'ts']);
  const iTime = idx(['time']);
  // if header has both date and time as separate cols, prefer date+time
  const iO = idx(['open', 'o']);
  const iH = idx(['high', 'h']);
  const iL = idx(['low', 'l']);
  const iC = idx(['close', 'c', 'price']);
  const iV = idx(['volume', 'vol', 'v', 'tickvol', 'tickvolume']);

  if (iC < 0) return { ok: false, error: 'ستون Close یافت نشد', candles: [] };

  const candles = [];
  const errors = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li].split(/[,;\t]/);
    const close = Number(cols[iC]);
    if (!Number.isFinite(close) || close <= 0) {
      errors.push(`ردیف ${li + 1}: Close نامعتبر`);
      continue;
    }
    const open = iO >= 0 ? Number(cols[iO]) : close;
    let high = iH >= 0 ? Number(cols[iH]) : Math.max(open, close);
    let low = iL >= 0 ? Number(cols[iL]) : Math.min(open, close);
    if (!Number.isFinite(open) || open <= 0) continue;
    if (!Number.isFinite(high) || !Number.isFinite(low)) {
      high = Math.max(open, close);
      low = Math.min(open, close);
    }
    if (high < low) { const tmp = high; high = low; low = tmp; }
    const vol = iV >= 0 && cols[iV] !== '' && Number.isFinite(Number(cols[iV])) ? Number(cols[iV]) : null;

    let ts = null;
    let day = null;
    if (iDate >= 0 && cols[iDate]) {
      const rawTime = iTime >= 0 && cols[iTime] ? cols[iTime] : '';
      const parsed = parseBarDateTime(cols[iDate], rawTime);
      ts = parsed.ts;
      day = parsed.day;
    }
    const bucket = ts != null
      ? timeBucketKey(ts, tf)
      : (day && (getTfMeta(tf).kind === 'day' || getTfMeta(tf).kind === 'week') ? day : null);
    candles.push({
      o: open, h: high, l: low, c: close, v: vol,
      ts,
      day: day || (ts != null ? dayKey(ts) : null),
      bucket
    });
  }

  // Sort + dedupe by ts or day
  candles.sort((a, b) => {
    const ta = a.ts ?? 0, tb = b.ts ?? 0;
    if (ta !== tb) return ta - tb;
    return String(a.day || '').localeCompare(String(b.day || ''));
  });
  const deduped = [];
  const seen = new Set();
  for (const c of candles) {
    const k = c.ts != null ? `t:${c.ts}` : `d:${c.day}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(c);
  }

  return {
    ok: deduped.length > 0,
    candles: deduped,
    error: deduped.length ? null : 'هیچ کندل معتبری parse نشد',
    skipped: errors.length,
    parseErrors: errors.slice(0, 10)
  };
}

/**
 * Merge imported candles into historical store for asset×tf.
 * mode: 'replace' | 'skip' for overlapping timestamps.
 */
export function importHistoricalCsv(symbol, tf, csvText, mode = 'replace') {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const parsed = parseOhlcvCsv(csvText, t);
  if (!parsed.ok) return { ok: false, error: parsed.error, parseErrors: parsed.parseErrors };

  const existing = loadHistorical(s, t).slice();
  const byKey = new Map();
  for (const c of existing) {
    const k = c.ts != null ? `t:${c.ts}` : `d:${c.day}`;
    byKey.set(k, c);
  }

  let added = 0, updated = 0, skipped = 0;
  for (const c of parsed.candles) {
    const k = c.ts != null ? `t:${c.ts}` : `d:${c.day}`;
    if (byKey.has(k)) {
      if (mode === 'skip') { skipped++; continue; }
      byKey.set(k, c);
      updated++;
    } else {
      byKey.set(k, c);
      added++;
    }
  }

  const merged = Array.from(byKey.values()).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  setHistorical(s, merged, t);
  invalidateDayIndex(s, t);

  // Detect gaps (daily only simple)
  let gaps = 0;
  if (t === '1D' && merged.length > 2) {
    for (let i = 1; i < merged.length; i++) {
      if (merged[i].ts != null && merged[i - 1].ts != null) {
        const days = (merged[i].ts - merged[i - 1].ts) / 86400000;
        if (days > 4) gaps++;
      }
    }
  }

  return {
    ok: true,
    added,
    updated,
    skipped,
    total: merged.length,
    gaps,
    volumeAvailable: merged.some(c => c.v != null && c.v > 0),
    from: merged[0]?.day || null,
    to: merged[merged.length - 1]?.day || null
  };
}

/**
 * Dataset coverage report for UI.
 */
export function getDatasetCoverage(symbol) {
  const s = String(symbol || '').toUpperCase();
  const out = {};
  for (const tf of TIMEFRAMES) {
    try {
      const hist = loadHistorical(s, tf.id);
      out[tf.id] = {
        count: hist.length,
        from: hist[0]?.day || null,
        to: hist[hist.length - 1]?.day || null,
        hasVolume: hist.some(c => c.v != null && c.v > 0)
      };
    } catch {
      out[tf.id] = { count: 0, from: null, to: null, hasVolume: false };
    }
  }
  return out;
}

/**
 * Build CSV text from merged historical + manual series (no fabricated fields).
 * Suitable for download and later re-upload.
 */
export function exportMergedCSV(symbol, tf = '1D') {
  const series = buildAnalysisSeries(symbol, tf);
  const lines = ['Date,Open,High,Low,Close,Volume'];
  for (const c of series.candles || []) {
    let dateStr = '';
    if (c.bucket) dateStr = String(c.bucket).slice(0, 16);
    else if (c.ts != null && Number.isFinite(c.ts)) {
      const d = new Date(c.ts);
      dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const vol = (c.v != null && Number.isFinite(c.v)) ? c.v : '';
    lines.push([
      dateStr,
      c.o,
      c.h,
      c.l,
      c.c,
      vol
    ].join(','));
  }
  return {
    csv: lines.join('\n'),
    count: series.candles?.length || 0,
    histCount: series.histCount,
    manualCount: series.manualCount,
    filename: `${String(symbol).toUpperCase()}_${tf}_merged.csv`
  };
}

/**
 * Promote all current manual entries into historical store (merge),
 * so they survive as permanent CSV-backed series. Manual list is kept
 * (still useful for overrides) unless clearManualAfter is true.
 */
export function promoteManualIntoHistorical(symbol, tf = '1D', clearManualAfter = false) {
  const s = assertSymbol(symbol);
  const t = assertTf(tf);
  const series = buildAnalysisSeries(s, t);
  const candles = (series.candles || []).map(c => ({
    o: c.o,
    h: c.h,
    l: c.l,
    c: c.c,
    v: Number.isFinite(c.v) ? c.v : null,
    ts: c.ts || null,
    day: c.bucket ? String(c.bucket).slice(0, 10) : null,
    bucket: c.bucket || null
  }));
  setHistorical(s, candles, t);
  if (clearManualAfter) clearManual(s, t);
  return {
    ok: true,
    total: candles.length,
    promotedFromManual: series.manualCount
  };
}
