/**
 * High-priority parity checks for v12.0.1
 * - Decision combine + thresholds (vs CONFIG)
 * - Entry EV / gates
 * - Technical score runs on XAUUSD-1D (JS baseline)
 *
 * Run: node tests/regression/high_priority_v12.mjs
 */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const { CONFIG } = await import(pathToFileURL(join(ROOT, 'logic/config.js')).href);
const technical = await import(pathToFileURL(join(ROOT, 'logic/technical.js')).href);
const indicators = await import(pathToFileURL(join(ROOT, 'logic/indicators.js')).href);

function approx(a, b, tol = 1e-9) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tol || Math.abs(a - b) / (Math.abs(b) + 1e-15) <= 1e-9;
}

// --- Decision pure math (inline same as coreMath / rust decision) ---
function combineScores(technicalScore, fundamental) {
  const t = Math.max(0, Math.min(100, technicalScore));
  if (fundamental == null || !Number.isFinite(fundamental)) return t;
  const f = Math.max(0, Math.min(100, fundamental));
  return 0.7 * t + 0.3 * f;
}
function signalFromScore(combined) {
  if (combined >= CONFIG.buyThreshold) return 'BUY';
  if (combined <= CONFIG.sellThreshold) return 'SELL';
  return 'HOLD';
}

// --- Entry EV (parity with entry.js) ---
function computeEV({ winP, reward, risk, costFrac, price }) {
  if (!(risk > 0 && reward > 0 && price > 0)) return { evR: null, netRR: null };
  const costPrice = costFrac * price;
  const netReward = Math.max(0, reward - costPrice);
  const netRisk = risk + costPrice;
  const lossP = 1 - winP;
  const evPrice = winP * netReward - lossP * netRisk;
  const evR = netRisk > 0 ? Math.round((evPrice / netRisk) * 100) / 100 : null;
  const netRR = netRisk > 0 ? Math.round((netReward / netRisk) * 100) / 100 : null;
  return { evR, netRR, evPrice: Math.round(evPrice * 100) / 100 };
}

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
}

// 1) Thresholds match CONFIG
check('buyThreshold===57', CONFIG.buyThreshold === 57);
check('sellThreshold===43', CONFIG.sellThreshold === 43);
check('engineWeights 0.7/0.3', CONFIG.engineWeights.technical === 0.7 && CONFIG.engineWeights.fundamental === 0.3);

// 2) Decision combine
const c1 = combineScores(60, 40);
check('combine 60/40 → 54', approx(c1, 54));
check('signal 54 → HOLD', signalFromScore(c1) === 'HOLD');
check('signal 57 → BUY', signalFromScore(57) === 'BUY');
check('signal 43 → SELL', signalFromScore(43) === 'SELL');
check('signal tech-only 70 → BUY', signalFromScore(combineScores(70, null)) === 'BUY');

// 3) Entry EV
const ev = computeEV({ winP: 0.5, reward: 20, risk: 10, costFrac: 0, price: 100 });
check('EV 0.5/20/10 → evR≈0.5', approx(ev.evR, 0.5, 0.02));
check('netRR ≈ 2', approx(ev.netRR, 2, 0.02));
const evCost = computeEV({ winP: 0.5, reward: 20, risk: 10, costFrac: 0.01, price: 100 });
check('EV with cost reduces netRR', evCost.netRR != null && evCost.netRR < 2);

// 4) Technical on XAUUSD-1D
function parseCsv(text) {
  return text.trim().split(/\n/).filter(l => !l.startsWith('<') && !/date/i.test(l)).map(l => {
    const c = l.split(/\t/);
    return { o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +(c[5] || 0) };
  });
}
const candles = parseCsv(readFileSync(join(ROOT, 'data/XAUUSD/xauusd-1d.csv'), 'utf8'));
const tech = technical.runTechnical(candles, { symbol: 'XAUUSD', timeframe: '1D' });
check('technical.ok', tech.ok === true);
check('technical.score in 0..100', tech.score != null && tech.score >= 0 && tech.score <= 100, `score=${tech.score}`);
check('technical has factors', Array.isArray(tech.factors) && tech.factors.length > 0);
check('indicators.rsi finite', tech.indicators?.rsi != null && Number.isFinite(tech.indicators.rsi));

// 5) Indicator golden still holds
const golden = JSON.parse(readFileSync(join(ROOT, 'tests/golden/indicators_baseline_v11.6.0.json'), 'utf8'));
const closes = candles.map(c => c.c);
check('golden RSI match', approx(indicators.rsi(closes, 14), golden['XAUUSD-1D'].rsi14));
check('golden SMA20 match', approx(indicators.sma(closes, 20), golden['XAUUSD-1D'].sma20));

console.log(`\n[v12.0.1 high-priority] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
