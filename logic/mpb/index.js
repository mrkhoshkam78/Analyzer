/**
 * MPB v2.0 — Adaptive Market Pattern Brain
 * Mathematical + Statistical + Adaptive + Explainable Pattern Intelligence Engine
 *
 * Core pipeline (no external LLM / heavy ML):
 * DataQuality → Features → MarketState → Regime → Structure →
 * PatternMatching → HistoricalAnalogues → Outcomes →
 * Evidence/Contradiction → Confidence → Scenarios → Intelligence Output
 */
import { assessDataQuality } from './dataQuality.js';
import { buildFeatures } from './features.js';
import { detectMPBRegime } from './regime.js';
import { findHistoricalAnalogues, HORIZONS } from './matching.js';
import { buildEvidence, computeConfidence } from './evidence.js';
import { isNum } from '../indicators.js';

/**
 * Derive simple active pattern label from features + regime.
 * This is a transparent rule-based discovery seed (not a black-box classifier).
 */
function deriveActivePattern(features, regime) {
  if (!features) return { id: 'UNKNOWN', label: 'Unknown', dna: null };

  const parts = [];
  if (features.compression < 0.75) parts.push('Compression');
  else if (features.compression > 1.35) parts.push('Expansion');

  if (features.bos === 1) parts.push('BreakoutUp');
  else if (features.bos === -1) parts.push('BreakoutDown');

  if (features.hh >= 1 && features.hl >= 1) parts.push('HH_HL');
  else if (features.lh >= 1 && features.ll >= 1) parts.push('LH_LL');

  if (regime?.primary === 'BullTrend') parts.push('BullContext');
  else if (regime?.primary === 'BearTrend') parts.push('BearContext');
  else if (regime?.primary === 'Sideways') parts.push('RangeContext');

  if (features.rsi > 60 && features.momentum > 0) parts.push('MomentumUp');
  else if (features.rsi < 40 && features.momentum < 0) parts.push('MomentumDown');

  const id = parts.length ? parts.join('→') : 'NeutralState';
  const label = parts.length ? parts.join(' → ') : 'Neutral / Mixed State';

  const dna = {
    patternId: id,
    regime: regime?.primary || 'Unclear',
    structure: {
      hh: features.hh,
      hl: features.hl,
      lh: features.lh,
      ll: features.ll,
      bos: features.bos,
      choch: features.choch
    },
    momentum: {
      rsi: +features.rsi.toFixed?.(1) || features.rsi,
      mom: features.momentum,
      roc: features.roc
    },
    volatility: {
      atrPct: features.atrPct,
      compression: +features.compression.toFixed?.(3) || features.compression
    },
    volume: { volRatio: features.volRatio },
    pricePosition: {
      distEma20: features.distEma20,
      distEma50: features.distEma50,
      bbPos: features.bbPos
    }
  };

  return { id, label, dna };
}

/**
 * Build scenario set from analogue outcomes + current evidence.
 */
function buildScenarios(analogues, features, regime) {
  const scenarios = [];
  const h = analogues?.summary?.['5'] || analogues?.summary?.['10'];

  if (!h || h.status === 'INSUFFICIENT_EVIDENCE') {
    return [{
      id: 'insufficient',
      name: 'Insufficient Evidence',
      probabilityHint: null,
      trigger: 'N/A',
      expectedRange: null,
      mfe: null,
      mae: null,
      supporting: [],
      contradictions: ['Historical sample too small or unavailable'],
      note: 'INSUFFICIENT_EVIDENCE'
    }];
  }

  const bullP = h.winRate;
  const bearP = h.lossRate;
  const neutP = h.neutralRate;

  scenarios.push({
    id: 'bullish',
    name: 'Bullish Continuation / Upside',
    probabilityHint: bullP,
    trigger: features?.bos === 1 || (features?.hh >= 1 && features?.hl >= 1)
      ? 'Structure already supportive'
      : 'Break above recent swing high',
    expectedRange: { median: h.medianReturn, p25: h.p25, p75: h.p75 },
    mfe: h.meanMFE,
    mae: h.meanMAE,
    supporting: ['Historical win-rate on analogues', regime?.primary === 'BullTrend' ? 'Bull regime' : null].filter(Boolean),
    contradictions: regime?.primary === 'BearTrend' ? ['Primary regime is Bear'] : []
  });

  scenarios.push({
    id: 'bearish',
    name: 'Bearish / Downside',
    probabilityHint: bearP,
    trigger: features?.bos === -1 ? 'Structure already broken down' : 'Break below recent swing low',
    expectedRange: { median: -Math.abs(h.medianReturn), p25: h.p25, p75: h.p75 },
    mfe: Math.abs(h.meanMAE),
    mae: -Math.abs(h.meanMFE),
    supporting: ['Historical loss-rate on analogues'],
    contradictions: regime?.primary === 'BullTrend' ? ['Primary regime is Bull'] : []
  });

  scenarios.push({
    id: 'neutral',
    name: 'Range / Neutral',
    probabilityHint: neutP,
    trigger: 'Price remains inside recent balance area',
    expectedRange: { median: 0, p25: h.p25, p75: h.p75 },
    mfe: h.meanMFE * 0.4,
    mae: h.meanMAE * 0.4,
    supporting: ['Historical neutral rate'],
    contradictions: []
  });

  return scenarios;
}

/**
 * Simple meta-pattern / sequence hint (rule-based, transparent).
 */
function detectMetaPattern(features, regime) {
  const seq = [];
  if (features.compression < 0.75) seq.push('Compression');
  if (features.volRatio > 1.15) seq.push('VolumeExpansion');
  if (features.bos === 1) seq.push('BreakoutUp');
  else if (features.bos === -1) seq.push('BreakoutDown');
  if (features.hh >= 1 && features.hl >= 1 && features.bos === 1) seq.push('Continuation');
  if (features.choch) seq.push('ChangeOfCharacter');

  if (seq.length < 2) {
    return {
      sequence: seq,
      label: seq[0] || 'No clear sequence',
      transitionNote: 'Insufficient sequential structure for meta-pattern',
      status: seq.length ? 'PARTIAL' : 'NONE'
    };
  }
  return {
    sequence: seq,
    label: seq.join(' → '),
    transitionNote: 'Observed sequential structure in current window (rule-based)',
    status: 'DETECTED'
  };
}

/**
 * Main entry: run full MPB analysis on candles.
 * @param {Array} candles - OHLCV sorted ascending
 * @param {object} options - { symbol, timeframe, existingRegime }
 * @returns {object} full machine-readable + explainable intelligence payload
 */
export function runMPB(candles, options = {}) {
  const { symbol = 'UNKNOWN', timeframe = '1D', existingRegime = null } = options;

  // 1. Data Quality
  const dataQuality = assessDataQuality(candles);

  if (!dataQuality.ok) {
    return {
      version: 'MPB-2.0.0',
      symbol,
      timeframe,
      timestamp: new Date().toISOString(),
      status: 'INSUFFICIENT_EVIDENCE',
      reason: 'Data quality below threshold or invalid OHLC',
      dataQuality,
      marketState: null,
      regime: null,
      activePatterns: [],
      metaPatterns: null,
      historicalMatches: [],
      outcomes: null,
      evidence: { positive: [], contradictions: [{ text: 'Data quality failed', source: 'DataQuality' }] },
      contradictions: [],
      scenarios: [],
      confidence: { overall: 0, label: 'Very Low', note: 'INSUFFICIENT_EVIDENCE' },
      validation: { walkForward: 'NOT_RUN', reason: 'Insufficient clean data' },
      patternMemory: { status: 'EMPTY' },
      reasoningTrace: [
        'WHY: Data quality check failed.',
        `Issues: ${(dataQuality.issues || []).join(', ')}`,
        'ACTION: No pattern matching performed. INSUFFICIENT_EVIDENCE.'
      ]
    };
  }

  // 2. Features + Market State
  const { features, vector, labels, qualityNote } = buildFeatures(candles);
  if (!features || qualityNote) {
    return {
      version: 'MPB-2.0.0',
      symbol,
      timeframe,
      status: 'INSUFFICIENT_EVIDENCE',
      reason: qualityNote || 'Feature extraction failed',
      dataQuality,
      confidence: { overall: 0, label: 'Very Low', note: 'INSUFFICIENT_EVIDENCE' },
      reasoningTrace: ['Feature engine could not build a valid state vector.']
    };
  }

  const marketState = {
    trend: features.trendStrength > 0.005 ? 'Up' : features.trendStrength < -0.005 ? 'Down' : 'Flat',
    momentum: features.momentum > 0 ? 'Positive' : features.momentum < 0 ? 'Negative' : 'Flat',
    volatility: features.atrPct > 2 ? 'High' : features.atrPct < 0.9 ? 'Low' : 'Normal',
    volume: features.volRatio > 1.2 ? 'Expanding' : features.volRatio < 0.7 ? 'Contracting' : 'Normal',
    structure: features.bos === 1 ? 'BullishBOS' : features.bos === -1 ? 'BearishBOS' : 'Intact',
    pricePosition: features.bbPos,
    dataQuality: dataQuality.score,
    vectorDim: vector?.length || 0
  };

  // 3. Regime
  const regime = detectMPBRegime(candles, features);

  // 4. Active Pattern (rule-based DNA)
  const active = deriveActivePattern(features, regime);

  // 5. Historical Analogues (core matching)
  const analogues = findHistoricalAnalogues(candles, {
    minSimilarity: dataQuality.usableForMatching ? 0.52 : 0.58,
    maxMatches: 10,
    minHistory: dataQuality.usableForMatching ? 80 : 50
  });

  // 6. Evidence
  const evidence = buildEvidence(features, regime, analogues, dataQuality);

  // 7. Confidence
  const confidence = computeConfidence({
    dataQuality,
    regime,
    analogues,
    evidence
  });

  // 8. Meta-pattern
  const meta = detectMetaPattern(features, regime);

  // 9. Scenarios
  const scenarios = buildScenarios(analogues, features, regime);

  // 10. Reasoning trace (explainability)
  const reasoningTrace = [
    `WHY THIS PATTERN? Derived from structure (BOS=${features.bos}), compression=${features.compression?.toFixed?.(2)}, regime=${regime.primary}.`,
    `WHY NOW? Latest bar features + regime alignment (conf=${(regime.confidence * 100).toFixed(0)}%).`,
    analogues.status === 'OK'
      ? `HISTORICAL SUPPORT: ${analogues.matches.length} analogues, top similarity=${analogues.matches[0]?.similarity}.`
      : `HISTORICAL SUPPORT: ${analogues.status} — ${analogues.reason || 'limited matches'}.`,
    evidence.contradictions.length
      ? `CONTRADICTIONS: ${evidence.contradictions.map(c => c.text).join('; ')}.`
      : 'CONTRADICTIONS: none material.',
    analogues.summary?.['5']?.status === 'OK'
      ? `AFTER SIMILAR CASES (5-bar): win=${(analogues.summary['5'].winRate * 100).toFixed(0)}%, medianRet=${(analogues.summary['5'].medianReturn * 100).toFixed(2)}%.`
      : 'AFTER SIMILAR CASES: insufficient sample for stable outcome stats.',
    `OUT-OF-SAMPLE / WALK-FORWARD: Not fully executed in this pass (short history or reserved for batch validation). Status flagged honestly.`,
    confidence.note === 'INSUFFICIENT_EVIDENCE'
      ? 'INVALIDATION: Any conclusion is weak until more clean history is available.'
      : `INVALIDATION: Loss of structure (opposite BOS), regime flip, or data-quality drop below 50.`
  ];

  // Walk-forward placeholder (honest)
  const validation = {
    walkForward: analogues.status === 'OK' && (analogues.matches?.length || 0) >= 5
      ? 'PARTIAL_PROXY'
      : 'NOT_RUN',
    note: 'Full expanding-window walk-forward requires longer history than current bundle. Analogue outcomes are computed only on past windows (no future leakage into current bar).',
    inSampleHint: analogues.searchStats || null
  };

  return {
    version: 'MPB-2.0.0',
    symbol,
    timeframe,
    timestamp: new Date().toISOString(),
    status: confidence.note === 'INSUFFICIENT_EVIDENCE' ? 'INSUFFICIENT_EVIDENCE' : 'OK',
    dataQuality,
    marketState,
    regime: {
      primary: regime.primary,
      secondary: regime.secondary,
      confidence: +regime.confidence.toFixed(3),
      details: regime.details
    },
    activePatterns: [
      {
        id: active.id,
        label: active.label,
        similarity: analogues.matches?.[0]?.similarity ?? null,
        dna: active.dna,
        status: 'ACTIVE'
      }
    ],
    metaPatterns: meta,
    historicalMatches: (analogues.matches || []).slice(0, 8).map(m => ({
      date: m.date,
      index: m.index,
      similarity: m.similarity,
      regimeHint: m.regimeHint,
      outcomes: m.outcomes
    })),
    outcomes: analogues.summary,
    evidence: evidence.positive,
    contradictions: evidence.contradictions,
    scenarios,
    confidence,
    validation,
    patternMemory: {
      status: 'SESSION',
      note: 'Persistent Pattern Library requires longer multi-session history; current run is session-scoped.',
      activeCount: 1
    },
    featureLabels: labels,
    reasoningTrace,
    horizons: HORIZONS
  };
}

export { assessDataQuality, buildFeatures, detectMPBRegime, findHistoricalAnalogues };
