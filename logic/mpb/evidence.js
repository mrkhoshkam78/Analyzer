/**
 * MPB Evidence / Contradiction Engine + Confidence breakdown
 * Every claim must have a source. No double counting. No fake precision.
 */
import { isNum } from '../indicators.js';

/**
 * Build evidence list from features + regime + analogues.
 */
export function buildEvidence(features, regime, analogues, dataQuality) {
  const positive = [];
  const contradictions = [];

  if (!features) {
    return {
      positive: [],
      contradictions: [{ id: 'no_features', text: 'Feature vector unavailable', source: 'FeatureEngine', severity: 'high' }],
      strength: 0,
      contradictionPenalty: 0.4
    };
  }

  // Structure
  if (features.hh >= 1 && features.hl >= 1) {
    positive.push({ id: 'hh_hl', text: 'Higher Highs + Higher Lows', source: 'StructureEngine', weight: 0.18 });
  }
  if (features.lh >= 1 && features.ll >= 1) {
    positive.push({ id: 'lh_ll', text: 'Lower Highs + Lower Lows', source: 'StructureEngine', weight: 0.18 });
  }
  if (features.bos === 1) {
    positive.push({ id: 'bos_up', text: 'Break of Structure (upside)', source: 'StructureEngine', weight: 0.2 });
  }
  if (features.bos === -1) {
    positive.push({ id: 'bos_down', text: 'Break of Structure (downside)', source: 'StructureEngine', weight: 0.2 });
  }

  // Momentum
  if (features.rsi > 55 && features.momentum > 0) {
    positive.push({ id: 'mom_up', text: 'Positive momentum + RSI > 55', source: 'Momentum', weight: 0.12 });
  }
  if (features.rsi < 45 && features.momentum < 0) {
    positive.push({ id: 'mom_down', text: 'Negative momentum + RSI < 45', source: 'Momentum', weight: 0.12 });
  }
  if (features.rsi > 72) {
    contradictions.push({ id: 'rsi_overbought', text: 'RSI overbought zone', source: 'Momentum', severity: 'medium' });
  }
  if (features.rsi < 28) {
    contradictions.push({ id: 'rsi_oversold', text: 'RSI oversold zone', source: 'Momentum', severity: 'medium' });
  }

  // Volatility / compression
  if (features.compression < 0.75) {
    positive.push({ id: 'compression', text: 'Volatility compression', source: 'Volatility', weight: 0.14 });
  }
  if (features.compression > 1.4) {
    positive.push({ id: 'expansion', text: 'Volatility expansion', source: 'Volatility', weight: 0.12 });
  }

  // Volume
  if (features.volRatio > 1.25) {
    positive.push({ id: 'vol_expand', text: 'Volume expansion vs average', source: 'Volume', weight: 0.1 });
  }
  if (features.volRatio < 0.6) {
    contradictions.push({ id: 'vol_dry', text: 'Volume drying up', source: 'Volume', severity: 'low' });
  }

  // Extension
  if (Math.abs(features.distEma20) > 0.04) {
    contradictions.push({
      id: 'extension',
      text: `Price extended from EMA20 (${(features.distEma20 * 100).toFixed(1)}%)`,
      source: 'PricePosition',
      severity: 'medium'
    });
  }

  // Regime alignment
  if (regime?.primary === 'BullTrend' || regime?.primary === 'BearTrend') {
    positive.push({
      id: 'regime_clear',
      text: `Clear regime: ${regime.primary}`,
      source: 'RegimeEngine',
      weight: 0.15
    });
  }
  if (regime?.primary === 'Unclear') {
    contradictions.push({ id: 'regime_unclear', text: 'Regime unclear', source: 'RegimeEngine', severity: 'medium' });
  }

  // Analogue support
  if (analogues?.status === 'OK' && analogues.matches?.length >= 5) {
    positive.push({
      id: 'analogue_support',
      text: `${analogues.matches.length} historical analogues (sim ≥ threshold)`,
      source: 'HistoricalAnalogue',
      weight: 0.2
    });
  } else if (analogues?.status === 'LOW_SAMPLE') {
    contradictions.push({
      id: 'low_analogue_sample',
      text: 'Low historical analogue sample size',
      source: 'HistoricalAnalogue',
      severity: 'high'
    });
  } else if (analogues?.status === 'INSUFFICIENT_EVIDENCE' || analogues?.status === 'NO_MATCH') {
    contradictions.push({
      id: 'no_analogue',
      text: analogues?.reason || 'No reliable historical analogues',
      source: 'HistoricalAnalogue',
      severity: 'high'
    });
  }

  // Data quality
  if (dataQuality && dataQuality.score < 70) {
    contradictions.push({
      id: 'data_quality',
      text: `Data quality score ${dataQuality.score}/100`,
      source: 'DataQuality',
      severity: dataQuality.score < 50 ? 'high' : 'medium'
    });
  }

  const strength = Math.min(1, positive.reduce((s, e) => s + (e.weight || 0.1), 0));
  let penalty = 0;
  for (const c of contradictions) {
    if (c.severity === 'high') penalty += 0.12;
    else if (c.severity === 'medium') penalty += 0.07;
    else penalty += 0.03;
  }
  penalty = Math.min(0.55, penalty);

  return {
    positive,
    contradictions,
    strength: +strength.toFixed(3),
    contradictionPenalty: +penalty.toFixed(3)
  };
}

/**
 * Decomposable confidence. Never claims false precision.
 */
export function computeConfidence({
  dataQuality,
  regime,
  analogues,
  evidence,
  patternReliability = null
}) {
  const components = {
    dataQuality: dataQuality ? dataQuality.score / 100 : 0.3,
    regimeAlignment: regime ? regime.confidence : 0.3,
    patternSimilarity: 0,
    historicalReliability: 0,
    evidenceStrength: evidence ? evidence.strength : 0,
    contradictionPenalty: evidence ? evidence.contradictionPenalty : 0.2,
    sampleAdequacy: 0
  };

  if (analogues?.matches?.length) {
    const topSims = analogues.matches.slice(0, 5).map(m => m.similarity);
    components.patternSimilarity = topSims.reduce((a, b) => a + b, 0) / topSims.length;
    const n = analogues.matches.length;
    components.sampleAdequacy = Math.min(1, n / 10);
    // crude reliability from win-rate consistency if available
    const h5 = analogues.summary?.['5'];
    if (h5 && h5.status !== 'INSUFFICIENT_EVIDENCE') {
      const edge = Math.abs(h5.winRate - 0.5);
      components.historicalReliability = Math.min(1, 0.4 + edge * 1.2 + (h5.sampleSize >= 8 ? 0.15 : 0));
    } else {
      components.historicalReliability = 0.25;
    }
  }

  if (patternReliability != null) {
    components.historicalReliability = 0.6 * components.historicalReliability + 0.4 * patternReliability;
  }

  // Weighted combination
  const raw =
    0.18 * components.dataQuality +
    0.14 * components.regimeAlignment +
    0.22 * components.patternSimilarity +
    0.18 * components.historicalReliability +
    0.16 * components.evidenceStrength +
    0.12 * components.sampleAdequacy -
    components.contradictionPenalty;

  const overall = Math.max(0.05, Math.min(0.92, raw));

  // Round to avoid fake precision
  const round = (x) => Math.round(x * 100);

  return {
    overall: round(overall),
    components: {
      dataQuality: round(components.dataQuality),
      regimeAlignment: round(components.regimeAlignment),
      patternSimilarity: round(components.patternSimilarity),
      historicalReliability: round(components.historicalReliability),
      evidenceStrength: round(components.evidenceStrength),
      sampleAdequacy: round(components.sampleAdequacy),
      contradictionPenalty: round(components.contradictionPenalty)
    },
    label:
      overall >= 0.7 ? 'High' :
      overall >= 0.5 ? 'Moderate' :
      overall >= 0.35 ? 'Low' : 'Very Low',
    note: analogues?.status === 'INSUFFICIENT_EVIDENCE'
      ? 'INSUFFICIENT_EVIDENCE'
      : null
  };
}
