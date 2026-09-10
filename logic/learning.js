/**
 * Learning Memory — adjusts confidence from past prediction accuracy.
 * Does NOT rewrite core indicator formulas.
 * Requires minSamples before any adjustment.
 */
import { CONFIG } from './config.js';
import { loadLearningMetrics, saveLearningMetrics, loadPredictions } from './storage.js';

/**
 * Update metrics after a prediction is evaluated.
 */
export function recordEvaluation(symbol, outcome) {
  // outcome: 'correct' | 'wrong' | 'neutral' | 'insufficient'
  const m = loadLearningMetrics();
  if (!m.global) {
    m.global = { total: 0, correct: 0, wrong: 0, neutral: 0, insufficient: 0 };
  }
  if (!m.bySymbol) m.bySymbol = {};
  if (!m.bySymbol[symbol]) {
    m.bySymbol[symbol] = { total: 0, correct: 0, wrong: 0, neutral: 0, insufficient: 0 };
  }
  const g = m.global;
  const s = m.bySymbol[symbol];
  g.total++; s.total++;
  if (outcome === 'correct') { g.correct++; s.correct++; }
  else if (outcome === 'wrong') { g.wrong++; s.wrong++; }
  else if (outcome === 'neutral') { g.neutral++; s.neutral++; }
  else { g.insufficient++; s.insufficient++; }
  saveLearningMetrics(m);
  return m;
}

/**
 * Accuracy rate for symbol (only correct+wrong count as decisive).
 */
export function getAccuracy(symbol) {
  const m = loadLearningMetrics();
  const s = (m.bySymbol && m.bySymbol[symbol]) || { correct: 0, wrong: 0, total: 0 };
  const decisive = s.correct + s.wrong;
  if (decisive < CONFIG.minSamplesForLearning) {
    return { ready: false, rate: null, samples: decisive, total: s.total };
  }
  return {
    ready: true,
    rate: s.correct / decisive,
    samples: decisive,
    total: s.total,
    correct: s.correct,
    wrong: s.wrong
  };
}

/**
 * Multiplier for confidence based on historical accuracy.
 * Clamp to avoid extreme overfit.
 */
export function getLearningAdjustment(symbol) {
  const acc = getAccuracy(symbol);
  if (!acc.ready) {
    return {
      multiplier: 1,
      note: `یادگیری هنوز فعال نیست (نمونه قطعی: ${acc.samples}/${CONFIG.minSamplesForLearning}).`
    };
  }
  // rate 0.5 → 1.0, rate 1 → max, rate 0 → min
  const raw = 1 + (acc.rate - 0.5) * 2 * CONFIG.learningStrength;
  const mult = Math.max(
    CONFIG.confidenceClamp.min,
    Math.min(CONFIG.confidenceClamp.max, raw)
  );
  return {
    multiplier: mult,
    note: `بر اساس ${acc.samples} پیش‌بینی ارزیابی‌شده، نرخ صحت ${(acc.rate * 100).toFixed(0)}٪؛ ضریب اطمینان ${mult.toFixed(2)}.`
  };
}

/**
 * Summarize recent pattern failures (same direction wrong repeatedly).
 * Used only as informational factor — does not change indicator math.
 */
export function recentDirectionBias(symbol, limit = 10) {
  const preds = loadPredictions().filter(p => p.symbol === symbol && p.evaluation);
  const recent = preds.slice(-limit);
  let upWrong = 0, downWrong = 0, upOk = 0, downOk = 0;
  for (const p of recent) {
    if (p.direction === 'up' && p.evaluation.outcome === 'wrong') upWrong++;
    if (p.direction === 'down' && p.evaluation.outcome === 'wrong') downWrong++;
    if (p.direction === 'up' && p.evaluation.outcome === 'correct') upOk++;
    if (p.direction === 'down' && p.evaluation.outcome === 'correct') downOk++;
  }
  return { upWrong, downWrong, upOk, downOk, samples: recent.length };
}
