/**
 * Prediction store + evaluation against later market prices.
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
  // Evaluation time estimate: horizonBars * assumed bar duration (user TF unknown → store bars only)
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
  // Keep last 200
  while (list.length > 200) list.shift();
  savePredictions(list);
  return record;
}

/**
 * Evaluate prediction when a later price is known.
 * Rules:
 * - up + price moved up by >= 0.3% of range or toward target → correct
 * - strict: direction vs actual return sign
 * - if |return| < threshold → neutral
 */
export function evaluatePrediction(predictionId, actualPrice) {
  const list = loadPredictions();
  const idx = list.findIndex(p => p.id === predictionId);
  if (idx < 0) return { ok: false, error: 'پیش‌بینی یافت نشد.' };
  const p = list[idx];
  if (p.evaluation) return { ok: false, error: 'این پیش‌بینی قبلاً ارزیابی شده است.', prediction: p };

  if (actualPrice == null || !Number.isFinite(actualPrice) || actualPrice <= 0) {
    return { ok: false, error: 'قیمت واقعی نامعتبر است.' };
  }
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

  const ret = (actualPrice - p.priceAtPrediction) / p.priceAtPrediction;
  const errorPct = Math.abs(ret) * 100;
  const threshold = 0.002; // 0.2% dead zone → neutral

  let outcome = 'neutral';
  if (Math.abs(ret) < threshold) {
    outcome = 'neutral';
  } else if (p.direction === 'up') {
    outcome = ret > 0 ? 'correct' : 'wrong';
  } else if (p.direction === 'down') {
    outcome = ret < 0 ? 'correct' : 'wrong';
  } else {
    // neutral prediction: correct if stayed within threshold band (already handled), else wrong-ish → neutral
    outcome = 'neutral';
  }

  p.evaluation = {
    outcome,
    actualPrice,
    evaluatedAt: Date.now(),
    returnPct: ret * 100,
    errorPct,
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
