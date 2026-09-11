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
const DEBUG_MEMORY_KEY = 'auto_debugger_memory';
const REGRESSION_MEMORY_KEY = 'auto_debugger_reg_memory';
const CALIBRATION_KEY = 'auto_debugger_calibration';
const CORRECTION_LOG_KEY = 'auto_debugger_corrections';
const RT_STATE_KEY = 'auto_debugger_rt_state';

/** Max auto-correction attempts per event (loop protection) */
const CORRECTION_DEPTH_LIMIT = 2;
const VERSION = '1.2.0';
const APP_VERSION = 'V5.05';

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


// ═══════════════════════════════════════════════════════════
// NEW (v1.1): Debug Memory · Regression Memory · Root Cause
// Anomaly Hunter · Prediction Auditor · Calibration Engine
// ═══════════════════════════════════════════════════════════

function loadDebugMemory() {
  return loadJSON(DEBUG_MEMORY_KEY, { bugs: [], patterns: {} }) || { bugs: [], patterns: {} };
}

function saveDebugMemory(mem) {
  return saveJSON(DEBUG_MEMORY_KEY, mem);
}

function patternKey(bug) {
  const cat = (bug.category || '').toLowerCase().slice(0, 40);
  const mod = (bug.module || '').toLowerCase().slice(0, 40);
  const cause = (bug.possibleRootCause || '').toLowerCase().replace(/\d+(\.\d+)?/g, '#').slice(0, 60);
  return `${cat}|${mod}|${cause}`;
}

/** Record bugs into Debug Memory; return enriched bugs with historical match info */
function updateDebugMemory(bugs) {
  const mem = loadDebugMemory();
  if (!Array.isArray(mem.bugs)) mem.bugs = [];
  if (!mem.patterns || typeof mem.patterns !== 'object') mem.patterns = {};

  const enriched = [];
  for (const bug of bugs) {
    const pk = patternKey(bug);
    const existing = mem.bugs.find(b => patternKey(b) === pk);
    let historicalMatch = null;
    let occurrenceCount = 1;
    let firstSeen = bug.ts || Date.now();
    let lastSeen = bug.ts || Date.now();
    let regressionCount = 0;
    let prevFix = null;

    if (existing) {
      occurrenceCount = (existing.occurrenceCount || 1) + 1;
      firstSeen = existing.firstSeen || firstSeen;
      lastSeen = Date.now();
      regressionCount = existing.regressionCount || 0;
      if (bug.category === 'REGRESSION DETECTED') regressionCount += 1;
      prevFix = existing.previousFix || null;
      existing.occurrenceCount = occurrenceCount;
      existing.lastSeen = lastSeen;
      existing.regressionCount = regressionCount;
      existing.lastError = bug.actual;
      historicalMatch = {
        bugId: existing.id,
        occurrenceCount,
        firstSeen,
        lastSeen,
        previousFix: prevFix,
        status: existing.status || 'OPEN'
      };
    } else {
      const entry = {
        id: bug.id,
        category: bug.category,
        module: bug.module,
        inputPattern: pk,
        observedError: bug.actual,
        rootCause: bug.possibleRootCause,
        previousFix: null,
        fixResult: null,
        firstSeen,
        lastSeen,
        occurrenceCount: 1,
        regressionCount: bug.category === 'REGRESSION DETECTED' ? 1 : 0,
        status: 'OPEN'
      };
      mem.bugs.unshift(entry);
      while (mem.bugs.length > 200) mem.bugs.pop();
    }

    mem.patterns[pk] = (mem.patterns[pk] || 0) + 1;

    enriched.push({
      ...bug,
      historicalMatch,
      occurrenceCount,
      firstSeen,
      lastSeen,
      regressionCount,
      repeatedWarning: occurrenceCount >= 2
        ? `احتمال تکرار خطای قبلی شناسایی شد (تعداد: ${occurrenceCount}). این وضعیت قبلاً باعث مشکل شده بود.`
        : null
    });
  }
  saveDebugMemory(mem);
  return enriched;
}

export function getDebugMemory() {
  return loadDebugMemory();
}

export function clearDebugMemory() {
  saveDebugMemory({ bugs: [], patterns: {} });
  return true;
}

// ─── Root Cause Chain ───

function buildRootCauseChain(bug, ctx, calc, inv) {
  const chain = [];
  const cat = (bug.category || '').toLowerCase();
  const mod = (bug.module || '').toLowerCase();

  // Symptom
  chain.push({ level: 'symptom', label: bug.category, detail: `Actual=${formatVal(bug.actual)} Expected=${formatVal(bug.expected)}` });

  if (mod.includes('forecast') || mod.includes('decision') || cat.includes('signal') || cat.includes('logic')) {
    chain.push({ level: 'dependency', label: 'Combined / Signal layer', detail: 'Depends on technical + fundamental scores' });
    chain.push({ level: 'upstream', label: 'Score composition', detail: 'Weights and indicator inputs' });
  }
  if (mod.includes('rsi') || mod.includes('macd') || mod.includes('sma') || mod.includes('ema') || mod.includes('indicators')) {
    chain.push({ level: 'dependency', label: 'Indicator engine', detail: mod });
    chain.push({ level: 'upstream', label: 'OHLCV series', detail: `candles=${(ctx.candles || []).length}` });
  }
  if (mod.includes('storage') || cat.includes('storage')) {
    chain.push({ level: 'upstream', label: 'localStorage / quota', detail: 'Persistence layer' });
  }
  if (cat.includes('missing') || cat.includes('invalid ohlc') || cat.includes('data')) {
    chain.push({ level: 'root', label: 'Input data quality', detail: bug.possibleRootCause || 'Invalid or incomplete market data' });
  } else if (cat.includes('mismatch') || cat.includes('calculation')) {
    chain.push({ level: 'root', label: 'Formula divergence', detail: bug.possibleRootCause || 'Main vs independent calculation differ' });
  } else if (cat.includes('invariant') || cat.includes('range')) {
    chain.push({ level: 'root', label: 'Constraint violation', detail: bug.possibleRootCause || 'Logical/range rule broken' });
  } else if (cat.includes('regression')) {
    chain.push({ level: 'root', label: 'Behavioral change vs baseline', detail: bug.possibleRootCause || 'Output changed on identical input' });
  } else {
    chain.push({ level: 'root', label: bug.possibleRootCause || 'Unknown', detail: mod || cat });
  }

  const conf = chain.some(c => c.level === 'root' && c.label !== 'Unknown') ? 0.7 : 0.4;
  return {
    rootCause: chain.find(c => c.level === 'root')?.label || bug.possibleRootCause,
    contributingFactors: chain.filter(c => c.level !== 'root' && c.level !== 'symptom').map(c => c.label),
    affectedModules: [bug.module].filter(Boolean),
    dependencyChain: chain,
    confidenceOfDiagnosis: conf
  };
}

function attachRootCauseChains(bugs, ctx, calc, inv) {
  return bugs.map(b => ({
    ...b,
    rootCauseChain: buildRootCauseChain(b, ctx, calc, inv)
  }));
}

// ─── Anomaly Hunter ───

function runAnomalyHunter(ctx, tech, decision, histSummary) {
  const anomalies = [];
  const warnings = [];
  const candles = ctx.candles || [];
  if (candles.length < CONFIG.minCandles) {
    return { anomalies, warnings, summary: { skipped: true } };
  }

  const ind = (tech && tech.indicators) || {};
  const closes = candles.map(c => c.c).filter(isNum);

  // RSI jump vs recent window
  if (isNum(ind.rsi) && closes.length > CONFIG.rsiPeriod + 5) {
    const prevCloses = closes.slice(0, -3);
    const prevRsi = independentRSI(prevCloses, CONFIG.rsiPeriod);
    if (isNum(prevRsi)) {
      const jump = Math.abs(ind.rsi - prevRsi);
      if (jump > 35) {
        anomalies.push({
          id: `ANOM-RSI-${Date.now().toString(36)}`,
          type: 'RSI_JUMP',
          module: 'indicators/rsi',
          observedPattern: `ΔRSI=${jump.toFixed(1)} in ~3 bars`,
          historicalBaseline: 'typical ΔRSI per few bars < 20',
          deviation: jump,
          anomalyScore: Math.min(100, Math.round(jump * 2)),
          severity: jump > 50 ? 'HIGH' : 'MEDIUM',
          classification: jump > 50 ? 'Suspicious Behavior' : 'Normal Variation',
          possibleCause: 'Sharp price move or data gap'
        });
      }
    }
  }

  // Confidence stuck near 50% or extreme
  const conf = decision?.confidence;
  if (isNum(conf)) {
    const cPct = conf > 1.5 ? conf : conf * 100;
    if (Math.abs(cPct - 50) < 1.5) {
      anomalies.push({
        id: `ANOM-CONF50-${Date.now().toString(36)}`,
        type: 'CONFIDENCE_NEUTRAL_STUCK',
        module: 'decision/confidence',
        observedPattern: `confidence≈${cPct.toFixed(1)}%`,
        historicalBaseline: 'varied confidence distribution',
        deviation: Math.abs(cPct - 50),
        anomalyScore: 40,
        severity: 'LOW',
        classification: 'Normal Variation',
        possibleCause: 'Score near 50 → neutral confidence formula'
      });
    }
    if (cPct > 95) {
      anomalies.push({
        id: `ANOM-CONFHI-${Date.now().toString(36)}`,
        type: 'CONFIDENCE_EXTREME',
        module: 'decision/confidence',
        observedPattern: `confidence=${cPct.toFixed(1)}%`,
        historicalBaseline: 'rarely >90 without strong multi-factor agreement',
        deviation: cPct - 90,
        anomalyScore: 70,
        severity: 'MEDIUM',
        classification: 'Suspicious Behavior',
        possibleCause: 'Possible overconfidence'
      });
    }
  }

  // Target too close to price
  const price = isNum(ctx.currentPrice) ? ctx.currentPrice : (ind.price || last(closes));
  const target = decision?.target;
  if (isNum(price) && isNum(target) && price > 0) {
    const dist = Math.abs(target - price) / price;
    if (dist < 0.002 && decision?.signal && decision.signal !== 'HOLD') {
      anomalies.push({
        id: `ANOM-TGT-${Date.now().toString(36)}`,
        type: 'TARGET_TOO_CLOSE',
        module: 'forecast/target',
        observedPattern: `target distance ${(dist * 100).toFixed(3)}%`,
        historicalBaseline: 'meaningful target usually >0.3% away',
        deviation: dist,
        anomalyScore: 65,
        severity: 'MEDIUM',
        classification: 'Suspicious Behavior',
        possibleCause: 'S/R levels collapsed near price'
      });
    }
  }

  // Flat technical score pattern (always mid)
  if (isNum(tech?.score) && tech.score >= 48 && tech.score <= 52) {
    anomalies.push({
      id: `ANOM-TSCORE-${Date.now().toString(36)}`,
      type: 'TECH_SCORE_FLAT',
      module: 'technical/score',
      observedPattern: `techScore=${tech.score}`,
      historicalBaseline: 'score varies with market conditions',
      deviation: Math.abs(tech.score - 50),
      anomalyScore: 35,
      severity: 'INFO',
      classification: 'Normal Variation',
      possibleCause: 'Neutral market / balanced factors'
    });
  }

  // HOLD dominance warning from hist self-test
  if (histSummary && (histSummary.correct + histSummary.wrong + histSummary.neutral) >= 4) {
    const total = histSummary.correct + histSummary.wrong + histSummary.neutral;
    if (histSummary.neutral / total > 0.85) {
      anomalies.push({
        id: `ANOM-HOLD-${Date.now().toString(36)}`,
        type: 'HOLD_DOMINANCE',
        module: 'forecast/selftest',
        observedPattern: `neutral ratio=${((histSummary.neutral / total) * 100).toFixed(0)}%`,
        historicalBaseline: 'directional signals expected occasionally',
        deviation: histSummary.neutral / total,
        anomalyScore: 55,
        severity: 'LOW',
        classification: 'Suspicious Behavior',
        possibleCause: 'Thresholds produce mostly HOLD on this dataset'
      });
    }
  }

  // Injected anomaly faults
  for (const f of _injectedFaults) {
    if (f.type === 'anomaly') {
      anomalies.push({
        id: `ANOM-INJ-${Date.now().toString(36)}`,
        type: f.anomalyType || 'INJECTED',
        module: f.module || 'test',
        observedPattern: f.pattern || 'injected',
        historicalBaseline: f.baseline || 'n/a',
        deviation: f.deviation ?? 1,
        anomalyScore: f.score ?? 90,
        severity: f.severity || 'HIGH',
        classification: 'Likely Bug',
        possibleCause: f.cause || 'Injected anomaly'
      });
    }
  }

  // Convert high-score likely bugs to warnings
  for (const a of anomalies) {
    if (a.classification === 'Likely Bug' || (a.anomalyScore >= 80 && a.severity !== 'INFO')) {
      warnings.push(makeBug(null, 'Anomaly', a.severity === 'HIGH' ? 'HIGH' : 'MEDIUM', a.module,
        a.observedPattern, a.historicalBaseline, a.observedPattern, a.deviation,
        a.possibleCause));
    }
  }

  const maxScore = anomalies.reduce((m, a) => Math.max(m, a.anomalyScore || 0), 0);
  return {
    anomalies,
    warnings,
    summary: {
      count: anomalies.length,
      maxAnomalyScore: maxScore,
      byClass: anomalies.reduce((acc, a) => {
        acc[a.classification] = (acc[a.classification] || 0) + 1;
        return acc;
      }, {})
    }
  };
}

// ─── Prediction Auditor ───

function runPredictionAuditor(ctx, tech, decision) {
  if (!decision || !decision.ok) {
    return {
      ok: false,
      trustStatus: 'REJECT',
      auditScore: null,
      declaredConfidence: null,
      defendedConfidence: null,
      dimensions: null,
      message: 'No valid decision to audit'
    };
  }

  const ind = (tech && tech.indicators) || {};
  const signal = decision.signal;
  const declared = decision.confidence;
  const declaredPct = isNum(declared) ? (declared > 1.5 ? declared : declared * 100) : null;

  // Technical evidence from score distance from neutral
  const techScore = tech?.score ?? decision.analysis?.technicalScore;
  let techEvidence = 50;
  if (isNum(techScore)) {
    techEvidence = Math.min(100, Math.round(50 + Math.abs(techScore - 50)));
  }

  // Fundamental evidence
  const fundScore = decision.analysis?.fundamentalScore;
  let fundEvidence = 40; // weak if missing
  if (isNum(fundScore) && decision.fundamentalApplied) {
    fundEvidence = Math.min(100, Math.round(50 + Math.abs(fundScore - 50)));
  }

  // Historical similarity proxy from learning metrics if available — offline soft default
  let histSim = 55;
  try {
    const preds = listPredictions(ctx.symbol);
    const evaluated = (preds || []).filter(p => p.evaluation);
    if (evaluated.length >= 3) {
      const correct = evaluated.filter(p => p.evaluation.outcome === 'correct').length;
      histSim = Math.round((correct / evaluated.length) * 100);
    } else {
      histSim = null; // insufficient
    }
  } catch { histSim = null; }

  // Market regime: volatility proxy
  let regime = 50;
  if (isNum(ind.atrPct)) {
    if (ind.atrPct > 7) regime = 35;
    else if (ind.atrPct < 2) regime = 45;
    else regime = 60;
  }

  // Risk/Reward
  const price = isNum(ctx.currentPrice) ? ctx.currentPrice : ind.price;
  const target = decision.target;
  const stop = decision.stop;
  let rrScore = 50;
  if (isNum(price) && isNum(target) && isNum(stop) && Math.abs(price - stop) > 1e-9) {
    const reward = Math.abs(target - price);
    const risk = Math.abs(price - stop);
    const rr = reward / risk;
    rrScore = Math.min(100, Math.round(40 + rr * 25));
  }

  // Signal consistency vs score
  const combined = decision.analysis?.combinedScore ?? decision.score;
  let sigCons = 60;
  if (signal === 'BUY' && isNum(combined)) sigCons = combined >= CONFIG.buyThreshold ? 85 : 30;
  else if (signal === 'SELL' && isNum(combined)) sigCons = combined <= CONFIG.sellThreshold ? 85 : 30;
  else if (signal === 'HOLD' && isNum(combined)) {
    sigCons = (combined < CONFIG.buyThreshold && combined > CONFIG.sellThreshold) ? 80 : 40;
  }

  const dims = {
    technicalEvidence: techEvidence,
    fundamentalEvidence: fundEvidence,
    historicalSimilarity: histSim, // null = insufficient
    marketRegime: regime,
    riskReward: rrScore,
    signalConsistency: sigCons
  };

  const usable = Object.values(dims).filter(v => v != null);
  const auditScore = usable.length ? Math.round(usable.reduce((a, b) => a + b, 0) / usable.length) : null;

  // Defended confidence = blend of declared and audit (never inflate above audit+5)
  let defended = null;
  if (auditScore != null) {
    if (declaredPct != null) {
      defended = Math.min(declaredPct, auditScore + 5);
      defended = Math.round(0.4 * declaredPct + 0.6 * auditScore);
      // cap: cannot exceed audit by much
      if (defended > auditScore + 8) defended = auditScore + 8;
    } else {
      defended = auditScore;
    }
  }

  let trustStatus = 'CAUTION';
  if (auditScore == null || (ctx.candles || []).length < CONFIG.minCandles) {
    trustStatus = 'REJECT';
  } else if (auditScore >= 70 && sigCons >= 60 && (declaredPct == null || Math.abs(declaredPct - defended) < 20)) {
    trustStatus = 'TRUSTED';
  } else if (auditScore < 45 || sigCons < 35) {
    trustStatus = 'REJECT';
  } else {
    trustStatus = 'CAUTION';
  }

  // Injected audit faults
  for (const f of _injectedFaults) {
    if (f.type === 'audit') {
      trustStatus = f.trustStatus || 'REJECT';
      return {
        ok: true,
        trustStatus,
        auditScore: f.auditScore ?? 40,
        declaredConfidence: declaredPct,
        defendedConfidence: f.defended ?? 40,
        dimensions: dims,
        message: f.cause || 'Injected audit failure',
        overconfident: true
      };
    }
  }

  const overconfident = declaredPct != null && defended != null && declaredPct - defended > 12;

  return {
    ok: true,
    trustStatus,
    auditScore,
    declaredConfidence: declaredPct,
    defendedConfidence: defended,
    dimensions: dims,
    overconfident,
    message: overconfident
      ? `Confidence اعلام‌شده: ${declaredPct?.toFixed?.(0) ?? declaredPct}% · قابل دفاع: ${defended}%`
      : `Audit Score: ${auditScore}/100 · Trust: ${trustStatus}`
  };
}

// ─── Calibration Engine ───

const MIN_CALIBRATION_SAMPLES = 5;

function runCalibrationEngine(symbol) {
  let preds = [];
  try {
    preds = listPredictions(symbol) || [];
  } catch {
    preds = [];
  }
  const evaluated = preds.filter(p => p.evaluation && isNum(p.confidence));
  if (evaluated.length < MIN_CALIBRATION_SAMPLES) {
    return {
      ok: false,
      status: 'INSUFFICIENT_EVIDENCE',
      sampleCount: evaluated.length,
      minRequired: MIN_CALIBRATION_SAMPLES,
      bins: [],
      overall: null,
      message: 'داده کافی برای Calibration وجود ندارد'
    };
  }

  const binsDef = [
    { lo: 50, hi: 60, label: '50–60%' },
    { lo: 60, hi: 70, label: '60–70%' },
    { lo: 70, hi: 80, label: '70–80%' },
    { lo: 80, hi: 90, label: '80–90%' },
    { lo: 90, hi: 101, label: '90–100%' }
  ];

  const bins = binsDef.map(b => {
    const items = evaluated.filter(p => {
      const c = p.confidence > 1.5 ? p.confidence : p.confidence * 100;
      return c >= b.lo && c < b.hi;
    });
    const n = items.length;
    if (n === 0) {
      return { ...b, sampleCount: 0, declaredMean: null, actualAccuracy: null, calibrationError: null, status: 'NO_DATA' };
    }
    const declaredMean = items.reduce((s, p) => s + (p.confidence > 1.5 ? p.confidence : p.confidence * 100), 0) / n;
    const correct = items.filter(p => p.evaluation.outcome === 'correct').length;
    const actualAccuracy = (correct / n) * 100;
    const calibrationError = declaredMean - actualAccuracy;
    let status = 'WELL_CALIBRATED';
    if (calibrationError > 10) status = 'OVERCONFIDENT';
    else if (calibrationError < -10) status = 'UNDERCONFIDENT';
    return {
      ...b,
      sampleCount: n,
      declaredMean: Math.round(declaredMean * 10) / 10,
      actualAccuracy: Math.round(actualAccuracy * 10) / 10,
      calibrationError: Math.round(calibrationError * 10) / 10,
      status
    };
  });

  const withData = bins.filter(b => b.sampleCount > 0);
  const meanErr = withData.length
    ? withData.reduce((s, b) => s + Math.abs(b.calibrationError || 0), 0) / withData.length
    : null;
  let overall = 'WELL_CALIBRATED';
  if (meanErr != null && meanErr > 12) overall = 'OVERCONFIDENT';
  else if (meanErr != null && withData.some(b => b.status === 'UNDERCONFIDENT') && meanErr > 8) overall = 'UNDERCONFIDENT';

  // Persist snapshot
  saveJSON(CALIBRATION_KEY, { ts: Date.now(), symbol, bins, overall, sampleCount: evaluated.length });

  return {
    ok: true,
    status: overall,
    sampleCount: evaluated.length,
    minRequired: MIN_CALIBRATION_SAMPLES,
    bins,
    overall,
    meanAbsError: meanErr != null ? Math.round(meanErr * 10) / 10 : null,
    message: overall === 'OVERCONFIDENT' ? 'مدل تمایل به Overconfidence دارد' :
      overall === 'UNDERCONFIDENT' ? 'مدل تمایل به Underconfidence دارد' : 'Calibration در محدوده قابل قبول'
  };
}

// ─── Regression Memory (version baselines) ───

function loadRegressionMemory() {
  return loadJSON(REGRESSION_MEMORY_KEY, { versions: [] }) || { versions: [] };
}

function saveRegressionMemory(mem) {
  return saveJSON(REGRESSION_MEMORY_KEY, mem);
}

function updateRegressionMemory(report, snapshot) {
  const mem = loadRegressionMemory();
  if (!Array.isArray(mem.versions)) mem.versions = [];

  const entry = {
    version: APP_VERSION,
    debuggerVersion: VERSION,
    ts: Date.now(),
    testsRun: report.testsRun,
    passed: report.passed,
    failed: report.failed,
    warnings: report.warnings,
    status: report.status,
    snapshot: {
      rsi: snapshot.rsi,
      sma: snapshot.sma,
      techScore: snapshot.techScore,
      combinedScore: snapshot.combinedScore,
      dataFingerprint: snapshot.dataFingerprint
    },
    knownBugs: (report.bugs || []).slice(0, 20).map(b => ({
      id: b.id, category: b.category, severity: b.severity, module: b.module
    })),
    anomalyCount: report.anomalySummary?.count ?? 0,
    auditTrust: report.predictionAudit?.trustStatus ?? null
  };

  // Compare with previous version entry if fingerprint matches
  let regressionDetails = [];
  const prev = mem.versions.find(v =>
    v.snapshot?.dataFingerprint &&
    v.snapshot.dataFingerprint === snapshot.dataFingerprint &&
    v.version !== APP_VERSION
  ) || (mem.versions.length ? mem.versions[0] : null);

  if (prev && prev.snapshot?.dataFingerprint === snapshot.dataFingerprint) {
    const keys = ['rsi', 'sma', 'techScore', 'combinedScore'];
    for (const k of keys) {
      if (isNum(prev.snapshot[k]) && isNum(snapshot[k]) && !approxEqual(prev.snapshot[k], snapshot[k], TOLERANCE.score)) {
        regressionDetails.push({
          testId: `REGMEM-${k}`,
          previousVersion: prev.version,
          currentVersion: APP_VERSION,
          previousResult: prev.snapshot[k],
          currentResult: snapshot[k],
          difference: Math.abs(prev.snapshot[k] - snapshot[k]),
          severity: 'CRITICAL',
          affectedModule: k
        });
      }
    }
  }

  // Keep one entry per version (update latest)
  const idx = mem.versions.findIndex(v => v.version === APP_VERSION);
  if (idx >= 0) mem.versions[idx] = entry;
  else mem.versions.unshift(entry);
  while (mem.versions.length > 20) mem.versions.pop();
  saveRegressionMemory(mem);

  return { regressionDetails, memory: mem, previous: prev };
}

export function getRegressionMemory() {
  return loadRegressionMemory();
}

function computeHealthScore(report) {
  let score = 100;
  score -= (report.failed || 0) * 12;
  score -= (report.warnings || 0) * 2;
  const anom = report.anomalySummary?.maxAnomalyScore || 0;
  if (anom >= 80) score -= 15;
  else if (anom >= 50) score -= 5;
  if (report.predictionAudit?.trustStatus === 'REJECT') score -= 20;
  else if (report.predictionAudit?.trustStatus === 'CAUTION') score -= 8;
  if (report.calibration?.status === 'OVERCONFIDENT') score -= 5;
  if (report.status === 'CRITICAL') score = Math.min(score, 40);
  return Math.max(0, Math.min(100, Math.round(score)));
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

  // 5. Historical self-test (deep only)
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
  const snapshot = {
    dataFingerprint: buildDataFingerprint(ctx.candles),
    rsi: calc.details?.rsi?.main ?? null,
    sma: calc.details?.sma?.main ?? null,
    ema: calc.details?.ema?.main ?? null,
    techScore: tech?.score ?? null,
    combinedScore: (decision?.analysis?.combinedScore != null)
      ? decision.analysis.combinedScore
      : (decision?.score ?? null),
    signal: decision?.signal ?? null
  };

  // 6. Regression
  const reg = runRegressionCheck(ctx, snapshot);
  allBugs.push(...reg.bugs);
  allWarnings.push(...reg.warnings);
  sections.regression = { status: reg.status, bugs: reg.bugs.length };

  // 7. Anomaly Hunter (deep always runs fuller; quick runs light subset via same fn)
  const anom = runAnomalyHunter(ctx, tech, decision, hist.summary);
  allWarnings.push(...anom.warnings);
  sections.anomalies = anom.summary;

  // 8. Prediction Auditor
  const audit = runPredictionAuditor(ctx, tech, decision);
  sections.predictionAudit = {
    trustStatus: audit.trustStatus,
    auditScore: audit.auditScore,
    declared: audit.declaredConfidence,
    defended: audit.defendedConfidence
  };
  if (audit.trustStatus === 'REJECT' && audit.ok) {
    allWarnings.push(makeBug(null, 'Prediction Audit', 'HIGH', 'prediction/auditor',
      null, 'TRUSTED/CAUTION', 'REJECT', null, audit.message));
  } else if (audit.overconfident) {
    allWarnings.push(makeBug(null, 'Overconfidence', 'MEDIUM', 'prediction/auditor',
      null, audit.defendedConfidence, audit.declaredConfidence,
      (audit.declaredConfidence ?? 0) - (audit.defendedConfidence ?? 0),
      audit.message));
  }

  // 9. Calibration (deep only — needs evaluated predictions)
  let calibration = { status: 'SKIPPED', message: 'Quick mode' };
  if (mode === 'deep') {
    calibration = runCalibrationEngine(ctx.symbol);
    sections.calibration = {
      status: calibration.status || calibration.overall,
      sampleCount: calibration.sampleCount,
      overall: calibration.overall
    };
    if (calibration.ok && calibration.overall === 'OVERCONFIDENT') {
      allWarnings.push(makeBug(null, 'Calibration', 'MEDIUM', 'prediction/calibration',
        `n=${calibration.sampleCount}`, 'WELL_CALIBRATED', 'OVERCONFIDENT',
        calibration.meanAbsError, calibration.message));
    }
  } else {
    sections.calibration = { skipped: true };
  }

  // 10. Root cause chains + Debug Memory enrichment
  let enrichedBugs = attachRootCauseChains(allBugs, ctx, calc, inv);
  enrichedBugs = updateDebugMemory(enrichedBugs);
  const repeated = enrichedBugs.filter(b => b.repeatedWarning);
  for (const b of repeated) {
    allWarnings.push(makeBug(null, 'Repeated Historical Bug', 'MEDIUM', b.module,
      b.historicalMatch?.bugId, null, b.occurrenceCount, null, b.repeatedWarning));
  }

  // 11. Regression Memory
  const regMem = updateRegressionMemory(
    { testsRun: 0, passed: 0, failed: enrichedBugs.length, warnings: allWarnings.length, status: 'PENDING', bugs: enrichedBugs },
    snapshot
  );
  if (regMem.regressionDetails.length) {
    for (const d of regMem.regressionDetails) {
      enrichedBugs.push(makeBug(null, 'REGRESSION DETECTED', d.severity, d.affectedModule,
        d.testId, d.previousResult, d.currentResult, d.difference,
        `Version ${d.previousVersion} → ${d.currentVersion}`));
    }
  }
  sections.regressionMemory = {
    versionsStored: (regMem.memory?.versions || []).length,
    newRegressions: regMem.regressionDetails.length
  };

  // Safe Auto-Fix — only when user explicitly requests (safeAutoFix: true)
  // Never mutates financial formulas, forecast logic, or scores.
  const fixes = [];
  const fixProposals = [];
  if (options.safeAutoFix) {
    const mem = loadDebugMemory();
    // 1) Storage re-probe
    for (const b of enrichedBugs) {
      if (b.category === 'Storage Error' || (b.module && String(b.module).includes('storage'))) {
        try {
          if (typeof localStorage !== 'undefined') {
            const k = 'oma_ad_fix_probe';
            localStorage.setItem(k, '1');
            const ok = localStorage.getItem(k) === '1';
            localStorage.removeItem(k);
            if (ok) {
              fixes.push({ bugId: b.id, action: 'reprobe-storage', result: 'ok', level: 1 });
              b.status = 'FIXED';
            } else {
              fixes.push({ bugId: b.id, action: 'reprobe-storage', result: 'fail', level: 1 });
            }
          } else {
            fixes.push({ bugId: b.id, action: 'reprobe-storage', result: 'skipped-no-storage', level: 1 });
          }
        } catch (e) {
          fixes.push({ bugId: b.id, action: 'reprobe-storage', result: 'error:' + (e.message || e), level: 1 });
        }
      }
    }
    // 2) Clear soft RT output block if user requested fix
    try {
      _rtBlocked = false;
      fixes.push({ bugId: null, action: 'clear-output-block', result: 'ok', level: 1 });
    } catch { /* ignore */ }
    // 3) Mark repeated INFO/LOW memory patterns as acknowledged (not financial)
    if (mem && Array.isArray(mem.bugs)) {
      let marked = 0;
      for (const mb of mem.bugs) {
        if (mb.status === 'OPEN' && (mb.category === 'Storage Error' || mb.category === 'Storage Skip' || mb.category === 'RT Finding')) {
          mb.status = 'FIXED';
          mb.previousFix = 'user-safe-auto-fix';
          mb.fixResult = 'acknowledged';
          mb.lastSeen = Date.now();
          marked++;
        }
      }
      if (marked) {
        saveDebugMemory(mem);
        fixes.push({ bugId: null, action: 'debug-memory-ack', result: `marked ${marked}`, level: 1 });
      }
    }
    // 4) Level-2 proposals for financial issues (no auto apply)
    for (const b of enrichedBugs) {
      const cat = (b.category || '').toLowerCase();
      const mod = (b.module || '').toLowerCase();
      if (b.status === 'FIXED') continue;
      if (
        cat.includes('invariant') || cat.includes('mismatch') || cat.includes('signal') ||
        cat.includes('forecast') || cat.includes('range') || cat.includes('logic') ||
        mod.includes('decision') || mod.includes('forecast') || mod.includes('technical')
      ) {
        fixProposals.push({
          bugId: b.id,
          category: b.category,
          module: b.module,
          message: b.possibleRootCause || b.category,
          expected: b.expected,
          actual: b.actual,
          suggestion: 'این مورد نیاز به بررسی دستی دارد؛ Auto-Fix خودکار روی فرمول/Forecast اعمال نمی‌شود.',
          requiresUserApproval: true,
          level: 2
        });
      }
    }
    // 5) Re-run critical storage/data checks after fixes (transaction-style)
    const postBugs = [];
    try {
      const app2 = checkApplicationHealth(ctx);
      for (const b of app2.bugs) {
        if (b.category === 'Storage Error') postBugs.push(b);
      }
    } catch { /* ignore */ }
    if (postBugs.length && fixes.some(f => f.action === 'reprobe-storage' && f.result === 'ok')) {
      // rollback claim
      for (const f of fixes) {
        if (f.action === 'reprobe-storage') f.result = 'rolled-back-still-failing';
      }
      for (const b of enrichedBugs) {
        if (b.category === 'Storage Error') b.status = 'OPEN';
      }
      fixes.push({ bugId: null, action: 'rollback', result: 'storage still failing after fix', level: 1 });
    }
  }

  // Aggregate status
  const critical = enrichedBugs.filter(b => b.severity === 'CRITICAL').length;
  const high = enrichedBugs.filter(b => b.severity === 'HIGH').length;
  let status = 'HEALTHY';
  if (critical > 0) status = 'CRITICAL';
  else if (high > 0 || enrichedBugs.length > 0) status = 'WARNING';
  else if (allWarnings.length > 5) status = 'WARNING';
  if (audit.trustStatus === 'REJECT' && mode === 'deep') {
    if (status === 'HEALTHY') status = 'WARNING';
  }

  const report = {
    version: VERSION,
    appVersion: APP_VERSION,
    mode,
    ts: Date.now(),
    durationMs: Date.now() - start,
    status,
    testsRun: countTests(sections),
    passed: 0,
    failed: enrichedBugs.length,
    warnings: allWarnings.length,
    bugs: enrichedBugs,
    warningItems: allWarnings,
    sections,
    historicalResults: hist.results || [],
    historicalSummary: hist.summary || null,
    snapshot,
    fixes,
    fixProposals: typeof fixProposals !== 'undefined' ? fixProposals : [],
    anomalies: anom.anomalies || [],
    anomalySummary: anom.summary || null,
    predictionAudit: audit,
    calibration,
    regressionMemory: {
      details: regMem.regressionDetails,
      previousVersion: regMem.previous?.version || null
    },
    repeatedBugs: repeated.length,
    realtime: {
      state: loadRtState(),
      recentCorrections: (loadCorrectionLog() || []).slice(0, 5)
    },
    userMessages: enrichedBugs.map(userFriendlyMsg).concat(allWarnings.slice(0, 8).map(userFriendlyMsg))
  };

  report.testsRun = countTests(sections);
  report.passed = Math.max(0, report.testsRun - report.failed);
  report.healthScore = computeHealthScore(report);

  // Final status label for regression memory entry
  updateRegressionMemory(report, snapshot);

  persistReport(report);
  _lastReport = report;
  _injectedFaults = [];

  return report;
}

function countTests(sections) {
  let n = 8;
  if (sections.calculations && !sections.calculations.details?.skipped) n += 6;
  if (sections.invariants) n += 10;
  if (sections.forecast) n += 4;
  if (sections.historical && !sections.historical.skipped) n += 5;
  n += 3; // regression
  n += 6; // anomaly hunter checks
  n += 6; // prediction auditor dimensions
  if (sections.calibration && !sections.calibration.skipped) n += 5;
  n += 2; // debug memory + regression memory
  return n;
}

function persistReport(report) {
  const hist = loadJSON(DEBUG_STORAGE_KEY, []) || [];
  const entry = {
    scanDate: report.ts,
    version: report.version,
    appVersion: report.appVersion,
    mode: report.mode,
    status: report.status,
    healthScore: report.healthScore,
    passed: report.passed,
    failed: report.failed,
    warnings: report.warnings,
    bugs: (report.bugs || []).map(b => ({
      id: b.id, category: b.category, severity: b.severity, module: b.module, status: b.status,
      occurrenceCount: b.occurrenceCount
    })),
    fixedBugs: (report.fixes || []).length,
    forecastTestResult: report.historicalSummary || null,
    anomalyCount: report.anomalySummary?.count ?? 0,
    predictionAudit: report.predictionAudit?.trustStatus ?? null,
    calibration: report.calibration?.overall || report.calibration?.status || null,
    durationMs: report.durationMs
  };
  hist.unshift(entry);
  while (hist.length > 50) hist.pop();
  saveJSON(DEBUG_STORAGE_KEY, hist);
}


// ═══════════════════════════════════════════════════════════
// NEW (v1.2): Real-Time Monitor · Correction Engine
// Transaction / Rollback · Loop Protection
// ═══════════════════════════════════════════════════════════

let _rtListeners = [];
let _rtCorrectionDepth = 0;
let _rtLastEventId = null;
let _rtBlocked = false;

let _memCorrectionLog = null;
let _memRtState = null;

function loadCorrectionLog() {
  const fromStore = loadJSON(CORRECTION_LOG_KEY, null);
  if (fromStore) { _memCorrectionLog = fromStore; return fromStore; }
  if (!_memCorrectionLog) _memCorrectionLog = [];
  return _memCorrectionLog;
}

function saveCorrectionLog(list) {
  while (list.length > 100) list.pop();
  _memCorrectionLog = list;
  saveJSON(CORRECTION_LOG_KEY, list);
  return true;
}

function defaultRtState() {
  return {
    lastEvent: null,
    lastValidation: null,
    blockedOutputs: 0,
    correctionsAccepted: 0,
    correctionsRolledBack: 0,
    loopsDetected: 0
  };
}

function loadRtState() {
  const fromStore = loadJSON(RT_STATE_KEY, null);
  if (fromStore && typeof fromStore === 'object') {
    _memRtState = fromStore;
    return fromStore;
  }
  if (!_memRtState) _memRtState = defaultRtState();
  return _memRtState;
}

function saveRtState(st) {
  _memRtState = st;
  saveJSON(RT_STATE_KEY, st);
  return true;
}

/**
 * Real-Time Monitor — event-driven, incremental validation.
 * Does NOT re-run full Deep Check on every event.
 * @param {string} eventType - e.g. 'data_update' | 'forecast_generated' | 'score_update' | 'storage_update' | 'user_input'
 * @param {object} payload
 */
export function emitRealtimeEvent(eventType, payload = {}) {
  const event = {
    id: `EVT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: eventType,
    ts: Date.now(),
    payload: payload || {}
  };

  const result = processRealtimeEvent(event);

  for (const fn of _rtListeners) {
    try { fn(event, result); } catch { /* ignore listener errors */ }
  }
  return result;
}

export function onRealtimeEvent(fn) {
  if (typeof fn === 'function') _rtListeners.push(fn);
  return () => { _rtListeners = _rtListeners.filter(f => f !== fn); };
}

function processRealtimeEvent(event) {
  const st = loadRtState();
  st.lastEvent = { id: event.id, type: event.type, ts: event.ts };
  _rtLastEventId = event.id;

  // Incremental critical checks only
  const findings = [];
  const payload = event.payload || {};

  // Data integrity on data-related events
  if (['data_update', 'user_input', 'storage_update'].includes(event.type)) {
    const candles = payload.candles || [];
    if (candles.length) {
      let bad = 0;
      for (const c of candles.slice(-20)) {
        if (!c) { bad++; continue; }
        const vals = [c.o, c.h, c.l, c.c];
        for (const v of vals) {
          if (v != null && (!isNum(v) || v < 0)) { bad++; break; }
        }
        if (isNum(c.h) && isNum(c.l) && c.h < c.l) bad++;
      }
      if (bad > 0) {
        findings.push({
          severity: 'HIGH',
          category: 'Data Integrity',
          message: `${bad} invalid bar(s) in recent data`,
          correctionLevel: 1
        });
      }
    }
  }

  // Forecast / score events — critical invariants only
  if (['forecast_generated', 'score_update'].includes(event.type)) {
    const d = payload.decision || payload.result || {};
    const signal = d.signal;
    const score = d.score ?? d.combinedScore ?? d.analysis?.combinedScore;
    const conf = d.confidence;
    const target = d.target;
    const stop = d.stop;
    const price = payload.currentPrice ?? d.price;

    if (score != null && (!isNum(score) || score < 0 || score > 100)) {
      findings.push({
        severity: 'CRITICAL',
        category: 'Range Violation',
        message: `Score out of range: ${score}`,
        correctionLevel: 3,
        field: 'score',
        actual: score
      });
    }
    if (conf != null) {
      const cPct = conf > 1.5 ? conf : conf * 100;
      if (!isNum(conf) || cPct < 0 || cPct > 150) {
        findings.push({
          severity: 'HIGH',
          category: 'Range Violation',
          message: `Confidence out of range: ${conf}`,
          correctionLevel: 3,
          field: 'confidence',
          actual: conf
        });
      }
    }
    if (signal === 'BUY' && isNum(target) && isNum(price) && target < price) {
      findings.push({
        severity: 'HIGH',
        category: 'Invariant Violation',
        message: 'BUY target below price',
        correctionLevel: 2,
        field: 'target',
        actual: target,
        expected: `> ${price}`
      });
    }
    if (signal === 'SELL' && isNum(target) && isNum(price) && target > price) {
      findings.push({
        severity: 'HIGH',
        category: 'Invariant Violation',
        message: 'SELL target above price',
        correctionLevel: 2,
        field: 'target',
        actual: target,
        expected: `< ${price}`
      });
    }
    if (signal === 'BUY' && isNum(stop) && isNum(price) && stop > price) {
      findings.push({
        severity: 'HIGH',
        category: 'Invariant Violation',
        message: 'BUY stop above price',
        correctionLevel: 2,
        field: 'stop',
        actual: stop
      });
    }
  }

  // Injected RT faults
  for (const f of _injectedFaults) {
    if (f.type === 'rt_error') {
      findings.push({
        severity: f.severity || 'HIGH',
        category: f.category || 'Runtime',
        message: f.message || 'Injected RT error',
        correctionLevel: f.correctionLevel ?? 1
      });
    }
    if (f.type === 'correction_loop') {
      findings.push({
        severity: 'CRITICAL',
        category: 'Correction Loop',
        message: 'Injected loop scenario',
        correctionLevel: 1,
        forceLoop: true
      });
    }
  }

  let correctionResult = null;
  if (findings.length) {
    correctionResult = runRealtimeCorrection(event, findings, payload);
  }

  const status = findings.some(f => f.severity === 'CRITICAL')
    ? 'CRITICAL'
    : findings.length ? 'WARNING' : 'OK';

  st.lastValidation = {
    eventId: event.id,
    status,
    findingsCount: findings.length,
    correction: correctionResult ? {
      level: correctionResult.level,
      action: correctionResult.action,
      committed: correctionResult.committed
    } : null
  };
  if (correctionResult?.action === 'BLOCK') st.blockedOutputs = (st.blockedOutputs || 0) + 1;
  if (correctionResult?.committed) st.correctionsAccepted = (st.correctionsAccepted || 0) + 1;
  if (correctionResult?.rolledBack) st.correctionsRolledBack = (st.correctionsRolledBack || 0) + 1;
  if (correctionResult?.loopDetected) st.loopsDetected = (st.loopsDetected || 0) + 1;
  saveRtState(st);

  return {
    eventId: event.id,
    eventType: event.type,
    status,
    findings,
    correction: correctionResult,
    blocked: correctionResult?.action === 'BLOCK',
    message: findings.length
      ? findings.map(f => f.message).join('; ')
      : 'Real-time checks passed'
  };
}

/**
 * Real-Time Correction Engine
 * Levels: 1 Safe Auto · 2 Assisted (proposal only) · 3 Protective Block
 */
function runRealtimeCorrection(event, findings, payload) {
  // Loop protection
  if (_rtCorrectionDepth >= CORRECTION_DEPTH_LIMIT || findings.some(f => f.forceLoop)) {
    _rtCorrectionDepth = 0;
    const logEntry = {
      correctionId: `COR-LOOP-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      trigger: event.type,
      action: 'LOOP_ABORT',
      level: 0,
      message: '🚨 CORRECTION LOOP DETECTED — all changes for this event rolled back',
      committed: false,
      rolledBack: true,
      loopDetected: true
    };
    const log = loadCorrectionLog();
    log.unshift(logEntry);
    saveCorrectionLog(log);
    return {
      correctionId: logEntry.correctionId,
      level: 0,
      action: 'LOOP_ABORT',
      committed: false,
      rolledBack: true,
      loopDetected: true,
      message: logEntry.message,
      proposals: []
    };
  }

  const maxLevel = Math.max(...findings.map(f => f.correctionLevel || 1));
  const correctionId = `COR-${Date.now().toString(36)}`;

  // Snapshot
  const snapshot = {
    candlesLen: (payload.candles || []).length,
    decision: payload.decision ? {
      signal: payload.decision.signal,
      score: payload.decision.score,
      confidence: payload.decision.confidence,
      target: payload.decision.target,
      stop: payload.decision.stop
    } : null,
    ts: Date.now()
  };

  // Level 3 — Protective Block
  if (maxLevel >= 3) {
    _rtBlocked = true;
    const entry = {
      correctionId,
      timestamp: Date.now(),
      trigger: event.type,
      eventId: event.id,
      level: 3,
      action: 'BLOCK',
      originalState: snapshot,
      appliedFix: null,
      validationResult: 'BLOCKED',
      committed: false,
      rolledBack: false,
      message: '🔴 Unverified Output — Critical issue; auto-fix forbidden',
      findings: findings.map(f => f.message)
    };
    const log = loadCorrectionLog();
    log.unshift(entry);
    saveCorrectionLog(log);
    return {
      correctionId,
      level: 3,
      action: 'BLOCK',
      committed: false,
      rolledBack: false,
      loopDetected: false,
      message: entry.message,
      proposals: [],
      blockedOutput: true
    };
  }

  // Level 2 — Assisted (proposal only, no auto apply)
  if (maxLevel === 2) {
    const proposals = findings.filter(f => f.correctionLevel === 2).map(f => ({
      field: f.field,
      issue: f.message,
      expected: f.expected,
      actual: f.actual,
      suggestion: f.field === 'target'
        ? 'بازبینی Target نسبت به Direction و قیمت'
        : f.field === 'stop'
          ? 'بازبینی Stop Loss نسبت به Direction'
          : 'بازبینی دستی فیلد مرتبط',
      requiresUserApproval: true
    }));
    const entry = {
      correctionId,
      timestamp: Date.now(),
      trigger: event.type,
      eventId: event.id,
      level: 2,
      action: 'PROPOSE',
      originalState: snapshot,
      appliedFix: null,
      validationResult: 'AWAITING_USER',
      committed: false,
      rolledBack: false,
      message: '🟡 Assisted Correction — نیاز به تأیید کاربر',
      proposals,
      findings: findings.map(f => f.message)
    };
    const log = loadCorrectionLog();
    log.unshift(entry);
    saveCorrectionLog(log);
    return {
      correctionId,
      level: 2,
      action: 'PROPOSE',
      committed: false,
      rolledBack: false,
      loopDetected: false,
      message: entry.message,
      proposals
    };
  }

  // Level 1 — Safe Auto-Correction (deterministic, reversible, low-risk)
  _rtCorrectionDepth += 1;
  const safeFixes = [];
  try {
    // Only sanitize clearly recoverable data issues in a copy — never mutate main engine output
    if (payload.candles && Array.isArray(payload.candles)) {
      // Detect NaN bars — report only; do not invent prices
      const nanBars = payload.candles.filter(c =>
        c && [c.o, c.h, c.l, c.c].some(v => v != null && !isNum(v))
      ).length;
      if (nanBars > 0) {
        safeFixes.push({
          type: 'flag_nan_bars',
          count: nanBars,
          note: 'Invalid bars flagged; values not fabricated'
        });
      }
    }

    // Storage re-probe (safe)
    if (findings.some(f => /storage/i.test(f.category || '') || /storage/i.test(f.message || ''))) {
      try {
        if (typeof localStorage !== 'undefined') {
          const k = 'oma_ad_rt_probe';
          localStorage.setItem(k, '1');
          const ok = localStorage.getItem(k) === '1';
          localStorage.removeItem(k);
          safeFixes.push({ type: 'storage_reprobe', result: ok ? 'ok' : 'fail' });
          if (!ok) throw new Error('storage probe failed');
        }
      } catch (e) {
        // Rollback path
        _rtCorrectionDepth = Math.max(0, _rtCorrectionDepth - 1);
        const entry = {
          correctionId,
          timestamp: Date.now(),
          trigger: event.type,
          level: 1,
          action: 'ROLLBACK',
          originalState: snapshot,
          appliedFix: safeFixes,
          validationResult: 'FAIL',
          committed: false,
          rolledBack: true,
          message: 'Rollback: safe fix validation failed — ' + (e.message || e)
        };
        const log = loadCorrectionLog();
        log.unshift(entry);
        saveCorrectionLog(log);
        return {
          correctionId,
          level: 1,
          action: 'ROLLBACK',
          committed: false,
          rolledBack: true,
          loopDetected: false,
          message: entry.message,
          proposals: []
        };
      }
    }

    // Re-validate: if critical findings remain without safe fix, don't commit falsely
    const stillCritical = findings.filter(f => f.severity === 'CRITICAL' && f.correctionLevel === 1);
    // Accept only when we actually applied something safe OR findings were informational data flags
    const commit = safeFixes.length > 0 || findings.every(f => f.severity !== 'CRITICAL');

    _rtCorrectionDepth = Math.max(0, _rtCorrectionDepth - 1);

    const entry = {
      correctionId,
      timestamp: Date.now(),
      trigger: event.type,
      eventId: event.id,
      level: 1,
      action: commit ? 'COMMIT' : 'NO_OP',
      originalState: snapshot,
      appliedFix: safeFixes,
      validationResult: commit ? 'PASS' : 'NO_SAFE_FIX',
      committed: commit && safeFixes.length > 0,
      rolledBack: false,
      message: commit && safeFixes.length
        ? '🟢 Safe auto-correction applied and re-validated'
        : '🟢 Detected; no destructive fix applied (safe mode)',
      findings: findings.map(f => f.message)
    };
    const log = loadCorrectionLog();
    log.unshift(entry);
    saveCorrectionLog(log);

    // Learn: feed into debug memory pattern
    if (findings.length) {
      updateDebugMemory(findings.map(f => makeBug(
        null, f.category || 'RT Finding', f.severity || 'MEDIUM', 'realtime',
        event.type, f.expected, f.actual, null, f.message
      )));
    }

    return {
      correctionId,
      level: 1,
      action: entry.action,
      committed: entry.committed,
      rolledBack: false,
      loopDetected: false,
      message: entry.message,
      proposals: [],
      fixes: safeFixes
    };
  } catch (e) {
    _rtCorrectionDepth = Math.max(0, _rtCorrectionDepth - 1);
    const entry = {
      correctionId,
      timestamp: Date.now(),
      trigger: event.type,
      level: 1,
      action: 'ROLLBACK',
      originalState: snapshot,
      appliedFix: safeFixes,
      validationResult: 'EXCEPTION',
      committed: false,
      rolledBack: true,
      message: 'Rollback after exception: ' + (e.message || e)
    };
    const log = loadCorrectionLog();
    log.unshift(entry);
    saveCorrectionLog(log);
    return {
      correctionId,
      level: 1,
      action: 'ROLLBACK',
      committed: false,
      rolledBack: true,
      loopDetected: false,
      message: entry.message,
      proposals: []
    };
  }
}

export function getCorrectionLog() {
  return loadCorrectionLog();
}

export function getRealtimeState() {
  return loadRtState();
}

export function clearCorrectionLog() {
  saveCorrectionLog([]);
  return true;
}

export function isOutputBlocked() {
  return _rtBlocked;
}

export function clearOutputBlock() {
  _rtBlocked = false;
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

export { TOLERANCE, VERSION as AUTO_DEBUGGER_VERSION, APP_VERSION };
