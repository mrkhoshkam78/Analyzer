/**
 * Analysis Orchestrator
 * parseOHLCV + runDecision pipeline. Worker-compatible API.
 */
import { runDecision } from './decision.js';
import { createPrediction } from './prediction.js';
import { isNum } from './indicators.js';

export function parseOHLCV(text) {
  if (!text || typeof text !== 'string') return { candles: [], error: 'داده خالی است.' };
  const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { candles: [], error: 'حداقل یک ردیف عنوان و یک ردیف داده لازم است.' };

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

  if (rows.length === 0) return { candles: [], error: 'هیچ ردیف OHLC معتبری یافت نشد.' };

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
