/**
 * 7-day forecast regression — v12.1.0
 * Run: node tests/regression/forecast_7day.mjs
 */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { CONFIG } = await import(pathToFileURL(join(ROOT, 'logic/config.js')).href);
const {
  horizonDaysToBars,
  barsToApproxDays,
  buildForecastPath,
  attachForecastToResult,
} = await import(pathToFileURL(join(ROOT, 'logic/forecastPath.js')).href);
const { analyze } = await import(pathToFileURL(join(ROOT, 'logic/analysis.js')).href);

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
}

check('CONFIG.defaultHorizonBars === 7', CONFIG.defaultHorizonBars === 7);
check('CONFIG.forecastHorizonDays === 7', CONFIG.forecastHorizonDays === 7);
check('1D: 7 days → 7 bars', horizonDaysToBars('1D', 7) === 7);
check('4H: 7 days → 42 bars', horizonDaysToBars('4H', 7) === 42);
check('1H: 7 days → 168 bars', horizonDaysToBars('1H', 7) === 168);
check('barsToApproxDays 1D', barsToApproxDays('1D', 7) === 7);

function parseCsv(text) {
  return text
    .trim()
    .split(/\n/)
    .filter((l) => !l.startsWith('<') && !/date/i.test(l))
    .map((l) => {
      const c = l.split(/\t/);
      return { o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +(c[5] || 0), ts: Date.parse(String(c[0]).replace(/\./g, '-')) };
    });
}

const candles = parseCsv(readFileSync(join(ROOT, 'data/XAUUSD/xauusd-1d.csv'), 'utf8'));
check('candles loaded', candles.length > 50, `n=${candles.length}`);

const mockResult = {
  ok: true,
  signal: 'BUY',
  target: candles[candles.length - 1].c * 1.02,
  stop: candles[candles.length - 1].c * 0.98,
  confidence: 0.62,
  atr: 90,
};
const path = buildForecastPath(candles, mockResult, { days: 7, timeframe: '1D' });
check('path.horizonDays === 7', path.horizonDays === 7);
check('path.future length === 7', path.future.length === 7, `len=${path.future.length}`);
check('path.days length === 7', path.days.length === 7, `len=${path.days.length}`);
check('day1 has close', Number.isFinite(path.days[0]?.close));
check('day7 has close', Number.isFinite(path.days[6]?.close));
check('confidence decays', path.days[6].confidence <= path.days[0].confidence + 1e-9);

const attached = attachForecastToResult(
  { ok: true, signal: 'BUY', prediction: { direction: 'up', confidence: 0.6 }, data: { timeframe: '1D' } },
  candles,
  { timeframe: '1D', days: 7 }
);
check('forecast7d attached', !!attached.forecast7d);
check('prediction.horizonDays', attached.prediction?.horizonDays === 7);
check('prediction.dailyPath length', attached.prediction?.dailyPath?.length === 7);

// Full analyze pipeline (may need min candles)
const result = analyze(candles.slice(-80), {
  symbol: 'XAUUSD',
  timeframe: '1D',
  recordPrediction: false,
  horizonDays: 7,
});
check('analyze.ok', result.ok === true, result.error || '');
if (result.ok) {
  check('analyze.forecast7d', !!result.forecast7d, result.forecast7d ? `days=${result.forecast7d.horizonDays}` : 'missing');
  check(
    'analyze prediction horizon',
    result.prediction?.horizonBars === 7 || result.prediction?.horizonDays === 7,
    `bars=${result.prediction?.horizonBars} days=${result.prediction?.horizonDays}`
  );
}

console.log(`\n[v12.1.0 7-day forecast] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
