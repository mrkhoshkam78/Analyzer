/**
 * Regression baseline: original logic/indicators.js vs CSV golden.
 * Run: node tests/regression/indicators_baseline.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const indicators = await import(pathToFileURL(join(ROOT, 'logic/indicators.js')).href);

function parseMT5Csv(text, hasTime = false) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (line.startsWith('<') || /date/i.test(line)) continue;
    const cols = line.split(/\t|,/).map((s) => s.trim());
    if (cols.length < 5) continue;
    let dateStr, timeStr, o, h, l, c, v;
    if (hasTime) {
      [dateStr, timeStr, o, h, l, c] = cols;
      v = cols[6] || cols[5] || 0;
    } else {
      [dateStr, o, h, l, c] = cols;
      v = cols[5] || 0;
      timeStr = null;
    }
    rows.push({
      o: +o, h: +h, l: +l, c: +c, v: +v || 0,
      day: String(dateStr).replace(/\./g, '-'),
      t: timeStr || undefined,
    });
  }
  return rows;
}

function snapshot(candles, label) {
  const closes = candles.map((c) => c.c);
  return {
    label,
    n: candles.length,
    lastClose: closes[closes.length - 1],
    sma20: indicators.sma(closes, 20),
    sma50: indicators.sma(closes, 50),
    ema12: indicators.ema(closes, 12),
    ema26: indicators.ema(closes, 26),
    rsi14: indicators.rsi(closes, 14),
    momentum10: indicators.momentum(closes, 10),
    roc12: indicators.roc(closes, 12),
    atr14: indicators.atr(candles, 14),
    macd: indicators.macd(closes),
    bollinger: indicators.bollinger(closes),
    stochastic: indicators.stochastic(candles),
    adx: indicators.adx(candles),
    sr: indicators.supportResistance(candles),
    breakout: indicators.detectBreakout(candles),
    maxDd: indicators.maxDrawdown(closes),
    volPct: indicators.volatilityPct(candles),
  };
}

const datasets = [
  { path: 'data/XAUUSD/xauusd-1d.csv', label: 'XAUUSD-1D', hasTime: false },
  { path: 'data/XAUUSD/xauusd-4h.csv', label: 'XAUUSD-4H', hasTime: true },
  { path: 'data/BRENT/brent-1d.csv', label: 'BRENT-1D', hasTime: false },
  { path: 'data/BRENT/brent-4h.csv', label: 'BRENT-4H', hasTime: true },
];

const goldenDir = join(ROOT, 'tests/golden');
mkdirSync(goldenDir, { recursive: true });

const all = {};
for (const ds of datasets) {
  const text = readFileSync(join(ROOT, ds.path), 'utf8');
  const candles = parseMT5Csv(text, ds.hasTime);
  console.log(`${ds.label}: ${candles.length} bars`);
  all[ds.label] = snapshot(candles, ds.label);
  if (candles.length > 100) {
    all[ds.label + '_last100'] = snapshot(candles.slice(-100), ds.label + '_last100');
  }
}

const outPath = join(goldenDir, 'indicators_baseline_v11.6.0.json');
writeFileSync(outPath, JSON.stringify(all, null, 2));
console.log('Wrote', outPath);
console.log('XAUUSD-1D rsi14 =', all['XAUUSD-1D'].rsi14);
console.log('XAUUSD-1D sma20 =', all['XAUUSD-1D'].sma20);
