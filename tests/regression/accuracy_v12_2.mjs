/**
 * Accuracy enhancements regression v12.2.0
 * Run: node tests/regression/accuracy_v12_2.mjs
 */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { CONFIG } = await import(pathToFileURL(join(ROOT, 'logic/config.js')).href);
const {
  scoreToProbability,
  calibratedSignal,
  applyQualityGates,
  enhanceEnsembleDecision,
  evaluateForecastMetrics,
  aggregateAccuracyReport,
} = await import(pathToFileURL(join(ROOT, 'logic/accuracyEnhancements.js')).href);
const { buildForecastPath } = await import(pathToFileURL(join(ROOT, 'logic/forecastPath.js')).href);
const { analyze } = await import(pathToFileURL(join(ROOT, 'logic/analysis.js')).href);

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
}

check('CONFIG.accuracyEnhancements present', !!CONFIG.accuracyEnhancements);
check('gates enabled', CONFIG.accuracyEnhancements.enableQualityGates === true);

const p50 = scoreToProbability(50);
check('P(50)≈0.5', Math.abs(p50 - 0.5) < 0.05, `p=${p50}`);
const p70 = scoreToProbability(70);
check('P(70)>P(50)', p70 > p50);

const calHold = calibratedSignal(50);
check('cal 50 → HOLD', calHold.signal === 'HOLD');
const calBuy = calibratedSignal(75);
check('cal 75 → BUY or HOLD', calBuy.signal === 'BUY' || calBuy.signal === 'HOLD');

const gateFail = applyQualityGates({
  signal: 'BUY',
  adx: 10,
  confidence: 0.2,
  mtfOk: true,
  mtfAgreement: 0.2,
  agreement: 0.2,
  regime: 'Unclear',
  regimeConfidence: 0.2,
});
check('weak stack forces hold', gateFail.forcedHold === true, gateFail.reasons?.join(';'));

const gateOk = applyQualityGates({
  signal: 'BUY',
  adx: 28,
  confidence: 0.6,
  mtfOk: true,
  mtfAgreement: 0.7,
  agreement: 0.7,
  regime: 'Trending Bullish',
  regimeConfidence: 0.7,
  eventRisk: 0.2,
});
check('strong stack passes', gateOk.pass === true);

const ens = enhanceEnsembleDecision(
  { signal: 'BUY', score: 72, confidence: 0.55, agreement: 0.6 },
  { adx: 10, regime: 'Unclear', regimeConfidence: 0.3, mtfOk: true, mtfAgreement: 0.3, mtfConflict: false, eventRisk: 0.2 }
);
check('enhance can force HOLD', ens.signal === 'HOLD' || ens.qualityGate?.forcedHold);

function parseCsv(text) {
  return text.trim().split(/\n/).filter((l) => !l.startsWith('<') && !/date/i.test(l)).map((l) => {
    const c = l.split(/\t/);
    return { o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +(c[5] || 0), ts: Date.parse(String(c[0]).replace(/\./g, '-')) };
  });
}
const candles = parseCsv(readFileSync(join(ROOT, 'data/XAUUSD/xauusd-1d.csv'), 'utf8'));
const path = buildForecastPath(candles, { ok: true, signal: 'BUY', target: candles.at(-1).c * 1.02, confidence: 0.6, atr: 90 }, { days: 7, timeframe: '1D' });
check('7 days path', path.days.length === 7);
check('day1 layer tight', path.days[0].layer === 'tight');
check('day7 layer wide', path.days[6].layer === 'wide');
check('day has range high>low', path.days[6].high > path.days[6].low);

const metrics = evaluateForecastMetrics(
  { signal: 'BUY', priceAtPrediction: candles.at(-10).c, horizonBars: 5, dailyPath: path.days, highQuality: true },
  candles.slice(-9)
);
check('evaluateForecastMetrics ok', metrics.ok === true);

const report = aggregateAccuracyReport([
  { ok: true, predDir: 'up', actualDir: 'up', directionCorrect: true, highQuality: true, actualRetPct: 1 },
  { ok: true, predDir: 'up', actualDir: 'down', directionCorrect: false, highQuality: false, actualRetPct: -1 },
  { ok: true, predDir: 'up', actualDir: 'up', directionCorrect: true, highQuality: true, actualRetPct: 0.5 },
]);
check('split all n=3', report.all.n === 3);
check('split hq n=2', report.highQuality.n === 2);
check('hq accuracy 100', report.highQuality.directionalAccuracy === 100);

const result = analyze(candles.slice(-80), { symbol: 'XAUUSD', timeframe: '1D', recordPrediction: false });
check('analyze ok', result.ok === true, result.error || '');
if (result.ok) {
  check('has calibration or qualityGate', !!(result.analysis?.calibration || result.prediction?.calibration || result.analysis?.qualityGate));
  check('forecast7d still present', !!result.forecast7d);
  check('days have layer', result.forecast7d?.days?.[0]?.layer != null);
}

console.log(`\n[v12.2.0 accuracy] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
