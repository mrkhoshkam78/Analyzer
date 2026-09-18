/**
 * Decision Engine V7.0.1
 * Pipeline: Context → Regime → Strategies → MTF → Reliability → Ensemble → Risk → Entry → Target/Stop → Confidence
 */
import { CONFIG } from './config.js';
import { runTechnical } from './technical.js';
import { runFundamental } from './fundamental.js';
import { getLearningAdjustment, getAccuracy } from './learning.js';
import { detectRegime } from './regime.js';
import { runAllStrategies, computeTargetStop } from './strategies.js';
import { buildMarketContext } from './context.js';
import { getCalendarAsOf } from './calendar.js';
import { runMultiTimeframe } from './mtf.js';
import { computeEntry } from './entry.js';

function buildSuggestion(signal, riskLevel, tech, confidence, regime, entry) {
  const highRisk = riskLevel === 'High';
  const ind = tech.indicators || {};
  const nearRes = ind.resistance != null && ind.price > 0 &&
    (ind.resistance - ind.price) / ind.price < 0.02;
  const nearSup = ind.support != null && ind.price > 0 &&
    (ind.price - ind.support) / ind.price < 0.04;

  if (entry && entry.waitForEntry) {
    return entry.reason || 'منتظر نقطه ورود مناسب بمانید.';
  }
  if (signal === 'BUY') {
    if (highRisk) return 'سیگنال خرید با ریسک بالاست. حجم را محدود و حد ضرر را رعایت کنید.';
    if (nearRes) return 'روند صعودی است اما قیمت نزدیک مقاومت است. صبر تا شکست مقاومت منطقی‌تر است.';
    if (confidence < 0.45) return 'خرید با اطمینان پایین؛ تأیید بیشتری لازم است.';
    if (regime === 'Range') return 'رژیم رنج فعال است؛ خرید ترجیحاً روی حمایت یا شکست مقاومت.';
    return 'شرایط از خرید حمایت می‌کند. ورود با مدیریت ریسک پیشنهاد می‌شود.';
  }
  if (signal === 'SELL') {
    if (highRisk) return 'سیگنال فروش همراه ریسک بالاست.';
    if (nearSup) return 'فشار نزولی دیده می‌شود؛ نزدیک حمایت عجله نکنید.';
    if (confidence < 0.45) return 'فروش با اطمینان پایین؛ منتظر تأیید بیشتر.';
    return 'شواهد به نفع فروش یا کاهش موقعیت خرید است.';
  }
  if (highRisk) return 'بازار نامشخص و پرنوسان است. فعلاً صبر کنید.';
  if (regime === 'Unclear') return 'رژیم بازار نامشخص است؛ HOLD ترجیح داده می‌شود.';
  if (nearSup || nearRes) return 'سیگنال خنثی و قیمت نزدیک سطح کلیدی است.';
  return 'شرایط برای تصمیم قطعی کافی نیست. صبر منطقی است.';
}

function ensembleStrategies(strategies, regimeInfo, riskScore, learningMult, context, mtf) {
  const regimeWeights = regimeInfo.weights || {};
  const active = strategies.filter(s => s.active !== false);
  if (!active.length) {
    return { signal: 'HOLD', score: 50, confidence: 0.25, agreement: 0, supporting: [], conflicting: [], weightedScore: 50, agreementLabel: 'None' };
  }

  const histRel = Math.max(0.5, Math.min(1.2, learningMult));
  const eventRisk = context?.event?.eventRisk ?? 0.3;
  const sessionLiq = context?.session?.liquidity || 'normal';
  const mtfAgree = mtf?.agreement ?? 0.5;
  const mtfConflict = mtf?.htfLtfConflict === true;

  // Session relevance: neutral unless backtest stats exist (data-driven placeholder = 1.0)
  const sessionMult = 1.0;

  let sumW = 0, sumScore = 0;
  const votes = { BUY: 0, SELL: 0, HOLD: 0 };
  const weightedVotes = { BUY: 0, SELL: 0, HOLD: 0 };

  for (const s of active) {
    let rw = regimeWeights[s.id] != null ? regimeWeights[s.id] : 1;
    // Event risk dampens directional strategies more than mean-reversion in reaction
    if (eventRisk >= 0.55 && (s.id === 'breakout' || s.id === 'momentum')) rw *= (1 - eventRisk * 0.35);
    if (mtfConflict && (s.id === 'trendFollowing' || s.id === 'momentum')) rw *= 0.75;
    const w = rw * (s.confidence || 0.4) * (s.dataQuality || 0.5) * histRel * sessionMult;
    sumW += w;
    sumScore += s.score * w;
    votes[s.signal] = (votes[s.signal] || 0) + 1;
    weightedVotes[s.signal] = (weightedVotes[s.signal] || 0) + w;
  }

  const weightedScore = sumW > 0 ? sumScore / sumW : 50;
  let finalScore = Math.round(Math.max(0, Math.min(100, weightedScore)));

  const totalActive = active.length;
  const maxVote = Math.max(votes.BUY, votes.SELL, votes.HOLD);
  const agreement = totalActive > 0 ? maxVote / totalActive : 0;

  let agreementLabel = 'Mixed';
  if (agreement >= 0.8) agreementLabel = 'Strong Agreement';
  else if (agreement >= 0.55) agreementLabel = 'Moderate Agreement';
  else if (votes.BUY > 0 && votes.SELL > 0) agreementLabel = 'Strong Conflict';
  else agreementLabel = 'Mixed';

  // Risk + event pull toward 50
  const riskNorm = riskScore / 100;
  if (riskNorm >= 0.65 || eventRisk >= 0.55) {
    const pull = Math.max(riskNorm - 0.55, eventRisk - 0.45, 0) * 1.2;
    finalScore = Math.round(finalScore * (1 - pull) + 50 * pull);
    finalScore = Math.max(0, Math.min(100, finalScore));
  }

  // MTF alignment nudge
  if (mtf?.ok && mtf.alignment === 'bullish') finalScore = Math.min(100, finalScore + Math.round(3 * mtfAgree));
  if (mtf?.ok && mtf.alignment === 'bearish') finalScore = Math.max(0, finalScore - Math.round(3 * mtfAgree));
  if (mtfConflict) finalScore = Math.round(finalScore * 0.85 + 50 * 0.15);

  let signal = 'HOLD';
  // Raise HOLD threshold under conflict / unclear / high event risk
  let buyTh = CONFIG.buyThreshold;
  let sellTh = CONFIG.sellThreshold;
  if (agreementLabel === 'Strong Conflict' || regimeInfo.regime === 'Unclear' || eventRisk >= 0.6) {
    buyTh += 5;
    sellTh -= 5;
  }
  if (finalScore >= buyTh) signal = 'BUY';
  else if (finalScore <= sellTh) signal = 'SELL';

  if (
    (regimeInfo.regime === 'Unclear' && Math.abs(finalScore - 50) < 12) ||
    (agreementLabel === 'Strong Conflict' && Math.abs(finalScore - 50) < 10) ||
    (eventRisk >= 0.7 && Math.abs(finalScore - 50) < 15)
  ) {
    signal = 'HOLD';
  }

  const avgDQ = active.reduce((a, s) => a + (s.dataQuality || 0.4), 0) / totalActive;
  const signalStrength = Math.abs(finalScore - 50) / 50;
  const regimeConf = regimeInfo.confidence || 0.4;
  const ctxDQ = context?.dataQuality?.score ?? avgDQ;

  let confidence =
    0.18 * agreement +
    0.15 * regimeConf +
    0.15 * ctxDQ +
    0.18 * signalStrength +
    0.12 * (1 - riskNorm) +
    0.12 * (1 - eventRisk) +
    0.10 * (mtf?.ok ? mtfAgree : 0.4);
  confidence *= learningMult;
  if (signal !== 'HOLD' && agreement < 0.4) confidence *= 0.75;
  if (sessionLiq === 'low') confidence *= 0.92;
  confidence = Math.max(0.12, Math.min(0.95, confidence));

  const supporting = active.filter(s => s.signal === signal)
    .map(s => ({ id: s.id, name: s.name, score: s.score, conf: s.confidence }));
  const conflicting = active.filter(s => s.signal !== signal && s.signal !== 'HOLD')
    .map(s => ({ id: s.id, name: s.name, score: s.score, conf: s.confidence }));

  return {
    signal,
    score: finalScore,
    confidence: Math.round(confidence * 1000) / 1000,
    agreement: Math.round(agreement * 1000) / 1000,
    agreementLabel,
    supporting,
    conflicting,
    weightedScore: Math.round(weightedScore),
    votes,
    weightedVotes
  };
}

/**
 * @param {Array} candles primary TF OHLCV
 * @param {object} options
 *   symbol, currentPrice, fundamentalSnapshot, horizonBars, asOfTs, timeframe
 *   seriesMap?: { '1D': candles[], '1H': ... } for MTF
 *   calendarEvents?: array (optional; else loaded from store as-of)
 */
export function runDecision(candles, options = {}) {
  const symbol = options.symbol || 'UNKNOWN';
  const timeframe = options.timeframe || '1D';
  const asOfTs = options.asOfTs ?? (candles?.length && candles[candles.length - 1].ts) ?? Date.now();

  const tech = runTechnical(candles, {
    currentPrice: options.currentPrice,
    symbol,
    timeframe
  });
  if (!tech.ok) {
    return { ok: false, error: tech.error, layer: 'technical' };
  }

  // Calendar as-of (no future events beyond window for context; past+near future)
  const calEvents = options.calendarEvents != null
    ? options.calendarEvents
    : getCalendarAsOf(asOfTs);

  const fund = runFundamental(symbol, options.fundamentalSnapshot || null);
  const volumeAvailable = !!(tech.indicators?.volume?.available);

  const context = buildMarketContext({
    symbol,
    asOfTs,
    candles,
    fundamentalOk: fund.ok,
    calendarEvents: calEvents,
    volumeAvailable,
    timeframe
  });

  const stratResult = runAllStrategies(candles, {
    symbol,
    currentPrice: options.currentPrice,
    timeframe,
    fundamentalSnapshot: options.fundamentalSnapshot || null,
    asOfTs
  });
  const strategies = stratResult.ok ? stratResult.strategies : [];
  const ind = stratResult.indicators || tech.indicators;

  const regimeInfo = detectRegime(candles, ind);

  // Multi-timeframe (only available series)
  const seriesMap = options.seriesMap || { [timeframe]: candles };
  if (!seriesMap[timeframe]) seriesMap[timeframe] = candles;
  const mtf = runMultiTimeframe(seriesMap, { symbol, asOfTs, primaryTf: timeframe });

  // Risk engine
  let riskScore = 50;
  if (ind.atrPct != null) {
    if (ind.atrPct > CONFIG.highVolPct) riskScore += 22;
    else if (ind.atrPct < CONFIG.lowVolPct) riskScore -= 12;
  }
  if (tech.indicators?.drawdown != null && tech.indicators.drawdown > CONFIG.highDrawdownPct) riskScore += 15;
  if (regimeInfo.regime === 'High Volatility') riskScore += 12;
  if (regimeInfo.regime === 'Unclear') riskScore += 8;
  riskScore += Math.round((context.event?.eventRisk || 0) * 25);
  if (context.session?.liquidity === 'low') riskScore += 6;
  if (mtf.htfLtfConflict) riskScore += 8;
  if (context.dataQuality?.level === 'low') riskScore += 10;
  riskScore = Math.round(Math.max(0, Math.min(100, riskScore)));
  const riskLevel = riskScore >= 70 ? 'High' : riskScore <= 35 ? 'Low' : 'Medium';

  const learning = getLearningAdjustment(symbol);
  const histAcc = getAccuracy(symbol);

  const ens = ensembleStrategies(strategies, regimeInfo, riskScore, learning.multiplier, context, mtf);

  const price = ind.price;
  const support = ind.support;
  const resistance = ind.resistance;
  const atrVal = ind.atr;
  const volRegime = ind.atrPct > CONFIG.highVolPct ? 'high'
    : ind.atrPct < CONFIG.lowVolPct ? 'low' : 'normal';

  // Entry engine
  const entry = computeEntry({
    price,
    signal: ens.signal,
    support,
    resistance,
    atr: atrVal,
    atrPct: ind.atrPct,
    regime: regimeInfo.regime,
    mtf,
    strategyAgreement: ens.agreement,
    riskScore,
    fib: ind.fibonacci,
    eventState: context.event?.state,
    sessionLiquidity: context.session?.liquidity
  });

  // Target/Stop: prefer entry engine levels when valid, else structure+ATR
  let target = entry.target1;
  let stop = entry.stop;
  let rr = entry.rr;
  if (target == null || stop == null) {
    const ts = computeTargetStop(price, ens.signal, support, resistance, atrVal, volRegime);
    target = ts.target;
    stop = ts.stop;
    rr = ts.rr;
  }

  // Directional integrity check
  if (ens.signal === 'BUY' && stop != null && target != null) {
    if (!(stop < price && price < target) && !(entry.preferredEntry && stop < entry.preferredEntry && entry.preferredEntry < target)) {
      const fix = computeTargetStop(entry.preferredEntry || price, 'BUY', support, resistance, atrVal, volRegime);
      target = fix.target; stop = fix.stop; rr = fix.rr;
    }
  }
  if (ens.signal === 'SELL' && stop != null && target != null) {
    if (!(target < price && price < stop) && !(entry.preferredEntry && target < entry.preferredEntry && entry.preferredEntry < stop)) {
      const fix = computeTargetStop(entry.preferredEntry || price, 'SELL', support, resistance, atrVal, volRegime);
      target = fix.target; stop = fix.stop; rr = fix.rr;
    }
  }

  const horizonBars = options.horizonBars || CONFIG.defaultHorizonBars;
  const direction = ens.signal === 'BUY' ? 'up' : ens.signal === 'SELL' ? 'down' : 'neutral';
  const fundamentalApplied = strategies.some(s => s.id === 'fundamental' && s.active);
  const activeStrategies = strategies.filter(s => s.active).map(s => s.name);
  const dataQuality = context.dataQuality?.score ?? 0.4;

  const suggestion = buildSuggestion(ens.signal, riskLevel, tech, ens.confidence, regimeInfo.regime, entry);

  return {
    ok: true,
    data: {
      symbol,
      price,
      candleCount: candles.length,
      isRealtime: false,
      source: 'manual',
      asOfTs,
      timeframe
    },
    context: {
      session: context.session,
      economy: {
        economies: context.relevantEconomies,
        currencies: context.relevantCurrencies,
        primary: context.primaryEconomy,
        factors: context.economy?.factors || []
      },
      event: context.event,
      dataQuality: context.dataQuality
    },
    mtf: {
      ok: mtf.ok,
      agreement: mtf.agreement,
      agreementLabel: mtf.agreementLabel,
      alignment: mtf.alignment,
      higherTrend: mtf.higherTrend,
      higherTf: mtf.higherTf,
      availableTfs: mtf.availableTfs,
      summary: mtf.summary,
      htfLtfConflict: mtf.htfLtfConflict,
      frames: mtf.frames
    },
    entry,
    analysis: {
      technicalScore: tech.score,
      fundamentalScore: fund.ok ? fund.score : null,
      fundamentalStatus: fund.status,
      fundamentalMessage: fund.message,
      riskScore,
      riskLevel,
      trendScore: tech.trendScore,
      trend: tech.trend,
      combinedScore: ens.score,
      factors: tech.factors,
      fundamentalFactors: fund.factors || [],
      overbought: tech.overbought,
      oversold: tech.oversold,
      indicators: ind,
      regime: regimeInfo.regime,
      regimeConfidence: regimeInfo.confidence,
      strategyAgreement: ens.agreement,
      agreementLabel: ens.agreementLabel,
      activeStrategies,
      strategies: strategies.map(s => ({
        id: s.id, name: s.name, signal: s.signal, score: s.score,
        confidence: s.confidence, target: s.target, stop: s.stop, rr: s.rr,
        reasoning: s.reasoning, dataQuality: s.dataQuality, active: s.active
      })),
      supportingFactors: ens.supporting,
      conflictingFactors: ens.conflicting,
      dataQuality,
      historicalReliability: histAcc.ready
        ? { rate: histAcc.rate, samples: histAcc.samples }
        : { rate: null, samples: histAcc.samples || 0 }
    },
    prediction: {
      direction,
      signal: ens.signal,
      target,
      stop,
      support,
      resistance,
      confidence: ens.confidence,
      horizonBars,
      rr,
      target2: entry.target2,
      algoVersion: 'v7.0.1-context-mtf-ensemble',
      learningNote: learning.note,
      regime: regimeInfo.regime,
      entry: entry.preferredEntry,
      entryType: entry.entryType,
      waitForEntry: entry.waitForEntry,
      invalidation: entry.invalidation,
      disclaimer: 'پیش‌بینی قطعی نیست. بر اساس Ensemble چنداستراتژی، Context و Multi-Timeframe محلی است.'
    },
    suggestion,
    signal: ens.signal,
    score: ens.score,
    trend: tech.trend,
    riskLevel,
    riskScore,
    support,
    resistance,
    target,
    stop,
    rr,
    price,
    rsi: ind.rsi,
    macd: ind.macd,
    macdCrossover: ind.macdCrossover,
    macdPeriods: ind.macdPeriods,
    fibonacci: ind.fibonacci,
    atr: ind.atr,
    atrPct: ind.atrPct,
    regime: regimeInfo.regime,
    regimeConfidence: regimeInfo.confidence,
    strategyAgreement: ens.agreement,
    strategies,
    activeStrategies,
    entry,
    context,
    mtf,
    report: buildReport(ens, tech, fund, riskLevel, regimeInfo, context, mtf, entry),
    candleCount: candles.length,
    confidence: ens.confidence,
    fundamentalApplied,
    dataQuality
  };
}

function buildReport(ens, tech, fund, riskLevel, regimeInfo, context, mtf, entry) {
  const trendFa = {
    'Strong Bullish': 'قوی صعودی', Bullish: 'صعودی', Neutral: 'خنثی',
    Bearish: 'نزولی', 'Strong Bearish': 'قوی نزولی'
  }[tech.trend] || tech.trend;
  const sigFa = { BUY: 'خرید', HOLD: 'نگهداری', SELL: 'فروش' }[ens.signal];
  const regimeFa = {
    'Trending Bullish': 'روند صعودی', 'Trending Bearish': 'روند نزولی',
    Range: 'رنج', 'High Volatility': 'نوسان بالا', 'Low Volatility': 'نوسان پایین', Unclear: 'نامشخص'
  }[regimeInfo.regime] || regimeInfo.regime;
  const session = context?.session?.session || '—';
  const eventSt = context?.event?.state || 'UNKNOWN';
  let fundLine = fund.ok
    ? `امتیاز فاندامنتال: ${fund.score}.`
    : 'داده فاندامنتال کافی نیست.';
  let entryLine = entry?.waitForEntry
    ? ` ورود: صبر (${entry.entryType}).`
    : entry?.preferredEntry != null
      ? ` ورود پیشنهادی: ${entry.preferredEntry}.`
      : '';
  return `سیگنال ${sigFa} (Ensemble ${ens.score}). روند: ${trendFa}. رژیم: ${regimeFa}. سشن: ${session}. رویداد: ${eventSt}. ریسک: ${riskLevel === 'High' ? 'بالا' : riskLevel === 'Low' ? 'پایین' : 'متوسط'}. MTF: ${mtf?.agreementLabel || '—'}. ${fundLine}${entryLine}`;
}
