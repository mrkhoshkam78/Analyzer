/**
 * Hybrid Decision Engine
 * Combines Technical + Fundamental (when available) + Learning adjustment.
 * Separates: facts (data) vs analysis vs prediction.
 */
import { CONFIG } from './config.js';
import { runTechnical } from './technical.js';
import { runFundamental } from './fundamental.js';
import { getLearningAdjustment } from './learning.js';

function buildSuggestion(signal, riskLevel, tech, confidence) {
  const highRisk = riskLevel === 'High';
  const ind = tech.indicators || {};
  const nearRes = ind.resistance != null && ind.price > 0 &&
    (ind.resistance - ind.price) / ind.price < 0.02;
  const nearSup = ind.support != null && ind.price > 0 &&
    (ind.price - ind.support) / ind.price < 0.04;

  if (signal === 'BUY') {
    if (highRisk) return 'سیگنال خرید با ریسک بالاست. حجم را محدود و حد ضرر را رعایت کنید.';
    if (nearRes) return 'روند صعودی است اما قیمت نزدیک مقاومت است. صبر تا شکست مقاومت منطقی‌تر است.';
    if (confidence < 0.45) return 'خرید با اطمینان پایین پیشنهاد می‌شود؛ تأیید بیشتری لازم است.';
    return 'شرایط تکنیکال از خرید حمایت می‌کند. ورود با مدیریت ریسک پیشنهاد می‌شود.';
  }
  if (signal === 'SELL') {
    if (highRisk) return 'سیگنال فروش همراه ریسک بالاست. از موقعیت‌های خرید پرریسک فاصله بگیرید.';
    if (nearSup) return 'فشار نزولی دیده می‌شود؛ نزدیک حمایت عجله نکنید تا واکنش مشخص شود.';
    if (confidence < 0.45) return 'فروش با اطمینان پایین؛ منتظر تأیید بیشتر بمانید.';
    return 'شواهد به نفع فروش یا کاهش موقعیت خرید است.';
  }
  if (highRisk) return 'بازار نامشخص و پرنوسان است. فعلاً صبر کنید.';
  if (nearSup || nearRes) return 'سیگنال خنثی و قیمت نزدیک سطح کلیدی است. بررسی بیشتر و صبر مناسب است.';
  return 'شرایط برای تصمیم قطعی کافی نیست. صبر و رصد داده جدید منطقی است.';
}

/**
 * Full decision pipeline.
 * @param {Array} candles cleaned OHLCV
 * @param {object} options { symbol, currentPrice, fundamentalSnapshot, horizonBars }
 */
export function runDecision(candles, options = {}) {
  const symbol = options.symbol || 'UNKNOWN';
  const tech = runTechnical(candles, {
    currentPrice: options.currentPrice,
    symbol: options.symbol,
    timeframe: options.timeframe || '1D'
  });
  if (!tech.ok) {
    return {
      ok: false,
      error: tech.error,
      layer: 'technical'
    };
  }

  const fund = runFundamental(symbol, options.fundamentalSnapshot || null);

  // Risk score 0–100 (higher = riskier)
  let riskScore = 50;
  const ind = tech.indicators;
  if (ind.atrPct != null) {
    if (ind.atrPct > CONFIG.highVolPct) riskScore += 25;
    else if (ind.atrPct < CONFIG.lowVolPct) riskScore -= 15;
  }
  if (ind.drawdown != null && ind.drawdown > CONFIG.highDrawdownPct) riskScore += 20;
  riskScore = Math.round(Math.max(0, Math.min(100, riskScore)));
  const riskLevel = riskScore >= 70 ? 'High' : riskScore <= 35 ? 'Low' : 'Medium';

  // Combine technical + fundamental
  const ew = CONFIG.engineWeights;
  let combined = tech.score;
  let fundamentalApplied = false;
  if (fund.ok && fund.score != null) {
    combined = tech.score * ew.technical + fund.score * ew.fundamental;
    fundamentalApplied = true;
  }
  combined = Math.round(Math.max(0, Math.min(100, combined)));

  // Learning adjustment on confidence only (not core formula rewrite)
  const learning = getLearningAdjustment(symbol);
  let confidence = 0.5 + Math.abs(combined - 50) / 100; // 0.5–1.0 base from conviction
  confidence *= learning.multiplier;
  confidence = Math.max(0.15, Math.min(0.95, confidence));

  let signal = 'HOLD';
  if (combined >= CONFIG.buyThreshold) signal = 'BUY';
  else if (combined <= CONFIG.sellThreshold) signal = 'SELL';

  // Targets from structure
  const price = ind.price;
  const support = ind.support;
  const resistance = ind.resistance;
  const range = (resistance != null && support != null && resistance > support)
    ? resistance - support : 0;
  let target = price, stop = price;
  if (range > 0 && price > 0) {
    if (signal === 'BUY') {
      target = Math.max(resistance, price + range * 0.35);
      stop = Math.max(0, support - range * 0.08);
    } else if (signal === 'SELL') {
      target = Math.min(support, price - range * 0.35);
      stop = resistance + range * 0.08;
    } else {
      target = price + range * 0.15;
      stop = Math.max(0, support - range * 0.05);
    }
  }

  const horizonBars = options.horizonBars || CONFIG.defaultHorizonBars;
  const direction = signal === 'BUY' ? 'up' : signal === 'SELL' ? 'down' : 'neutral';

  const suggestion = buildSuggestion(signal, riskLevel, tech, confidence);

  // Explicit separation of layers in output
  return {
    ok: true,
    // --- Data facts ---
    data: {
      symbol,
      price,
      candleCount: candles.length,
      isRealtime: false,
      source: 'manual'
    },
    // --- Analysis ---
    analysis: {
      technicalScore: tech.score,
      fundamentalScore: fund.ok ? fund.score : null,
      fundamentalStatus: fund.status,
      fundamentalMessage: fund.message,
      riskScore,
      riskLevel,
      trendScore: tech.trendScore,
      trend: tech.trend,
      combinedScore: combined,
      factors: tech.factors,
      fundamentalFactors: fund.factors || [],
      overbought: tech.overbought,
      oversold: tech.oversold,
      indicators: ind
    },
    // --- Prediction (explicitly non-certain) ---
    prediction: {
      direction,
      signal,
      target,
      stop,
      support,
      resistance,
      confidence,
      horizonBars,
      algoVersion: CONFIG.predictionAlgoVersion,
      learningNote: learning.note,
      disclaimer: 'پیش‌بینی قطعی نیست و بر اساس مدل امتیازدهی محلی است.'
    },
    // --- Action layer ---
    suggestion,
    // Flat fields for UI compatibility
    signal,
    score: combined,
    trend: tech.trend,
    riskLevel,
    support,
    resistance,
    target,
    stop,
    price,
    rsi: ind.rsi,
    macd: ind.macd,
    macdCrossover: ind.macdCrossover,
    macdPeriods: ind.macdPeriods,
    fibonacci: ind.fibonacci,
    atr: ind.atr,
    atrPct: ind.atrPct,
    report: buildReport(signal, tech, fund, combined, riskLevel),
    candleCount: candles.length,
    confidence,
    fundamentalApplied
  };
}

function buildReport(signal, tech, fund, score, riskLevel) {
  const trendFa = {
    'Strong Bullish': 'قوی صعودی', Bullish: 'صعودی', Neutral: 'خنثی',
    Bearish: 'نزولی', 'Strong Bearish': 'قوی نزولی'
  }[tech.trend] || tech.trend;
  const sigFa = { BUY: 'خرید', HOLD: 'نگهداری', SELL: 'فروش' }[signal];
  let fundLine = fund.ok
    ? `امتیاز فاندامنتال: ${fund.score} (${fund.outlook || 'neutral'}).`
    : 'داده فاندامنتال کافی نیست و در ترکیب لحاظ نشد.';
  return `سیگنال ${sigFa} با امتیاز ترکیبی ${score}. روند: ${trendFa}. ریسک: ${riskLevel === 'High' ? 'بالا' : riskLevel === 'Low' ? 'پایین' : 'متوسط'}. ${fundLine}`;
}
