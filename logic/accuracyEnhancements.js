/**
 * Accuracy enhancements v12.2.0
 * - Probabilistic calibration (score → p_up)
 * - Hard quality gates (regime / ADX / MTF / confidence) → HOLD
 * - Multi-metric evaluation (direction, range coverage, EV)
 * - Split reporting: all signals vs high-quality filtered
 *
 * Does NOT remove existing ensemble logic; applies as a post-layer.
 */
import { CONFIG } from './config.js';
import { isNum } from './indicators.js';

const AE = CONFIG.accuracyEnhancements || {};

/** Logistic map of technical/combined score (0–100) → P(up). Centered at 50. */
export function scoreToProbability(score, temperature = AE.calibrationTemperature ?? 12) {
  if (!isNum(score)) return 0.5;
  const x = (score - 50) / Math.max(4, temperature);
  // stable sigmoid
  const p = 1 / (1 + Math.exp(-x));
  return Math.max(0.05, Math.min(0.95, p));
}

/**
 * Adaptive thresholds from calibrated probability.
 * Instead of fixed 57/43 only, require P(up) / P(down) margin.
 */
export function calibratedSignal(score, opts = {}) {
  const pUp = scoreToProbability(score, opts.temperature);
  const pDown = 1 - pUp;
  const minP = opts.minProbability ?? AE.minDirectionalProbability ?? 0.58;
  const margin = opts.minMargin ?? AE.minProbabilityMargin ?? 0.12;
  let signal = 'HOLD';
  if (pUp >= minP && pUp - pDown >= margin) signal = 'BUY';
  else if (pDown >= minP && pDown - pUp >= margin) signal = 'SELL';
  return {
    signal,
    pUp: Math.round(pUp * 1000) / 1000,
    pDown: Math.round(pDown * 1000) / 1000,
    minP,
    margin,
  };
}

/**
 * Hard gates: force HOLD unless quality stack passes.
 * Inputs from technical indicators, regime, mtf, ensemble confidence.
 */
export function applyQualityGates(ctx = {}) {
  const reasons = [];
  let pass = true;
  const enabled = AE.enableQualityGates !== false;

  if (!enabled) {
    return { pass: true, reasons: [], forcedHold: false, qualityScore: 1 };
  }

  const adx = ctx.adx;
  const minAdx = AE.minAdx ?? 18;
  if (isNum(adx) && adx < minAdx) {
    pass = false;
    reasons.push(`ADX ضعیف (${adx.toFixed?.(1) ?? adx} < ${minAdx})`);
  }

  const regime = ctx.regime || 'Unclear';
  const blockRegimes = AE.blockRegimes || ['Unclear'];
  if (blockRegimes.includes(regime) && (ctx.signal === 'BUY' || ctx.signal === 'SELL')) {
    // soft: only block if also low regime confidence
    const rc = ctx.regimeConfidence ?? 0.4;
    if (rc < (AE.minRegimeConfidence ?? 0.45)) {
      pass = false;
      reasons.push(`رژیم نامشخص/ضعیف (${regime})`);
    }
  }

  const mtfAgree = ctx.mtfAgreement;
  const minMtf = AE.minMtfAgreement ?? 0.45;
  if (ctx.mtfOk && isNum(mtfAgree) && mtfAgree < minMtf && ctx.signal !== 'HOLD') {
    pass = false;
    reasons.push(`توافق MTF پایین (${(mtfAgree * 100).toFixed(0)}٪)`);
  }
  if (ctx.mtfConflict && AE.blockMtfConflict !== false && ctx.signal !== 'HOLD') {
    pass = false;
    reasons.push('تعارض تایم‌فریم بالاتر/پایین‌تر');
  }

  const conf = ctx.confidence;
  const minConf = AE.minConfidence ?? 0.42;
  if (isNum(conf) && conf < minConf && ctx.signal !== 'HOLD') {
    pass = false;
    reasons.push(`اعتماد پایین (${(conf * 100).toFixed(0)}٪ < ${(minConf * 100).toFixed(0)}٪)`);
  }

  const agreement = ctx.agreement;
  const minAgr = AE.minStrategyAgreement ?? 0.4;
  if (isNum(agreement) && agreement < minAgr && ctx.signal !== 'HOLD') {
    pass = false;
    reasons.push(`توافق استراتژی‌ها ضعیف (${(agreement * 100).toFixed(0)}٪)`);
  }

  // High event risk → HOLD directional
  if ((ctx.eventRisk ?? 0) >= (AE.maxEventRisk ?? 0.72) && ctx.signal !== 'HOLD') {
    pass = false;
    reasons.push('ریسک رویداد بالا');
  }

  // EV gate when available
  if (isNum(ctx.evR) && ctx.evR < (AE.minEvR ?? -0.05) && ctx.signal !== 'HOLD') {
    pass = false;
    reasons.push(`EV ضعیف (${ctx.evR}R)`);
  }

  // Quality score 0–1 for reporting
  let q = 1;
  if (isNum(adx)) q *= Math.min(1, adx / 30);
  if (isNum(mtfAgree)) q *= 0.5 + 0.5 * mtfAgree;
  if (isNum(conf)) q *= 0.4 + 0.6 * conf;
  if (isNum(agreement)) q *= 0.5 + 0.5 * agreement;
  q = Math.max(0.05, Math.min(1, q));

  return {
    pass,
    forcedHold: !pass && ctx.signal !== 'HOLD',
    reasons,
    qualityScore: Math.round(q * 1000) / 1000,
  };
}

/**
 * Post-process ensemble: calibration + quality gates.
 * Returns updated signal/confidence and diagnostics (non-destructive extras).
 */
export function enhanceEnsembleDecision(ens, ctx = {}) {
  const rawSignal = ens.signal;
  const rawScore = ens.score;
  const cal = calibratedSignal(rawScore, {
    temperature: AE.calibrationTemperature,
    minProbability: AE.minDirectionalProbability,
    minMargin: AE.minProbabilityMargin,
  });

  // Blend: require BOTH classic threshold path AND calibrated path for directional
  // unless soft mode
  let signal = rawSignal;
  const mode = AE.calibrationMode || 'blend'; // 'off' | 'replace' | 'blend'
  if (mode === 'replace') {
    signal = cal.signal;
  } else if (mode === 'blend') {
    if (rawSignal === 'BUY' && cal.signal !== 'BUY') signal = 'HOLD';
    if (rawSignal === 'SELL' && cal.signal !== 'SELL') signal = 'HOLD';
    if (rawSignal === 'HOLD') signal = 'HOLD';
  }

  const gate = applyQualityGates({
    ...ctx,
    signal,
    confidence: ens.confidence,
    agreement: ens.agreement,
  });

  let finalSignal = signal;
  if (gate.forcedHold) finalSignal = 'HOLD';

  // Confidence dampening when gates fail or calibration marginal
  let confidence = ens.confidence;
  if (gate.forcedHold) confidence = Math.min(confidence, 0.38);
  if (mode !== 'off' && finalSignal !== 'HOLD') {
    const pEdge = finalSignal === 'BUY' ? cal.pUp : cal.pDown;
    confidence = Math.min(0.95, confidence * (0.55 + 0.45 * pEdge));
  }
  confidence = Math.max(0.12, Math.min(0.95, confidence));

  return {
    signal: finalSignal,
    score: rawScore,
    confidence: Math.round(confidence * 1000) / 1000,
    rawSignal,
    calibration: cal,
    qualityGate: gate,
    highQuality: finalSignal !== 'HOLD' && gate.pass && (finalSignal === cal.signal || mode === 'off'),
    enhancementVersion: 'v12.2.0',
  };
}

/** Direction label from return */
export function directionFromReturn(ret, neutralBand = 0.002) {
  if (!isNum(ret)) return 'neutral';
  if (Math.abs(ret) < neutralBand) return 'neutral';
  return ret > 0 ? 'up' : 'down';
}

/**
 * Multi-metric evaluation for one forecast path vs realized future candles.
 */
export function evaluateForecastMetrics(pred, futureCandles, opts = {}) {
  const entry = pred.priceAtPrediction ?? pred.entryPrice;
  const signal = pred.signal || 'HOLD';
  const horizon = pred.horizonBars || pred.horizonDays || 7;
  const daily = pred.dailyPath || pred.days || [];
  const neutralBand = opts.neutralBand ?? 0.002;

  if (!isNum(entry) || entry <= 0 || !futureCandles?.length) {
    return { ok: false, reason: 'insufficient' };
  }

  const slice = futureCandles.slice(0, Math.max(1, horizon));
  const last = slice[slice.length - 1];
  const actualRet = (last.c - entry) / entry;
  const actualDir = directionFromReturn(actualRet, neutralBand);
  const predDir =
    signal === 'BUY' ? 'up' : signal === 'SELL' ? 'down' : 'neutral';

  const directionCorrect =
    predDir === 'neutral' ? actualDir === 'neutral' : predDir === actualDir;

  // Range coverage: for each day summary with high/low, check if close fell in range
  let rangeHits = 0;
  let rangeN = 0;
  for (const d of daily) {
    if (!isNum(d.high) || !isNum(d.low) || !isNum(d.close)) continue;
    // realized bar for that day index if available
    const bar = slice[Math.min(slice.length - 1, (d.day || 1) - 1)];
    if (!bar) continue;
    rangeN++;
    if (bar.c >= d.low && bar.c <= d.high) rangeHits++;
  }
  const rangeCoverage = rangeN > 0 ? rangeHits / rangeN : null;

  // Point MAE on day-1 and day-7 closes if present
  let maeDay1 = null;
  let maeDayLast = null;
  if (daily[0] && slice[0]) {
    maeDay1 = Math.abs(daily[0].close - slice[0].c) / entry;
  }
  if (daily.length && slice.length) {
    const dLast = daily[daily.length - 1];
    const bLast = slice[Math.min(slice.length - 1, (dLast.day || daily.length) - 1)];
    if (dLast && bLast) maeDayLast = Math.abs(dLast.close - bLast.c) / entry;
  }

  // Simple EV proxy if win/loss from target/stop known
  let realizedEvR = null;
  if (isNum(pred.evR)) realizedEvR = pred.evR;

  return {
    ok: true,
    directionCorrect,
    predDir,
    actualDir,
    actualRetPct: Math.round(actualRet * 10000) / 100,
    rangeCoverage: rangeCoverage != null ? Math.round(rangeCoverage * 1000) / 1000 : null,
    maeDay1: maeDay1 != null ? Math.round(maeDay1 * 10000) / 100 : null,
    maeDayLast: maeDayLast != null ? Math.round(maeDayLast * 10000) / 100 : null,
    highQuality: !!pred.highQuality,
    realizedEvR,
  };
}

/**
 * Aggregate metrics + split all vs high-quality filtered.
 */
export function aggregateAccuracyReport(rows) {
  const all = rows.filter((r) => r && r.ok);
  const hq = all.filter((r) => r.highQuality);
  const dirAcc = (list) => {
    const dir = list.filter((r) => r.predDir !== 'neutral');
    if (!dir.length) return null;
    return Math.round((dir.filter((r) => r.directionCorrect).length / dir.length) * 10000) / 100;
  };
  const avg = (list, key) => {
    const xs = list.map((r) => r[key]).filter(isNum);
    if (!xs.length) return null;
    return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000;
  };

  function pack(list, label) {
    return {
      label,
      n: list.length,
      directionalAccuracy: dirAcc(list),
      rangeCoverageAvg: avg(list, 'rangeCoverage'),
      maeDay1Avg: avg(list, 'maeDay1'),
      maeDayLastAvg: avg(list, 'maeDayLast'),
      avgActualRetPct: avg(list, 'actualRetPct'),
    };
  }

  return {
    version: 'v12.2.0',
    all: pack(all, 'all_signals'),
    highQuality: pack(hq, 'high_quality_filtered'),
    note:
      'دقت فیلترشده فقط روی سیگنال‌های عبورکرده از calibration + quality gates است؛ با دقت کل مقایسه شود.',
  };
}

export function getAccuracyEnhancementConfig() {
  return { ...AE };
}
