/**
 * MPB Data Quality Engine
 * Validates OHLCV before any pattern work. Never fabricates results when data is insufficient.
 */
import { isNum } from '../indicators.js';

const MIN_CANDLES_FOR_PATTERN = 40;
const MIN_CANDLES_FOR_MATCHING = 80;

/**
 * @param {Array<{t?:string,o:number,h:number,l:number,c:number,v?:number}>} candles
 * @returns {{ score: number, ok: boolean, issues: string[], stats: object, usableForMatching: boolean, usableForDiscovery: boolean }}
 */
export function assessDataQuality(candles) {
  const issues = [];
  const stats = {
    n: 0,
    missing: 0,
    duplicates: 0,
    invalidOHLC: 0,
    gaps: 0,
    outliers: 0,
    zeroVolume: 0,
    freq: null
  };

  if (!Array.isArray(candles) || candles.length === 0) {
    return {
      score: 0,
      ok: false,
      issues: ['NO_DATA'],
      stats,
      usableForMatching: false,
      usableForDiscovery: false
    };
  }

  stats.n = candles.length;
  const seen = new Set();
  let prevT = null;
  const closes = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c || !isNum(c.o) || !isNum(c.h) || !isNum(c.l) || !isNum(c.c)) {
      stats.missing++;
      issues.push(`MISSING_OHLC@${i}`);
      continue;
    }
    if (c.h < c.l || c.h < c.o || c.h < c.c || c.l > c.o || c.l > c.c) {
      stats.invalidOHLC++;
      issues.push(`INVALID_OHLC@${i}`);
    }
    const key = c.t != null ? String(c.t) : `${c.o}|${c.h}|${c.l}|${c.c}|${i}`;
    if (seen.has(key)) {
      stats.duplicates++;
      issues.push(`DUPLICATE@${i}`);
    }
    seen.add(key);

    if (c.v === 0 || c.v == null) stats.zeroVolume++;

    closes.push(c.c);

    if (prevT != null && c.t != null) {
      // simple gap detection for daily-ish series
      const d0 = Date.parse(prevT);
      const d1 = Date.parse(c.t);
      if (Number.isFinite(d0) && Number.isFinite(d1)) {
        const days = (d1 - d0) / 86400000;
        if (days > 5) {
          stats.gaps++;
          issues.push(`GAP@${i}`);
        }
      }
    }
    prevT = c.t ?? prevT;
  }

  // outlier check on returns
  if (closes.length >= 10) {
    const rets = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    if (sd > 0) {
      for (const r of rets) {
        if (Math.abs(r - mean) > 5 * sd) stats.outliers++;
      }
    }
  }

  // score 0–100
  let score = 100;
  score -= Math.min(40, stats.missing * 5);
  score -= Math.min(20, stats.duplicates * 3);
  score -= Math.min(25, stats.invalidOHLC * 8);
  score -= Math.min(15, stats.gaps * 2);
  score -= Math.min(10, stats.outliers * 2);
  if (stats.n < MIN_CANDLES_FOR_PATTERN) score -= 25;
  if (stats.n < 20) score -= 30;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const usableForDiscovery = stats.n >= MIN_CANDLES_FOR_PATTERN && score >= 55 && stats.invalidOHLC === 0;
  const usableForMatching = stats.n >= MIN_CANDLES_FOR_MATCHING && score >= 65 && stats.invalidOHLC === 0;

  if (stats.n < MIN_CANDLES_FOR_PATTERN) issues.push('INSUFFICIENT_HISTORY');
  if (stats.invalidOHLC > 0) issues.push('INVALID_OHLC_PRESENT');

  return {
    score,
    ok: score >= 50 && stats.invalidOHLC === 0,
    issues: [...new Set(issues)].slice(0, 12),
    stats,
    usableForMatching,
    usableForDiscovery,
    minRequired: MIN_CANDLES_FOR_PATTERN,
    minMatching: MIN_CANDLES_FOR_MATCHING
  };
}
