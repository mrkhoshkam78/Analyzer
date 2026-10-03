/**
 * Decision Engine V7.0.1
 * Pipeline: Context → Regime → Strategies → MTF → Reliability → Ensemble → Risk → Entry → Target/Stop → Confidence
 */
import { CONFIG } from './config';
import { runTechnical } from './technical';
import { runFundamental } from './fundamental';
import { getLearningAdjustment, getAccuracy } from './learning';
import { detectRegime } from './regime';
import { runAllStrategies, computeTargetStop } from './strategies';
import { buildMarketContext } from './context';
import { getCalendarAsOf } from './calendar';
import { runMultiTimeframe } from './mtf';
import { computeEntry } from './entry';

function buildSuggestion(signal, riskLevel, tech, confidence, regime, entry, fund) {
  const highRisk = riskLevel === 'High' || riskLevel === 'high';
  const ind = tech.indicators || {};
  const price = ind.price;
  const nearRes = ind.resistance != null && price > 0 &&
    (ind.resistance - price) / price < 0.02;
  const nearSup = ind.support != null && price > 0 &&
    (price - ind.support) / price < 0.04;

  const parts = [];
  const noTrade = entry && (entry.direction === 'No Trade' || entry.entryType === 'No Trade' || entry.entryType === 'No Valid Entry');

  if (noTrade) {
    parts.push(entry.reason || 'شرایط ورود معتبر نیست — فعلاً معامله نکنید.');
    if (entry.limitations?.length) {
      parts.push('دلیل: ' + entry.limitations.slice(0, 2).join('؛ '));
    }
    if (fund && fund.ok) {
      const map = {
        bullish: 'فاندامنتال صعودی', mild_bullish: 'فاندامنتال نسبتاً صعودی',
        neutral: 'فاندامنتال خنثی', mild_bearish: 'فاندامنتال نسبتاً نزولی', bearish: 'فاندامنتال نزولی'
      };
      const conf = fund.confidence != null ? ` (اطمینان ${Math.round(fund.confidence * 100)}٪)` : '';
      parts.push(`${map[fund.outlook] || 'فاندامنتال'}${conf}.`);
    }
    return parts.join(' ');
  }

  if (entry && entry.waitForEntry) {
    const fmt = (x) => (x != null && Number.isFinite(+x) ? (+x).toPrecision(7).replace(/\.?0+$/, '') : x);
    const zone = entry.entryZone
      ? `ناحیه ${fmt(entry.entryZone.low)}–${fmt(entry.entryZone.high)}`
      : (entry.preferredEntry != null ? `سطح ${fmt(entry.preferredEntry)}` : 'ناحیه هدف');
    parts.push(`صبر برای ورود: ${entry.entryType || 'سناریوی انتخابی'} در ${zone}.`);
    if (entry.activation) parts.push(entry.activation);
    if (entry.evR != null) parts.push(`EV مدل ≈ ${entry.evR}R.`);
    if (fund && fund.ok) {
      const map = {
        bullish: 'فاندامنتال صعودی', mild_bullish: 'فاندامنتال نسبتاً صعودی',
        neutral: 'فاندامنتال خنثی', mild_bearish: 'فاندامنتال نسبتاً نزولی', bearish: 'فاندامنتال نزولی'
      };
      const conf = fund.confidence != null ? ` (اطمینان ${Math.round(fund.confidence * 100)}٪)` : '';
      parts.push(`${map[fund.outlook] || 'فاندامنتال'}${conf}.`);
    }
    return parts.join(' ');
  }

  // Directional advice
  if (signal === 'BUY') {
    if (highRisk) {
      parts.push('خرید با ریسک بالا: حجم را کاهش دهید و حد ضرر سخت اعمال کنید.');
    } else if (nearRes) {
      parts.push('روند صعودی است اما قیمت نزدیک مقاومت است؛ ورود پس از شکست و تثبیت منطقی‌تر است.');
    } else if (confidence < 0.45) {
      parts.push('سیگنال خرید با اطمینان پایین — منتظر هم‌گرایی بیشتر بمانید.');
    } else if (regime === 'Range') {
      parts.push('رژیم رنج: خرید ترجیحاً نزدیک حمایت یا پس از شکست مقاومت.');
    } else {
      parts.push('شرایط از خرید حمایت می‌کند.');
    }
  } else if (signal === 'SELL') {
    if (highRisk) {
      parts.push('فروش با ریسک بالا: مدیریت حجم و حد ضرر الزامی است.');
    } else if (nearSup) {
      parts.push('فشار نزولی دیده می‌شود؛ نزدیک حمایت عجله نکنید.');
    } else if (confidence < 0.45) {
      parts.push('سیگنال فروش با اطمینان پایین — تأیید بیشتری لازم است.');
    } else {
      parts.push('شواهد به نفع فروش یا کاهش موقعیت خرید است.');
    }
  } else {
    if (highRisk) parts.push('بازار نامشخص و پرنوسان است — فعلاً صبر کنید.');
    else if (regime === 'Unclear') parts.push('رژیم بازار نامشخص است؛ HOLD ترجیح داده می‌شود.');
    else if (nearSup || nearRes) parts.push('سیگنال خنثی و قیمت نزدیک سطح کلیدی است.');
    else parts.push('شرایط برای تصمیم قطعی کافی نیست. صبر منطقی است.');
  }

  // Entry metrics (compact, professional)
  if (entry && entry.valid && entry.preferredEntry != null) {
    const bits = [];
    bits.push(`ورود ${entry.preferredEntry}`);
    if (entry.stop != null) bits.push(`حدضرر ${entry.stop}`);
    if (entry.target1 != null) bits.push(`هدف ${entry.target1}`);
    if (entry.netRR != null) bits.push(`R:R≈${entry.netRR}`);
    else if (entry.rr != null) bits.push(`R:R≈${entry.rr}`);
    if (entry.evR != null) bits.push(`EV ${entry.evR}R`);
    if (entry.modelConfidence != null) bits.push(`اطمینان مدل ${Math.round(entry.modelConfidence * 100)}٪`);
    parts.push(bits.join(' · '));
  }

  // Fundamental overlay
  if (fund && fund.ok) {
    const map = {
      bullish: 'فاندامنتال صعودی',
      mild_bullish: 'فاندامنتال نسبتاً صعودی',
      neutral: 'فاندامنتال خنثی',
      mild_bearish: 'فاندامنتال نسبتاً نزولی',
      bearish: 'فاندامنتال نزولی'
    };
    const label = map[fund.outlook] || 'فاندامنتال';
    const conf = fund.confidence != null ? ` (اطمینان ${Math.round(fund.confidence * 100)}٪)` : '';
    parts.push(`${label}${conf}.`);
  }

  return parts.join(' ');
}

function ensembleStrategies(strategies, regimeInfo, riskScore, learningMult, context, mtf, fundOpts = {}) {
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
  // Advanced fund blend: relative weight of fundamental strategy (default 1.0)
  const fundWeightMult = Number.isFinite(fundOpts.fundWeightMult) ? Math.max(0, Math.min(3, fundOpts.fundWeightMult)) : 1;

  // Session relevance: neutral unless backtest stats exist (data-driven placeholder = 1.0)
  const sessionMult = 1.0;

  let sumW = 0, sumScore = 0;
  const votes = { BUY: 0, SELL: 0, HOLD: 0 };
  const weightedVotes = { BUY: 0, SELL: 0, HOLD: 0 };

  for (const s of active) {
    let rw = regimeWeights[s.id] != null ? regimeWeights[s.id] : 1;
    if (s.id === 'fundamental') rw *= fundWeightMult;
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

  // Fundamental only when pipeline supplies a non-empty snapshot (toggle ON + data)
  const fundSnapIn = options.fundamentalSnapshot;
  const fundEnabled = !!(fundSnapIn && typeof fundSnapIn === 'object' && Object.keys(fundSnapIn).length);
  let fund = fundEnabled
    ? runFundamental(symbol, fundSnapIn, { regime: 'Unclear', allowStore: false })
    : { ok: false, status: 'disabled', message: 'فاندامنتال غیرفعال', factors: [], score: null, coverage: 0, confidence: 0 };
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

  // Live analysis: do not as-of-filter fund dates (user-entered offline data is "current").
  // Backtest/walk-forward should pass fundAsOfTs or backtestMode:true to prevent look-ahead.
  const stratResult = runAllStrategies(candles, {
    symbol,
    currentPrice: options.currentPrice,
    timeframe,
    fundamentalSnapshot: options.fundamentalSnapshot || null,
    asOfTs: options.backtestMode ? asOfTs : null,
    fundAsOfTs: options.fundAsOfTs
  });
  const strategies = stratResult.ok ? stratResult.strategies : [];
  const ind = stratResult.indicators || tech.indicators;

  const regimeInfo = detectRegime(candles, ind);

  // Re-score fundamental with detected regime (offline, only if enabled)
  if (fundEnabled) {
    fund = runFundamental(symbol, fundSnapIn, { regime: regimeInfo.regime || 'Unclear', allowStore: false });
  }

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

  const fundOpts = {
    fundWeightMult: options.fundWeightMult != null ? options.fundWeightMult : 1,
    fundMinCoverage: options.fundMinCoverage
  };
  // Drop fund strategy if coverage below advanced minimum
  let stratForEns = strategies;
  if (fundEnabled && fund.coverage != null && fundOpts.fundMinCoverage != null) {
    if (fund.coverage < fundOpts.fundMinCoverage) {
      stratForEns = strategies.map(s => s.id === 'fundamental' ? { ...s, active: false } : s);
    }
  }
  const ens = ensembleStrategies(stratForEns, regimeInfo, riskScore, learning.multiplier, context, mtf, fundOpts);

  const price = ind.price;
  const support = ind.support;
  const resistance = ind.resistance;
  const atrVal = ind.atr;
  const volRegime = ind.atrPct > CONFIG.highVolPct ? 'high'
    : ind.atrPct < CONFIG.lowVolPct ? 'low' : 'normal';

  // Entry engine V9.01 — multi-scenario EV-aware
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
    sessionLiquidity: context.session?.liquidity,
    symbolId: symbol,
    dataQuality: context.dataQuality?.score ?? 0.5,
    timeframe,
    equity: options.equity ?? null,
    riskPct: options.riskPct ?? CONFIG.defaultRiskPct,
    histSamples: histAcc?.samples || 0,
    fundScore: fund.ok ? fund.score : null,
    fundOutlook: fund.ok ? fund.outlook : null,
    fundConfidence: fund.ok ? (fund.confidence || 0) : 0,
    mtfAgreement: (mtf && mtf.agreement != null) ? mtf.agreement : null,
    candleCount: candles.length
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

  const suggestion = buildSuggestion(ens.signal, riskLevel, tech, ens.confidence, regimeInfo.regime, entry, fund);

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
      rr: entry.netRR != null ? entry.netRR : rr,
      target2: entry.target2,
      algoVersion: 'v11.0.1-fund-entry-v10',
      learningNote: learning.note,
      regime: regimeInfo.regime,
      entry: entry.preferredEntry,
      entryType: entry.entryType,
      entryDirection: entry.direction,
      waitForEntry: entry.waitForEntry,
      invalidation: entry.invalidation,
      winP: entry.winP,
      evR: entry.evR,
      modelConfidence: entry.modelConfidence,
      selectedScenario: entry.selectedScenario,
      disclaimer: 'پیش‌بینی قطعی نیست. Entry V10.0 بر اساس سناریوهای ساختاری، EV محافظه‌کارانه و Ensemble محلی است — نه تضمین سود.'
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
