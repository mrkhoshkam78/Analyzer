/**
 * Analysis Orchestrator
 * parseOHLCV + runDecision pipeline. Worker-compatible API.
 * Formulas live in indicators/technical/decision — unchanged here.
 */
import { runDecision } from './decision.js';
import { createPrediction } from './prediction.js';
import { isNum } from './indicators.js';

function detectDelim(line) {
  if (line.includes('\t')) return '\t';
  if (line.includes(';')) return ';';
  if (line.includes(',')) return ',';
  // multiple spaces / mixed whitespace columns
  if (/\s{2,}|\s/.test(line)) return 'whitespace';
  return ',';
}

function splitLine(line, delim) {
  if (delim === 'whitespace') {
    return line.trim().split(/\s+/);
  }
  return line.split(delim).map(x => x.trim().replace(/^["']|["']$/g, ''));
}

function looksLikeHeader(cols) {
  const joined = cols.join(' ').toLowerCase();
  if (/date|time|open|high|low|close|volume|vol\b/.test(joined)) return true;
  // if most cells are non-numeric → header
  let nonNum = 0;
  for (const c of cols) {
    if (c === '' || Number.isNaN(+c.replace?.(',', '.') ?? +c)) nonNum++;
  }
  return nonNum >= Math.ceil(cols.length * 0.5);
}

function findCol(headers, aliases) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    for (const a of aliases) {
      if (h === a || h.includes(a)) return i;
    }
  }
  return -1;
}

/**
 * Parse pasted / CSV text into OHLCV candles.
 * Supports comma, tab, semicolon, multi-space; with or without header.
 */
export function parseOHLCV(text) {
  if (!text || typeof text !== 'string') return { candles: [], error: 'داده خالی است.', rejected: 0 };
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 1) return { candles: [], error: 'داده خالی است.', rejected: 0 };

  const delim = detectDelim(lines[0]);
  const firstCols = splitLine(lines[0], delim);
  const hasHeader = looksLikeHeader(firstCols);

  let di = -1, oi = -1, hi = -1, li = -1, ci = -1, vi = -1;
  let startIdx = 0;

  if (hasHeader) {
    const headers = firstCols.map(h =>
      h.toLowerCase().replace(/["']/g, '').replace(/\s+/g, '')
    );
    di = findCol(headers, ['date', 'time', 'timestamp', 'datetime', 'تاریخ']);
    oi = findCol(headers, ['open', 'o', 'باز']);
    hi = findCol(headers, ['high', 'h', 'بالا', 'سقف']);
    li = findCol(headers, ['low', 'l', 'پایین', 'کف']);
    ci = findCol(headers, ['close', 'c', 'adjclose', 'adj', 'بسته']);
    vi = findCol(headers, ['volume', 'vol', 'v', 'حجم']);
    startIdx = 1;
    if ([oi, hi, li, ci].some(x => x < 0)) {
      // partial header — positional fallback relative to column count
      di = di >= 0 ? di : 0;
      oi = 1; hi = 2; li = 3; ci = 4; vi = 5;
    }
  } else {
    // headerless: Date Open High Low Close [Volume]
    di = 0; oi = 1; hi = 2; li = 3; ci = 4; vi = 5;
    startIdx = 0;
  }

  const rows = [];
  let rejected = 0;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitLine(lines[i], delim);
    if (cols.length < 4) { rejected++; continue; }

    const o = +String(cols[oi] ?? '').replace(',', '.');
    const h = +String(cols[hi] ?? '').replace(',', '.');
    const l = +String(cols[li] ?? '').replace(',', '.');
    const c = +String(cols[ci] ?? '').replace(',', '.');
    if (![o, h, l, c].every(isNum)) { rejected++; continue; }
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) { rejected++; continue; }
    if (h < l) { rejected++; continue; }

    const vRaw = vi >= 0 && cols[vi] !== undefined && cols[vi] !== ''
      ? +String(cols[vi]).replace(',', '.')
      : NaN;
    const v = isNum(vRaw) && vRaw >= 0 ? vRaw : NaN;

    let ts = null;
    if (di >= 0 && cols[di] !== undefined && cols[di] !== '') {
      const raw = cols[di];
      let parsed = Date.parse(raw);
      if (!Number.isFinite(parsed)) {
        // dd/mm/yyyy or dd-mm-yyyy
        const m = String(raw).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
        if (m) {
          const day = +m[1], mon = +m[2], year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
          parsed = Date.UTC(year, mon - 1, day);
        }
      }
      if (Number.isFinite(parsed)) ts = parsed;
    }
    rows.push({ o, h, l, c, v, ts, _i: i });
  }

  if (rows.length === 0) {
    return { candles: [], error: 'هیچ ردیف OHLC معتبری یافت نشد.', rejected };
  }

  // chronological sort when dates available
  const dated = rows.filter(r => r.ts != null);
  if (dated.length >= rows.length * 0.5) {
    rows.sort((a, b) => {
      if (a.ts == null && b.ts == null) return a._i - b._i;
      if (a.ts == null) return 1;
      if (b.ts == null) return -1;
      return a.ts - b.ts || a._i - b._i;
    });
  }

  // dedupe by timestamp (keep last)
  const seen = new Map();
  const unique = [];
  for (const r of rows) {
    const key = r.ts != null ? String(r.ts) : `row_${r._i}_${r.o}_${r.c}`;
    if (seen.has(key)) {
      const idx = seen.get(key);
      unique[idx] = r;
    } else {
      seen.set(key, unique.length);
      unique.push(r);
    }
  }

  const candles = unique.map(({ o, h, l, c, v, ts }) => ({ o, h, l, c, v, ts }));
  return { candles, error: null, rejected };
}

/**
 * Build OHLCV text from manual table rows (array of {date,o,h,l,c,v}).
 */
export function rowsToOHLCVText(rows) {
  const lines = ['Date,Open,High,Low,Close,Volume'];
  for (const r of rows) {
    if (!r) continue;
    lines.push([r.date || '', r.o, r.h, r.l, r.c, r.v ?? ''].join(','));
  }
  return lines.join('\n');
}

/**
 * Main entry: clean candles → decision → optional prediction record
 */
export function analyze(candles, options = {}) {
  if (!candles || !candles.length) {
    return { ok: false, error: 'داده کندل خالی است.' };
  }
  const clean = [];
  for (const c of candles) {
    if ([c.o, c.h, c.l, c.c].every(x => isNum(x) && x > 0) && c.h >= c.l) {
      clean.push({
        o: c.o, h: c.h, l: c.l, c: c.c,
        v: (isNum(c.v) && c.v >= 0) ? c.v : NaN
      });
    }
  }
  const result = runDecision(clean, {
    symbol: options.symbol || 'UNKNOWN',
    currentPrice: options.currentPrice,
    fundamentalSnapshot: options.fundamentalSnapshot || null,
    horizonBars: options.horizonBars
  });
  if (result.ok && options.recordPrediction !== false && options.symbol) {
    try {
      const rec = createPrediction(result, { timeframe: options.timeframe });
      result.predictionId = rec ? rec.id : null;
    } catch (_) {
      result.predictionId = null;
    }
  }
  return result;
}

export { runDecision } from './decision.js';
export { CONFIG } from './config.js';
