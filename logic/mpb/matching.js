/**
 * MPB Pattern Matching + Historical Analogue + Outcome Engine
 * Pure statistical similarity. No ML. Explicit insufficient-evidence handling.
 */
import { isNum } from '../indicators.js';
import { buildFeatures, buildFeatureSequence } from './features.js';

const DEFAULT_WEIGHTS = Object.freeze({
  correlation: 0.30,
  euclidean: 0.20,
  cosine: 0.15,
  structure: 0.15,
  momentum: 0.10,
  volatility: 0.10
});

const HORIZONS = [5, 10, 20];

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    sx += x; sy += y;
    sxx += x * x; syy += y * y; sxy += x * y;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den > 1e-12 ? num / den : 0;
}

function cosineSim(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 1e-12 ? dot / d : 0;
}

function euclideanSim(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - b[i]) ** 2;
  const dist = Math.sqrt(s / n);
  return 1 / (1 + dist); // 0–1
}

/**
 * Lightweight structure similarity from feature objects.
 */
function structureSim(fA, fB) {
  if (!fA || !fB) return 0;
  let score = 0;
  let w = 0;
  const pairs = [
    ['bos', 0.25],
    ['compression', 0.2],
    ['hh', 0.1],
    ['hl', 0.1],
    ['lh', 0.1],
    ['ll', 0.1],
    ['trendStrength', 0.15]
  ];
  for (const [k, wt] of pairs) {
    const a = fA[k], b = fB[k];
    if (isNum(a) && isNum(b)) {
      const diff = Math.abs(a - b);
      const maxAbs = Math.max(Math.abs(a), Math.abs(b), 1e-6);
      score += wt * (1 - Math.min(1, diff / (maxAbs * 2 + 0.5)));
      w += wt;
    }
  }
  return w > 0 ? score / w : 0;
}

function momentumSim(fA, fB) {
  if (!fA || !fB) return 0;
  const keys = ['rsi', 'momentum', 'roc', 'macdHist'];
  let s = 0, n = 0;
  for (const k of keys) {
    if (isNum(fA[k]) && isNum(fB[k])) {
      const d = Math.abs(fA[k] - fB[k]);
      const scale = k === 'rsi' ? 50 : Math.max(Math.abs(fA[k]), Math.abs(fB[k]), 1);
      s += 1 - Math.min(1, d / (scale * 1.5));
      n++;
    }
  }
  return n ? s / n : 0;
}

function volatilitySim(fA, fB) {
  if (!fA || !fB || !isNum(fA.atrPct) || !isNum(fB.atrPct)) return 0;
  const d = Math.abs(fA.atrPct - fB.atrPct);
  return 1 - Math.min(1, d / (Math.max(fA.atrPct, fB.atrPct, 0.5) * 2));
}

/**
 * Combined similarity score.
 */
export function similarity(vecA, vecB, featA, featB, weights = DEFAULT_WEIGHTS) {
  if (!vecA || !vecB) return 0;
  const corr = pearson(vecA, vecB);
  const euc = euclideanSim(vecA, vecB);
  const cos = cosineSim(vecA, vecB);
  const str = structureSim(featA, featB);
  const mom = momentumSim(featA, featB);
  const vol = volatilitySim(featA, featB);

  const s =
    weights.correlation * Math.max(0, corr) +
    weights.euclidean * euc +
    weights.cosine * Math.max(0, cos) +
    weights.structure * str +
    weights.momentum * mom +
    weights.volatility * vol;

  return Math.max(0, Math.min(1, s));
}

/**
 * Compute forward returns / MFE / MAE for a historical index.
 * Strict: only uses future data *relative to that index* (no look-ahead into "now").
 */
function computeOutcome(candles, idx, horizons = HORIZONS) {
  const outcomes = {};
  const entry = candles[idx].c;
  if (!entry || entry <= 0) return outcomes;

  for (const h of horizons) {
    if (idx + h >= candles.length) {
      outcomes[h] = null;
      continue;
    }
    const future = candles.slice(idx + 1, idx + h + 1);
    const exit = future[future.length - 1].c;
    const ret = (exit - entry) / entry;
    let mfe = 0, mae = 0;
    for (const bar of future) {
      mfe = Math.max(mfe, (bar.h - entry) / entry);
      mae = Math.min(mae, (bar.l - entry) / entry);
    }
    outcomes[h] = {
      return: ret,
      mfe,
      mae,
      exitPrice: exit,
      bars: h
    };
  }
  return outcomes;
}

/**
 * Find historical analogues for the current state.
 * Sliding window over past (excluding the most recent bars used for "current").
 *
 * @returns {{ matches: Array, summary: object, status: string }}
 */
export function findHistoricalAnalogues(candles, options = {}) {
  const {
    minSimilarity = 0.55,
    maxMatches = 12,
    lookbackBars = 8,
    minHistory = 80,
    weights = DEFAULT_WEIGHTS
  } = options;

  if (!candles || candles.length < minHistory) {
    return {
      matches: [],
      summary: null,
      status: 'INSUFFICIENT_EVIDENCE',
      reason: `Need at least ${minHistory} bars; have ${candles?.length ?? 0}`
    };
  }

  const currentSlice = candles;
  const { features: curFeat, vector: curVec } = buildFeatures(currentSlice);
  if (!curVec) {
    return { matches: [], summary: null, status: 'INSUFFICIENT_EVIDENCE', reason: 'Cannot build current feature vector' };
  }

  // Search past windows: end index from lookbackBars ... length - maxHorizon - 1
  const maxH = Math.max(...HORIZONS);
  const searchEnd = candles.length - maxH - 2;
  const searchStart = Math.max(lookbackBars + 30, 40);
  if (searchEnd <= searchStart) {
    return {
      matches: [],
      summary: null,
      status: 'INSUFFICIENT_EVIDENCE',
      reason: 'Not enough history after reserving forward windows'
    };
  }

  const candidates = [];
  // step to keep computation light
  const step = candles.length > 200 ? 3 : 2;

  for (let end = searchStart; end <= searchEnd; end += step) {
    const window = candles.slice(0, end + 1);
    const { features: f, vector: v } = buildFeatures(window);
    if (!v) continue;
    const sim = similarity(curVec, v, curFeat, f, weights);
    if (sim >= minSimilarity) {
      const outcomes = computeOutcome(candles, end, HORIZONS);
      candidates.push({
        index: end,
        date: candles[end].t || null,
        similarity: +sim.toFixed(4),
        regimeHint: f.bos > 0 ? 'bullish_bias' : f.bos < 0 ? 'bearish_bias' : 'neutral',
        featuresSnapshot: {
          rsi: f.rsi,
          atrPct: f.atrPct,
          compression: f.compression,
          trendStrength: f.trendStrength,
          bos: f.bos
        },
        outcomes
      });
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  const matches = candidates.slice(0, maxMatches);

  // Aggregate outcomes
  const summary = aggregateOutcomes(matches);

  return {
    matches,
    summary,
    status: matches.length >= 3 ? 'OK' : matches.length > 0 ? 'LOW_SAMPLE' : 'NO_MATCH',
    currentVector: curVec,
    currentFeatures: curFeat,
    searchStats: {
      windowsScanned: Math.floor((searchEnd - searchStart) / step) + 1,
      matchesFound: candidates.length,
      kept: matches.length
    }
  };
}

function aggregateOutcomes(matches) {
  const byH = {};
  for (const h of HORIZONS) {
    const rets = [];
    const mfes = [];
    const maes = [];
    for (const m of matches) {
      const o = m.outcomes?.[h];
      if (o && isNum(o.return)) {
        rets.push(o.return);
        mfes.push(o.mfe);
        maes.push(o.mae);
      }
    }
    if (rets.length < 2) {
      byH[h] = { sampleSize: rets.length, status: 'INSUFFICIENT_EVIDENCE' };
      continue;
    }
    rets.sort((a, b) => a - b);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const median = rets[Math.floor(rets.length / 2)];
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
    const wins = rets.filter(r => r > 0.001).length;
    const losses = rets.filter(r => r < -0.001).length;
    const neutrals = rets.length - wins - losses;
    byH[h] = {
      sampleSize: rets.length,
      status: rets.length >= 5 ? 'OK' : 'LOW_SAMPLE',
      meanReturn: +mean.toFixed(5),
      medianReturn: +median.toFixed(5),
      std: +sd.toFixed(5),
      winRate: +(wins / rets.length).toFixed(3),
      lossRate: +(losses / rets.length).toFixed(3),
      neutralRate: +(neutrals / rets.length).toFixed(3),
      meanMFE: +(mfes.reduce((a, b) => a + b, 0) / mfes.length).toFixed(5),
      meanMAE: +(maes.reduce((a, b) => a + b, 0) / maes.length).toFixed(5),
      p25: +rets[Math.floor(rets.length * 0.25)].toFixed(5),
      p75: +rets[Math.floor(rets.length * 0.75)].toFixed(5)
    };
  }
  return byH;
}

export { HORIZONS, DEFAULT_WEIGHTS };
