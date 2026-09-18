/**
 * Prediction store + evaluation against later market prices.
 * Uses High/Low path when candles provided; conservative both-hit rule.
 */
import { CONFIG } from './config.js';
import { loadPredictions, savePredictions } from './storage.js';
import { recordEvaluation } from './learning.js';

function uid() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Persist a new prediction from decision output.
 */
export function createPrediction(decision, meta = {}) {
  if (!decision || !decision.ok) return null;
  const pred = decision.prediction;
  const now = Date.now();
  const horizonBars = pred.horizonBars || CONFIG.defaultHorizonBars;
  const record = {
    id: uid(),
    symbol: decision.data.symbol,
    createdAt: now,
    priceAtPrediction: decision.data.price,
    horizonBars,
    direction: pred.direction,
    signal: decision.signal,
    target: pred.target,
    stop: pred.stop,
    confidence: pred.confidence,
    technicalScore: decision.analysis.technicalScore,
    fundamentalScore: decision.analysis.fundamentalScore,
    combinedScore: decision.analysis.combinedScore,
    riskScore: decision.analysis.riskScore,
    regime: decision.analysis.regime || pred.regime || null,
    strategies: (decision.analysis.strategies || []).map(s => ({
      id: s.id, signal: s.signal, score: s.score, confidence: s.confidence
    })),
    factors: (decision.analysis.factors || []).slice(0, 8),
    algoVersion: pred.algoVersion,
    evaluation: null,
    meta: {
      timeframe: meta.timeframe || null,
      candleCount: decision.data.candleCount
    }
  };
  const list = loadPredictions();
  list.push(record);
  while (list.length > 200) list.shift();
  savePredictions(list);
  return record;
}

/**
 * Evaluate prediction when a later price (or candle path) is known.
 * If futureCandles provided: use High/Low for target/stop hits.
 * Conservative: if both Target and Stop touched in same bar → Stop wins.
 */
export function evaluatePrediction(predictionId, actualPrice, futureCandles = null) {
  const list = loadPredictions();
  const idx = list.findIndex(p => p.id === predictionId);
  if (idx < 0) return { ok: false, error: 'پیش‌بینی یافت نشد.' };
  const p = list[idx];
  if (p.evaluation) return { ok: false, error: 'این پیش‌بینی قبلاً ارزیابی شده است.', prediction: p };

  if (!Number.isFinite(p.priceAtPrediction) || p.priceAtPrediction <= 0) {
    p.evaluation = {
      outcome: 'insufficient',
      actualPrice,
      evaluatedAt: Date.now(),
      errorPct: null,
      note: 'قیمت زمان پیش‌بینی نامعتبر بود.'
    };
    list[idx] = p;
    savePredictions(list);
    recordEvaluation(p.symbol, 'insufficient');
    return { ok: true, prediction: p };
  }

  let outcome = 'neutral';
  let returnPct = null;
  let errorPct = null;
  let targetHit = false;
  let stopHit = false;
  let pathOutcome = null;
  let mfe = null;
  let mae = null;

  if (futureCandles && Array.isArray(futureCandles) && futureCandles.length > 0) {
    const entry = p.priceAtPrediction;
    const isBuy = p.direction === 'up' || p.signal === 'BUY';
    const isSell = p.direction === 'down' || p.signal === 'SELL';
    let mfeV = 0, maeV = 0;
    let hitT = false, hitS = false, bothSame = false;

    for (const bar of futureCandles) {
      const hi = Number.isFinite(bar.h) ? bar.h : bar.c;
      const lo = Number.isFinite(bar.l) ? bar.l : bar.c;

      if (isBuy) {
        const fav = (hi - entry) / entry;
        const adv = (lo - entry) / entry;
        if (fav > mfeV) mfeV = fav;
        if (adv < maeV) maeV = adv;
        const t = p.target != null && hi >= p.target;
        const s = p.stop != null && lo <= p.stop;
        if (t && s) { bothSame = true; hitS = true; break; }
        if (s) { hitS = true; break; }
        if (t) { hitT = true; break; }
      } else if (isSell) {
        const fav = (entry - lo) / entry;
        const adv = (entry - hi) / entry;
        if (fav > mfeV) mfeV = fav;
        if (adv < maeV) maeV = adv;
        const t = p.target != null && lo <= p.target;
        const s = p.stop != null && hi >= p.stop;
        if (t && s) { bothSame = true; hitS = true; break; }
        if (s) { hitS = true; break; }
        if (t) { hitT = true; break; }
      } else {
        const up = (hi - entry) / entry;
        const dn = (lo - entry) / entry;
        if (up > mfeV) mfeV = up;
        if (dn < maeV) maeV = dn;
      }
    }

    targetHit = hitT;
    stopHit = hitS;
    mfe = Math.round(mfeV * 10000) / 100;
    mae = Math.round(maeV * 10000) / 100;

    if (hitT && !hitS) pathOutcome = 'target';
    else if (hitS) pathOutcome = bothSame ? 'both_stop_first' : 'stop';
    else pathOutcome = 'neither';

    const lastClose = futureCandles[futureCandles.length - 1].c;
    const ret = (lastClose - entry) / entry;
    returnPct = ret * 100;
    errorPct = Math.abs(ret) * 100;

    if (pathOutcome === 'target') outcome = 'correct';
    else if (pathOutcome === 'stop' || pathOutcome === 'both_stop_first') outcome = 'wrong';
    else {
      // neither: use direction vs close
      const threshold = 0.002;
      if (Math.abs(ret) < threshold) outcome = 'neutral';
      else if (isBuy) outcome = ret > 0 ? 'correct' : 'wrong';
      else if (isSell) outcome = ret < 0 ? 'correct' : 'wrong';
      else outcome = 'neutral';
    }
  } else {
    // Fallback: single price evaluation
    if (actualPrice == null || !Number.isFinite(actualPrice) || actualPrice <= 0) {
      return { ok: false, error: 'قیمت واقعی نامعتبر است.' };
    }
    const ret = (actualPrice - p.priceAtPrediction) / p.priceAtPrediction;
    returnPct = ret * 100;
    errorPct = Math.abs(ret) * 100;
    const threshold = 0.002;

    if (Math.abs(ret) < threshold) {
      outcome = 'neutral';
    } else if (p.direction === 'up') {
      outcome = ret > 0 ? 'correct' : 'wrong';
    } else if (p.direction === 'down') {
      outcome = ret < 0 ? 'correct' : 'wrong';
    } else {
      outcome = 'neutral';
    }
  }

  p.evaluation = {
    outcome,
    actualPrice: actualPrice ?? (futureCandles ? futureCandles[futureCandles.length - 1].c : null),
    evaluatedAt: Date.now(),
    returnPct,
    errorPct,
    targetHit,
    stopHit,
    pathOutcome,
    mfe,
    mae,
    note: null
  };
  list[idx] = p;
  savePredictions(list);
  recordEvaluation(p.symbol, outcome);
  return { ok: true, prediction: p };
}

export function listPredictions(symbol) {
  const list = loadPredictions();
  if (!symbol) return list;
  return list.filter(p => p.symbol === symbol);
}

export function getUnevaluated(symbol) {
  return listPredictions(symbol).filter(p => !p.evaluation);
}
