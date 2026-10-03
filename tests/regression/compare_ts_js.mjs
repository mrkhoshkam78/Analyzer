/**
 * Compare TypeScript adapter indicators vs original JS baseline golden.
 * Run: node tests/regression/compare_ts_js.mjs
 *
 * Note: TS adapters are currently a direct port of JS, so diffs must be ~0.
 * After Rust/WASM integration, re-run against the same golden file.
 */
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const golden = JSON.parse(
  readFileSync(join(ROOT, 'tests/golden/indicators_baseline_v11.6.0.json'), 'utf8')
);

// Re-run original JS for live compare on XAUUSD-1D
const indicators = await import(pathToFileURL(join(ROOT, 'logic/indicators.js')).href);

function parseMT5Csv(text, hasTime = false) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (line.startsWith('<') || /date/i.test(line)) continue;
    const cols = line.split(/\t|,/).map((s) => s.trim());
    if (cols.length < 5) continue;
    if (hasTime) {
      const [dateStr, timeStr, o, h, l, c] = cols;
      rows.push({ o: +o, h: +h, l: +l, c: +c, v: +(cols[6] || cols[5] || 0), day: String(dateStr).replace(/\./g, '-') });
    } else {
      const [dateStr, o, h, l, c] = cols;
      rows.push({ o: +o, h: +h, l: +l, c: +c, v: +(cols[5] || 0), day: String(dateStr).replace(/\./g, '-') });
    }
  }
  return rows;
}

function approx(a, b, tol = 1e-9) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b) || deepApprox(a, b, tol);
  return Math.abs(a - b) <= tol || Math.abs(a - b) / (Math.abs(b) + 1e-15) <= 1e-9;
}

function deepApprox(a, b, tol) {
  if (a == null && b == null) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return approx(a, b, tol);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!approx(a[k], b[k], tol)) return false;
  }
  return true;
}

const text = readFileSync(join(ROOT, 'data/XAUUSD/xauusd-1d.csv'), 'utf8');
const candles = parseMT5Csv(text, false);
const closes = candles.map((c) => c.c);

const live = {
  sma20: indicators.sma(closes, 20),
  rsi14: indicators.rsi(closes, 14),
  ema12: indicators.ema(closes, 12),
  atr14: indicators.atr(candles, 14),
  macd: indicators.macd(closes),
};

const g = golden['XAUUSD-1D'];
const checks = [
  ['sma20', live.sma20, g.sma20],
  ['rsi14', live.rsi14, g.rsi14],
  ['ema12', live.ema12, g.ema12],
  ['atr14', live.atr14, g.atr14],
];

let pass = 0;
let fail = 0;
for (const [name, a, b] of checks) {
  const ok = approx(a, b);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: live=${a} golden=${b}`);
  if (ok) pass++; else fail++;
}

const macdOk = approx(live.macd.macd, g.macd.macd) && approx(live.macd.signal, g.macd.signal) && approx(live.macd.hist, g.macd.hist);
console.log(`${macdOk ? 'PASS' : 'FAIL'} macd`);
if (macdOk) pass++; else fail++;

console.log(`\nResult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
