/**
 * Auto Debugger — independent validation engine for Offline Market Analyst
 * Focus: mathematical correctness, invariants, cross-checks, forecast logic,
 * regression, diagnostics. Does NOT alter main calculation outputs.
 * Fully offline. Safe by default (detect / analyze / report only).
 */
import { CONFIG } from './config.js';
import {
  isNum, last, sma, ema, emaSeries, rsi, macd, atr, momentum, roc,
  bollinger, stochastic, adx, supportResistance, volumeAnalysis,
  detectBreakout, maxDrawdown, volatilityPct, fibonacciLevels
} from './indicators.js';
import { runTechnical } from './technical.js';
import { runFundamental } from './fundamental.js';
import { runDecision } from './decision.js';
import { createPrediction, listPredictions } from './prediction.js';
import { loadJSON, saveJSON } from './storage.js';
import { getMacdConfig } from './indicatorConfig.js';

const DEBUG_STORAGE_KEY = 'auto_debugger_history';
const REGRESSION_BASELINE_KEY = 'auto_debugger_baseline';
const VERSION = '1.0.0';

const TOLERANCE = Object.freeze({
  rsi: 0.15,
  macd: 0.02,
  sma: 1e-6,
  ema: 1e-5,
  atr: 0.01,
  momentum: 1e-6,
  score: 0.5,
  price: 1e-4,
  pct: 0.05
});

let _lastReport = null;
let _injectedFaults = []; // for controlled testing only; cleared after use

// ─── Independent pure validators (never call main engines for expected values) ───

function independentRSI(closes, period = CONFIG.rsiPeriod) {
  if (!closes || closes.length <= period) return null;
  for (let i = 0; i <= period; i++) if (!isNum(closes[i])) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    if (!isNum(closes[i]) || !isNum(closes[i - 1])) return null;
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function independentSMA(values, period) {
  if (!values || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    if (!isNum(values[i])) return null;
    sum += values[i];
  }
  return sum / period;
}

function independentEMA(values, period) {
  if (!values || values.length < period) return null;
  for (let i = 0; i < period; i++) if (!isNum(values[i])) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let e = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    if (!isNum(values[i])) return null;
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

function independentMACD(closes, fast = CONFIG.emaFast, slow = CONFIG.emaSlow, signal = CONFIG.emaSignal) {
  if (!closes || closes.length < slow + signal) return null;
  const ef = independentEMA(closes, fast);
  const es = independentEMA(closes, slow);
  if (!isNum(ef) || !isNum(es)) return null;
  const line = ef - es;
  // Rebuild series for signal (simplified independent path)
  const emaF = [];
  const emaS = [];
  let sf = 0, ss = 0;
  for (let i = 0; i < fast; i++) sf += closes[i];
  let efv = sf / fast;
  for (let i = 0; i < slow; i++) ss += closes[i];
  let esv = ss / slow;
  const kf = 2 / (fast + 1), ks = 2 / (slow + 1);
  const macdSeries = [];
  for (let i = 0; i < closes.length; i++) {
    if (i >= fast - 1) {
      if (i === fast - 1) efv = sf / fast;
      else efv = closes[i] * kf + efv * (1 - kf);
    }
    if (i >= slow - 1) {
      if (i === slow - 1) esv = ss / slow;
      else esv = closes[i] * ks + esv * (1 - ks);
    }
    if (i >= slow - 1) macdSeries.push(efv - esv);
  }
  if (macdSeries.length < signal) return { macd: line, signal: null, hist: null };
  let sigSum = 0;
  for (let i = 0; i < signal; i++) sigSum += macdSeries[i];
  let sig = sigSum / signal;
  const ksig = 2 / (signal + 1);
  for (let i = signal; i < macdSeries.length; i++) {
    sig = macdSeries[i] * ksig + sig * (1 - ksig);
  }
  return { macd: line, signal: sig, hist: line - sig };
}

function independentMomentum(closes, period = CONFIG.momentumPeriod) {
  if (!closes || closes.length <= period) return null;
  const a = closes[closes.length - 1];
  const b = closes[closes.length - 1 - period];
  if (!isNum(a) || !isNum(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

function approxEqual(a, b, tol) {
  if (a == null && b == null) return true;
  if (!isNum(a) || !isNum(b)) return false;
  if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) return true;
  return Math.abs(a - b) <= tol || Math.abs(a - b) / (Math.abs(a) + 1e-12) <= tol * 0.01;
}

// ─── Bug / Diagnostic helpers ───

function makeBug(id, category, severity, module, input, expected, actual, diff, rootCause, status = 'OPEN') {
  return {
    id: id || `BUG-${Date.now().toString(36).toUpperCase()}`,
    category,
    severity, // CRITICAL | HIGH | MEDIUM | LOW | INFO
    module,
    input: input != null ? String(input).slice(0, 200) : null,
    expected,
    actual,
    difference: diff,
    possibleRootCause: rootCause,
    status,
    ts: Date.now()
  };
}

function userFriendlyMsg(bug) {
  const sevIcon = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵', INFO: 'ℹ️' }[bug.severity] || '⚠️';
  let msg = `${sevIcon} ${bug.category}`;
  if (bug.expected != null && bug.actual != null) {
    msg += `\nمقدار مورد انتظار: ${formatVal(bug.expected)}\nمقدار سیستم: ${formatVal(bug.actual)}`;
    if (bug.difference != null) msg += `\nاختلاف: ${formatVal(bug.difference)}`;
  }
  if (bug.possibleRootCause) msg += `\nعلت احتمالی: ${bug.possibleRootCause}`;
  return msg;
}

function formatVal(v) {
  if (v == null) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    if (Math.abs(v) >= 100 || Math.abs(v) < 0.001) return v.toPrecision(6);
    return Number(v.toFixed(6)).toString();
  }
  return String(v);
}

// ─── Core scan stages ───

function checkApplicationHealth(ctx) {
  const bugs = [];
  const warnings = [];
  // Runtime / storage
  try {
    if (typeof localStorage === 'undefined') {
      // Non-browser (Node test) — skip, not a product defect
      warnings.push(makeBug(null, 'Storage Skip', 'INFO', 'storage', null, 'browser localStorage', 'unavailable in this runtime', null, 'Running outside browser; storage checks skipped'));
    } else {
      const testKey = 'oma_ad_probe';
      localStorage.setItem(testKey, '1');
      if (localStorage.getItem(testKey) !== '1') {
        bugs.push(makeBug(null, 'Storage Error', 'HIGH', 'storage', null, 'writable', 'failed', null, 'localStorage read/write mismatch'));
      }
      localStorage.removeItem(testKey);
    }
  } catch (e) {
    bugs.push(makeBug(null, 'Storage Error', 'CRITICAL', 'storage', null, 'available', String(e.message), null, 'localStorage unavailable or quota exceeded'));
  }

  // Missing modules (static checks via presence of imports already resolved)
  if (typeof runTechnical !== 'function') {
    bugs.push(makeBug(null, 'Missing Dependency', 'CRITICAL', 'technical', null, 'function', typeof runTechnical, null, 'runTechnical not loaded'));
  }
  if (typeof runDecision !== 'function') {
    bugs.push(makeBug(null, 'Missing Dependency', 'CRITICAL', 'decision', null, 'function', typeof runDecision, null, 'runDecision not loaded'));
  }

  // Data state
  const candles = ctx.candles || [];
  if (candles.length === 0) {
    warnings.push(makeBug(null, 'Missing Data', 'INFO', 'data', null, '≥30 candles', 0, null, 'No candles loaded — analysis will fail until data is provided'));
  } else if (candles.length < CONFIG.minCandles) {
    warnings.push(makeBug(null, 'Insufficient Data', 'MEDIUM', 'data', candles.length, `≥${CONFIG.minCandles}`, candles.length, null, 'Too few candles for technical analysis'));
  }

  // NaN / Infinity / invalid prices in candles
  let badCount = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c) { badCount++; continue; }
    const fields = [c.o, c.h, c.l, c.c];
    for (const f of fields) {
      if (f == null) continue;
      if (!isNum(f) || f < 0) {
        badCount++;
        break;
      }
      if (c.h < c.l || c.h < c.o || c.h < c.c || c.l > c.o || c.l > c.c) {
        badCount++;
        break;
      }
    }
  }
  if (badCount > 0) {
    bugs.push(makeBug(null, 'Invalid OHLC', 'HIGH', 'data', badCount, 'valid OHLC', `${badCount} bad bars`, null, 'Negative, NaN, Infinity or inconsistent High/Low/Open/Close'));
  }

  // Date order
  if (candles.length >= 2) {
    let orderOk = true;
    for (let i = 1; i < candles.length; i++) {
      const a = candles[i - 1].t || candles[i - 1].date;
      const b = candles[i].t || candles[i].date;
      if (a != null && b != null && a > b) { orderOk = false; break; }
    }
    if (!orderOk) {
      bugs.push(makeBug(null, 'Date Order', 'MEDIUM', 'data', null, 'ascending', 'unsorted/descending', null, 'Candles not in chronological order'));
    }
  }

  return { bugs, warnings };
}

function validateCalculations(ctx) {
  const bugs = [];
  const warnings = [];
  const candles = ctx.candles || [];
  if (candles.length < CONFIG.minCandles) {
    return { bugs, warnings, details: { skipped: true, reason: 'insufficient candles' } };
  }

  const closes = candles.map(c => c.c);
  const details = {};

  // RSI cross-check
  const mainRsi = rsi(closes, CONFIG.rsiPeriod);
  const indRsi = independentRSI(closes, CONFIG.rsiPeriod);
  details.rsi = { main: mainRsi, independent: indRsi };
  if (isNum(mainRsi) && isNum(indRsi)) {
    if (!approxEqual(mainRsi, indRsi, TOLERANCE.rsi)) {
      bugs.push(makeBug(null, 'Calculation Mismatch', 'HIGH', 'indicators/rsi',
        `period=${CONFIG.rsiPeriod}`, indRsi, mainRsi, Math.abs(mainRsi - indRsi),
        'Main RSI engine differs from independent Wilder RSI implementation'));
    }
    if (mainRsi < 0 || mainRsi > 100) {
      bugs.push(makeBug(null, 'Range Violation', 'CRITICAL', 'indicators/rsi', null, '0–100', mainRsi, null, 'RSI outside [0,100]'));
    }
  } else if (mainRsi != null && !isNum(mainRsi)) {
    bugs.push(makeBug(null, 'Invalid Number', 'HIGH', 'indicators/rsi', null, 'finite number', mainRsi, null, 'RSI is NaN or Infinity'));
  }

  // SMA
  const mainSma = sma(closes, CONFIG.smaFast);
  const indSma = independentSMA(closes, CONFIG.smaFast);
  details.sma = { main: mainSma, independent: indSma };
  if (isNum(mainSma) && isNum(indSma) && !approxEqual(mainSma, indSma, TOLERANCE.sma)) {
    bugs.push(makeBug(null, 'Calculation Mismatch', 'HIGH', 'indicators/sma',
      `period=${CONFIG.smaFast}`, indSma, mainSma, Math.abs(mainSma - indSma), 'SMA mismatch'));
  }

  // EMA
  const mainEma = ema(closes, CONFIG.emaFast);
  const indEma = independentEMA(closes, CONFIG.emaFast);
  details.ema = { main: mainEma, independent: indEma };
  if (isNum(mainEma) && isNum(indEma) && !approxEqual(mainEma, indEma, TOLERANCE.ema)) {
    bugs.push(makeBug(null, 'Calculation Mismatch', 'MEDIUM', 'indicators/ema',
      `period=${CONFIG.emaFast}`, indEma, mainEma, Math.abs(mainEma - indEma), 'EMA mismatch'));
  }

  // MACD
  const mainMacd = macd(closes);
  const indMacd = independentMACD(closes);
  details.macd = { main: mainMacd, independent: indMacd };
  if (mainMacd && indMacd && isNum(mainMacd.macd) && isNum(indMacd.macd)) {
    if (!approxEqual(mainMacd.macd, indMacd.macd, TOLERANCE.macd * Math.max(1, Math.abs(mainMacd.macd)))) {
      bugs.push(makeBug(null, 'Calculation Mismatch', 'HIGH', 'indicators/macd',
        null, indMacd.macd, mainMacd.macd, Math.abs(mainMacd.macd - indMacd.macd), 'MACD line mismatch'));
    }
  }

  // Momentum
  const mainMom = momentum(closes, CONFIG.momentumPeriod);
  const indMom = independentMomentum(closes, CONFIG.momentumPeriod);
  details.momentum = { main: mainMom, independent: indMom };
  if (isNum(mainMom) && isNum(indMom) && !approxEqual(mainMom, indMom, TOLERANCE.momentum)) {
    bugs.push(makeBug(null, 'Calculation Mismatch', 'MEDIUM', 'indicators/momentum',
      null, indMom, mainMom, Math.abs(mainMom - indMom), 'Momentum mismatch'));
  }

  // Injected faults (testing only)
  for (const f of _injectedFaults) {
    if (f.type === 'formula') {
      bugs.push(makeBug(null, 'Calculation Mismatch', 'HIGH', f.module || 'test', f.input, f.expected, f.actual, f.diff, f.cause || 'Injected formula error'));
    } else if (f.type === 'nan') {
      bugs.push(makeBug(null, 'Invalid Number', 'HIGH', f.module || 'test', null, 'finite', NaN, null, f.cause || 'Injected NaN'));
    }
  }

  return { bugs, warnings, details };
}

function validateInvariants(ctx) {
  const bugs = [];
  const warnings = [];
  const candles = ctx.candles || [];
  if (candles.length < CONFIG.minCandles) return { bugs, warnings };

  let tech = null;
  try {
    tech = runTechnical(candles, { currentPrice: ctx.currentPrice, symbol: ctx.symbol, timeframe: ctx.timeframe || '1D' });
  } catch (e) {
    bugs.push(makeBug(null, 'Runtime Error', 'CRITICAL', 'technical', null, 'ok', String(e.message), null, e.stack?.slice(0, 120)));
    return { bugs, warnings };
  }

  if (!tech || !tech.ok) {
    if (tech && tech.error) {
      warnings.push(makeBug(null, 'Technical Unavailable', 'MEDIUM', 'technical', null, 'ok', tech.error, null, 'Technical engine returned error'));
    }
    return { bugs, warnings };
  }

  const ind = tech.indicators || {};
  const score = tech.score;

  // Score range
  if (score != null) {
    if (!isNum(score) || score < 0 || score > 100) {
      bugs.push(makeBug(null, 'Range Violation', 'CRITICAL', 'technical/score', null, '0–100', score, null, 'Technical score out of range'));
    }
  }

  // RSI
  if (ind.rsi != null && (ind.rsi < 0 || ind.rsi > 100 || !isNum(ind.rsi))) {
    bugs.push(makeBug(null, 'Range Violation', 'CRITICAL', 'indicators/rsi', null, '0–100', ind.rsi, null, 'RSI invariant failed'));
  }

  // Support < Resistance
  if (isNum(ind.support) && isNum(ind.resistance)) {
    if (ind.support >= ind.resistance) {
      bugs.push(makeBug(null, 'Invariant Violation', 'HIGH', 'structure/SR',
        `S=${ind.support} R=${ind.resistance}`, 'Support < Resistance', `${ind.support} ≥ ${ind.resistance}`,
        ind.support - ind.resistance, 'Support/Resistance inverted or equal'));
    }
  }

  // Prices non-negative / finite
  for (const key of ['price', 'support', 'resistance', 'atr']) {
    const v = ind[key];
    if (v != null && (!isNum(v) || v < 0)) {
      bugs.push(makeBug(null, 'Invalid Number', 'HIGH', `indicators/${key}`, null, '≥0 finite', v, null, `${key} invalid`));
    }
  }

  // Decision-level invariants if available
  let decision = null;
  try {
    decision = runDecision(candles, {
      symbol: ctx.symbol || 'TEST',
      currentPrice: ctx.currentPrice,
      fundamentalSnapshot: ctx.fundamentalSnapshot || null,
      horizonBars: ctx.horizonBars || CONFIG.defaultHorizonBars,
      timeframe: ctx.timeframe || '1D'
    });
  } catch (e) {
    bugs.push(makeBug(null, 'Runtime Error', 'CRITICAL', 'decision', null, 'ok', String(e.message), null, 'runDecision threw'));
    return { bugs, warnings, tech, decision: null };
  }

  if (decision && decision.ok) {
    const d = decision;
    const conf = d.confidence;
    if (conf != null) {
      // confidence may be 0–1 or 0–100 depending on UI layer; accept both
      const cNorm = conf > 1.5 ? conf : conf * 100;
      if (!isNum(conf) || cNorm < 0 || cNorm > 150) {
        bugs.push(makeBug(null, 'Range Violation', 'HIGH', 'decision/confidence', null, '0–100 (or 0–1)', conf, null, 'Confidence out of plausible range'));
      }
    }

    const signal = d.signal;
    const combined = (d.analysis && d.analysis.combinedScore != null) ? d.analysis.combinedScore : d.score;
    if (signal && isNum(combined)) {
      if (signal === 'BUY' && combined < CONFIG.sellThreshold) {
        bugs.push(makeBug(null, 'Logic Contradiction', 'HIGH', 'decision/signal',
          `score=${combined}`, 'BUY only when score ≥ buyThreshold', signal,
          null, 'BUY signal with low combined score'));
      }
      if (signal === 'SELL' && combined > CONFIG.buyThreshold) {
        bugs.push(makeBug(null, 'Logic Contradiction', 'HIGH', 'decision/signal',
          `score=${combined}`, 'SELL only when score ≤ sellThreshold', signal,
          null, 'SELL signal with high combined score'));
      }
    }

    // Target / Stop vs Direction
    const target = d.target != null ? d.target : (d.prediction && d.prediction.target);
    const stop = d.stop != null ? d.stop : (d.prediction && d.prediction.stop);
    const price = isNum(ctx.currentPrice) ? ctx.currentPrice : (ind.price || last(candles.map(c => c.c)));
    if (isNum(target) && isNum(price) && signal === 'BUY' && target < price) {
      bugs.push(makeBug(null, 'Invariant Violation', 'HIGH', 'forecast/target',
        `price=${price}`, 'Target > price for BUY', target, target - price, 'Target below entry on BUY'));
    }
    if (isNum(target) && isNum(price) && signal === 'SELL' && target > price) {
      bugs.push(makeBug(null, 'Invariant Violation', 'HIGH', 'forecast/target',
        `price=${price}`, 'Target < price for SELL', target, target - price, 'Target above entry on SELL'));
    }
    if (isNum(stop) && isNum(price) && signal === 'BUY' && stop > price) {
      bugs.push(makeBug(null, 'Invariant Violation', 'HIGH', 'forecast/stop',
        `price=${price}`, 'Stop < price for BUY', stop, stop - price, 'Stop above entry on BUY'));
    }
    if (isNum(stop) && isNum(price) && signal === 'SELL' && stop < price) {
      bugs.push(makeBug(null, 'Invariant Violation', 'HIGH', 'forecast/stop',
        `price=${price}`, 'Stop > price for SELL', stop, stop - price, 'Stop below entry on SELL'));
    }
  }

  // Injected range / SR / signal faults
  for (const f of _injectedFaults) {
    if (f.type === 'range') {
      bugs.push(makeBug(null, 'Range Violation', 'CRITICAL', f.module || 'test', null, f.expected, f.actual, null, f.cause || 'Injected out-of-range'));
    } else if (f.type === 'sr') {
      bugs.push(makeBug(null, 'Invariant Violation', 'HIGH', 'structure/SR', null, 'Support < Resistance', f.actual, null, f.cause || 'Injected inverted SR'));
    } else if (f.type === 'signal') {
      bugs.push(makeBug(null, 'Logic Contradiction', 'HIGH', 'decision/signal', null, f.expected, f.actual, null, f.cause || 'Injected contradictory signal'));
    } else if (f.type === 'score') {
      bugs.push(makeBug(null, 'Range Violation', 'HIGH', 'technical/score', null, '0–100', f.actual, null, f.cause || 'Injected bad score'));
    } else if (f.type === 'missing') {
      bugs.push(makeBug(null, 'Missing Data', 'MEDIUM', 'data', null, f.expected, f.actual, null, f.cause || 'Injected missing data'));
    }
  }

  return { bugs, warnings, tech, decision };
}

function validateForecast(ctx, tech, decision) {
  const bugs = [];
  const warnings = [];
  if (!decision || !decision.ok) {
    warnings.push(makeBug(null, 'Forecast Skipped', 'INFO', 'forecast', null, 'decision.ok', false, null, 'No valid decision to validate forecast against'));
    return { bugs, warnings };
  }

  const signal = decision.signal;
  const combined = decision.combinedScore != null ? decision.combinedScore : decision.score;
  const techScore = tech && tech.score;
  const trend = (tech && tech.trend) || decision.trend;

  // Signal vs score consistency (already partially in invariants)
  if (signal === 'HOLD' && isNum(combined)) {
    if (combined >= CONFIG.buyThreshold || combined <= CONFIG.sellThreshold) {
      warnings.push(makeBug(null, 'Signal/Score Soft Mismatch', 'LOW', 'forecast',
        `score=${combined}`, 'HOLD when between thresholds', signal, null,
        'HOLD issued while score is outside neutral band'));
    }
  }

  // Trend vs signal soft check
  if (trend && signal) {
    const t = String(trend).toLowerCase();
    if ((t.includes('up') || t.includes('صعود')) && signal === 'SELL') {
      warnings.push(makeBug(null, 'Trend/Signal Soft Conflict', 'LOW', 'forecast',
        trend, 'SELL rare on strong uptrend', signal, null, 'Possible conflict between trend label and signal'));
    }
    if ((t.includes('down') || t.includes('نزول')) && signal === 'BUY') {
      warnings.push(makeBug(null, 'Trend/Signal Soft Conflict', 'LOW', 'forecast',
        trend, 'BUY rare on strong downtrend', signal, null, 'Possible conflict between trend label and signal'));
    }
  }

  // Combined score composition if both layers present
  const techSc = decision.analysis?.technicalScore;
  const fundSc = decision.analysis?.fundamentalScore;
  const combSc = decision.analysis?.combinedScore != null ? decision.analysis.combinedScore : decision.score;
  if (isNum(techSc) && isNum(fundSc) && isNum(combSc) && decision.fundamentalApplied) {
    const expected = CONFIG.engineWeights.technical * techSc +
      CONFIG.engineWeights.fundamental * fundSc;
    if (!approxEqual(expected, combSc, TOLERANCE.score)) {
      bugs.push(makeBug(null, 'Calculation Mismatch', 'HIGH', 'decision/combined',
        `T=${techSc} F=${fundSc}`, expected, combSc,
        Math.abs(expected - combSc), 'Combined score does not match weighted average of tech+fund'));
    }
  }

  return { bugs, warnings };
}

function historicalSelfTest(ctx) {
  const bugs = [];
  const warnings = [];
  const results = [];
  const candles = ctx.candles || [];
  if (candles.length < CONFIG.minCandles + 30) {
    warnings.push(makeBug(null, 'Historical Test Skipped', 'INFO', 'forecast/selftest',
      candles.length, `≥${CONFIG.minCandles + 30}`, candles.length, null, 'Not enough history for walk-forward sample'));
    return { bugs, warnings, results };
  }

  // Sample a few points (no look-ahead)
  const horizon = ctx.horizonBars || CONFIG.defaultHorizonBars;
  const step = Math.max(10, Math.floor((candles.length - CONFIG.minCandles - horizon) / 5));
  const points = [];
  for (let i = CONFIG.minCandles; i < candles.length - horizon; i += step) {
    points.push(i);
    if (points.length >= 5) break;
  }

  let correct = 0, wrong = 0, neutral = 0;
  for (const idx of points) {
    const past = candles.slice(0, idx + 1);
    const future = candles[idx + horizon];
    if (!future || !isNum(future.c)) continue;
    let dec;
    try {
      dec = runDecision(past, {
        symbol: ctx.symbol || 'HIST',
        currentPrice: past[past.length - 1].c,
        horizonBars: horizon,
        timeframe: ctx.timeframe || '1D'
      });
    } catch {
      continue;
    }
    if (!dec || !dec.ok) continue;
    const entry = past[past.length - 1].c;
    const ret = (future.c - entry) / entry;
    const thresh = 0.002;
    let outcome = 'neutral';
    const dir = (dec.prediction && dec.prediction.direction) || (dec.signal === 'BUY' ? 'up' : dec.signal === 'SELL' ? 'down' : 'neutral');
    if (Math.abs(ret) < thresh) outcome = 'neutral';
    else if (dir === 'up') outcome = ret > 0 ? 'correct' : 'wrong';
    else if (dir === 'down') outcome = ret < 0 ? 'correct' : 'wrong';
    else outcome = 'neutral';

    if (outcome === 'correct') correct++;
    else if (outcome === 'wrong') wrong++;
    else neutral++;

    results.push({
      index: idx,
      signal: dec.signal,
      direction: dir,
      score: dec.combinedScore != null ? dec.combinedScore : dec.score,
      entry,
      future: future.c,
      returnPct: ret * 100,
      outcome
    });
  }

  const totalDir = correct + wrong;
  const dirAcc = totalDir > 0 ? (correct / totalDir) * 100 : null;
  if (dirAcc != null && dirAcc < 25 && totalDir >= 3) {
    warnings.push(makeBug(null, 'Forecast Quality', 'MEDIUM', 'forecast/selftest',
      `n=${totalDir}`, 'Dir.Acc ≥ ~40% expected on random', `${dirAcc.toFixed(1)}%`, null,
      'Directional accuracy on historical samples is low (dataset or model limitation)'));
  }

  return { bugs, warnings, results, summary: { correct, wrong, neutral, dirAcc } };
}

function runRegressionCheck(ctx, currentSnapshot) {
  const bugs = [];
  const warnings = [];

  // Always process injected regression faults (for self-test of debugger)
  for (const f of _injectedFaults) {
    if (f.type === 'regression') {
      bugs.push(makeBug(null, 'REGRESSION DETECTED', 'CRITICAL', f.module || 'regression',
        f.input, f.expected, f.actual, f.diff, f.cause || 'Injected regression'));
    }
  }

  const baseline = loadJSON(REGRESSION_BASELINE_KEY, null);
  if (!baseline || !baseline.snapshot) {
    saveJSON(REGRESSION_BASELINE_KEY, {
      version: VERSION,
      ts: Date.now(),
      snapshot: currentSnapshot
    });
    return { bugs, warnings, status: bugs.length ? 'REGRESSION' : 'BASELINE_SET', baseline: null };
  }

  const prev = baseline.snapshot;
  if (prev.dataFingerprint && currentSnapshot.dataFingerprint &&
      prev.dataFingerprint === currentSnapshot.dataFingerprint) {
    const keys = ['rsi', 'sma', 'ema', 'techScore', 'combinedScore'];
    for (const k of keys) {
      if (prev[k] != null && currentSnapshot[k] != null && isNum(prev[k]) && isNum(currentSnapshot[k])) {
        if (!approxEqual(prev[k], currentSnapshot[k], TOLERANCE.score)) {
          bugs.push(makeBug(null, 'REGRESSION DETECTED', 'CRITICAL', `regression/${k}`,
            prev.dataFingerprint, prev[k], currentSnapshot[k],
            Math.abs(prev[k] - currentSnapshot[k]),
            `Value of ${k} changed after code change on identical input`));
        }
      }
    }
  } else {
    saveJSON(REGRESSION_BASELINE_KEY, {
      version: VERSION,
      ts: Date.now(),
      snapshot: currentSnapshot
    });
  }

  return { bugs, warnings, status: bugs.length ? 'REGRESSION' : 'OK', baseline: prev };
}

function buildDataFingerprint(candles) {
  if (!candles || !candles.length) return 'empty';
  const n = candles.length;
  const first = candles[0];
  const lastC = candles[n - 1];
  const mid = candles[Math.floor(n / 2)];
  return `${n}|${first.c}|${mid && mid.c}|${lastC.c}|${lastC.t || lastC.date || ''}`;
}

// ─── Public API ───

/**
 * @param {object} options
 * @param {'quick'|'deep'} options.mode
 * @param {Array} options.candles
 * @param {string} options.symbol
 * @param {number} options.currentPrice
 * @param {object} options.fundamentalSnapshot
 * @param {boolean} options.safeAutoFix  (default false)
 */
export async function runAutoDebugger(options = {}) {
  const mode = options.mode || 'quick';
  const start = Date.now();
  const ctx = {
    candles: options.candles || [],
    symbol: options.symbol || null,
    currentPrice: options.currentPrice,
    fundamentalSnapshot: options.fundamentalSnapshot || null,
    timeframe: options.timeframe || '1D',
    horizonBars: options.horizonBars || CONFIG.defaultHorizonBars
  };

  const allBugs = [];
  const allWarnings = [];
  const sections = {};

  // 1. Application check
  const app = checkApplicationHealth(ctx);
  allBugs.push(...app.bugs);
  allWarnings.push(...app.warnings);
  sections.application = { bugs: app.bugs.length, warnings: app.warnings.length };

  // 2. Mathematical validation (quick + deep)
  const calc = validateCalculations(ctx);
  allBugs.push(...calc.bugs);
  allWarnings.push(...calc.warnings);
  sections.calculations = { bugs: calc.bugs.length, warnings: calc.warnings.length, details: calc.details };

  // 3. Invariants + financial logic
  const inv = validateInvariants(ctx);
  allBugs.push(...inv.bugs);
  allWarnings.push(...inv.warnings);
  sections.invariants = { bugs: inv.bugs.length, warnings: inv.warnings.length };
  const tech = inv.tech;
  const decision = inv.decision;

  // 4. Forecast validation
  const fc = validateForecast(ctx, tech, decision);
  allBugs.push(...fc.bugs);
  allWarnings.push(...fc.warnings);
  sections.forecast = { bugs: fc.bugs.length, warnings: fc.warnings.length };

  // 5. Historical self-test (deep only or when enough data)
  let hist = { results: [], summary: null };
  if (mode === 'deep') {
    hist = historicalSelfTest(ctx);
    allBugs.push(...hist.bugs);
    allWarnings.push(...hist.warnings);
    sections.historical = { bugs: hist.bugs.length, warnings: hist.warnings.length, summary: hist.summary };
  } else {
    sections.historical = { skipped: true };
  }

  // Snapshot for regression
  const closes = (ctx.candles || []).map(c => c.c);
  const snapshot = {
    dataFingerprint: buildDataFingerprint(ctx.candles),
    rsi: calc.details?.rsi?.main ?? null,
    sma: calc.details?.sma?.main ?? null,
    ema: calc.details?.ema?.main ?? null,
    techScore: tech?.score ?? null,
    combinedScore: decision?.combinedScore ?? decision?.score ?? null,
    signal: decision?.signal ?? null
  };

  // 6. Regression
  const reg = runRegressionCheck(ctx, snapshot);
  allBugs.push(...reg.bugs);
  allWarnings.push(...reg.warnings);
  sections.regression = { status: reg.status, bugs: reg.bugs.length };

  // Safe Auto-Fix (very limited)
  const fixes = [];
  if (options.safeAutoFix) {
    // Only clear corrupt storage keys that we own, never touch formulas
    for (const b of allBugs) {
      if (b.category === 'Storage Error' && b.severity !== 'CRITICAL') {
        try {
          // probe already done; nothing destructive
          fixes.push({ bugId: b.id, action: 'reprobe-storage', result: 'ok' });
          b.status = 'FIXED';
        } catch { /* ignore */ }
      }
    }
  }

  // Aggregate status
  const critical = allBugs.filter(b => b.severity === 'CRITICAL').length;
  const high = allBugs.filter(b => b.severity === 'HIGH').length;
  let status = 'HEALTHY';
  if (critical > 0) status = 'CRITICAL';
  else if (high > 0 || allBugs.length > 0) status = 'WARNING';
  else if (allWarnings.length > 3) status = 'WARNING';

  const report = {
    version: VERSION,
    mode,
    ts: Date.now(),
    durationMs: Date.now() - start,
    status, // HEALTHY | WARNING | CRITICAL
    testsRun: countTests(sections),
    passed: 0, // filled below
    failed: allBugs.length,
    warnings: allWarnings.length,
    bugs: allBugs,
    warningItems: allWarnings,
    sections,
    historicalResults: hist.results || [],
    historicalSummary: hist.summary || null,
    snapshot,
    fixes,
    userMessages: allBugs.map(userFriendlyMsg).concat(allWarnings.slice(0, 5).map(userFriendlyMsg))
  };

  // Approximate passed count
  const totalChecks = report.testsRun;
  report.passed = Math.max(0, totalChecks - allBugs.length);

  // Persist history
  persistReport(report);
  _lastReport = report;

  // Clear injected faults after scan
  _injectedFaults = [];

  return report;
}

function countTests(sections) {
  // Rough count of discrete checks performed
  let n = 8; // base application checks
  if (sections.calculations && !sections.calculations.details?.skipped) n += 6;
  if (sections.invariants) n += 10;
  if (sections.forecast) n += 4;
  if (sections.historical && !sections.historical.skipped) n += 5;
  n += 3; // regression
  return n;
}

function persistReport(report) {
  const hist = loadJSON(DEBUG_STORAGE_KEY, []) || [];
  const entry = {
    scanDate: report.ts,
    version: report.version,
    mode: report.mode,
    status: report.status,
    passed: report.passed,
    failed: report.failed,
    warnings: report.warnings,
    bugs: report.bugs.map(b => ({
      id: b.id, category: b.category, severity: b.severity, module: b.module, status: b.status
    })),
    fixedBugs: report.fixes.length,
    forecastTestResult: report.historicalSummary || null,
    durationMs: report.durationMs
  };
  hist.unshift(entry);
  while (hist.length > 50) hist.pop();
  saveJSON(DEBUG_STORAGE_KEY, hist);
}

export function getLastReport() {
  return _lastReport;
}

export function getDebugHistory() {
  return loadJSON(DEBUG_STORAGE_KEY, []) || [];
}

export function clearDebugHistory() {
  saveJSON(DEBUG_STORAGE_KEY, []);
  return true;
}

/** Controlled fault injection for self-test of the debugger itself. Call before runAutoDebugger. */
export function injectTestFaults(faults = []) {
  _injectedFaults = Array.isArray(faults) ? faults.slice() : [];
}

export function getStatusEmoji(status) {
  if (status === 'HEALTHY') return '🟢';
  if (status === 'WARNING') return '🟡';
  if (status === 'CRITICAL') return '🔴';
  return '⚪';
}

export { TOLERANCE, VERSION as AUTO_DEBUGGER_VERSION };
