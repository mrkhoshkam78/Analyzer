/**
 * Modular Multi-Strategy Engine
 * Each strategy returns: Signal, Score, Confidence, Target, Stop, R:R, Reasoning, Data Quality
 * No double-counting of shared evidence across strategies in ensemble (handled upstream).
 */
import { CONFIG } from './config.js';
import {
  ema, rsi, macd, atr, momentum, roc, bollinger, stochastic, adx,
  supportResistance, volumeAnalysis, detectBreakout, fibonacciLevels,
  isNum, last
} from './indicators.js';
import { getMacdConfig, getFibConfig } from './indicatorConfig.js';
import { runFundamental } from './fundamental.js';

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Shared indicator bundle — computed once, passed to strategies to avoid duplicate calc.
 */
export function computeSharedIndicators(candles, options = {}) {
  if (!candles || candles.length < CONFIG.minCandles) {
    return { ok: false, error: `حداقل ${CONFIG.minCandles} کندل لازم است.` };
  }
  const symbol = options.symbol || null;
  const timeframe = options.timeframe || '1D';
  const macdCfg = getMacdConfig(symbol, timeframe);
  const fibCfg = getFibConfig(symbol, timeframe);
  const closes = candles.map(c => c.c);
  const price = isNum(options.currentPrice) && options.currentPrice > 0
    ? options.currentPrice
    : last(closes);

  return {
    ok: true,
    price,
    closes,
    candles,
    e20: ema(closes, CONFIG.smaFast),
    e50: ema(closes, CONFIG.smaSlow),
    r: rsi(closes),
    m: macd(closes, macdCfg),
    a: atr(candles),
    mom: momentum(closes),
    rocVal: roc(closes),
    bb: bollinger(closes),
    stoch: stochastic(candles),
    adxRes: adx(candles),
    sr: supportResistance(candles),
    volA: volumeAnalysis(candles),
    brk: detectBreakout(candles),
    fib: fibonacciLevels(candles, {
      lookback: fibCfg.lookback,
      nearPct: fibCfg.nearPct,
      price
    }),
    volPct: (() => {
      const a = atr(candles);
      return a != null && price > 0 ? (a / price) * 100 : null;
    })(),
    macdCfg,
    fibCfg
  };
}

function emptyStrategy(id, name) {
  return {
    id,
    name,
    signal: 'HOLD',
    score: 50,
    confidence: 0.3,
    target: null,
    stop: null,
    rr: null,
    reasoning: [],
    dataQuality: 0.3,
    active: false
  };
}

/**
 * Compute Target/Stop from structure + ATR, direction-aware.
 * No fixed 2% without data logic.
 */
export function computeTargetStop(price, signal, support, resistance, atrVal, volRegime = 'normal') {
  if (!isNum(price) || price <= 0) {
    return { target: price, stop: price, rr: null };
  }

  const atrSafe = isNum(atrVal) && atrVal > 0 ? atrVal : price * 0.01;
  // ATR multipliers by vol regime
  const mult = volRegime === 'high' ? { target: 2.2, stop: 1.4 }
    : volRegime === 'low' ? { target: 1.6, stop: 0.9 }
    : { target: 2.0, stop: 1.1 };

  let target = price;
  let stop = price;

  if (signal === 'BUY') {
    // Prefer structure: target near/above resistance, stop below support
    if (isNum(resistance) && resistance > price) {
      target = resistance;
    } else {
      target = price + atrSafe * mult.target;
    }
    // Ensure target is at least ATR * mult away
    const minTarget = price + atrSafe * (mult.target * 0.7);
    if (target < minTarget) target = minTarget;

    if (isNum(support) && support < price) {
      stop = Math.min(support, price - atrSafe * mult.stop * 0.5);
      // don't put stop too far: max 2.5 ATR
      const maxStopDist = atrSafe * 2.5;
      if (price - stop > maxStopDist) stop = price - maxStopDist;
    } else {
      stop = price - atrSafe * mult.stop;
    }
    if (stop >= price) stop = price - atrSafe * 0.8;
    if (stop < 0) stop = price * 0.5;
  } else if (signal === 'SELL') {
    if (isNum(support) && support < price) {
      target = support;
    } else {
      target = price - atrSafe * mult.target;
    }
    const maxTarget = price - atrSafe * (mult.target * 0.7);
    if (target > maxTarget) target = maxTarget;

    if (isNum(resistance) && resistance > price) {
      stop = Math.max(resistance, price + atrSafe * mult.stop * 0.5);
      const maxStopDist = atrSafe * 2.5;
      if (stop - price > maxStopDist) stop = price + maxStopDist;
    } else {
      stop = price + atrSafe * mult.stop;
    }
    if (stop <= price) stop = price + atrSafe * 0.8;
  } else {
    // HOLD — soft levels for reference
    target = price + atrSafe * 1.0;
    stop = Math.max(0, price - atrSafe * 1.0);
  }

  const risk = Math.abs(price - stop);
  const reward = Math.abs(target - price);
  const rr = risk > 0 ? reward / risk : null;

  return {
    target: Math.round(target * 1e6) / 1e6,
    stop: Math.round(stop * 1e6) / 1e6,
    rr: rr != null ? Math.round(rr * 100) / 100 : null
  };
}

function scoreToSignal(score) {
  if (score >= CONFIG.buyThreshold) return 'BUY';
  if (score <= CONFIG.sellThreshold) return 'SELL';
  return 'HOLD';
}

function confFromConviction(score, dataQuality, agreementBoost = 0) {
  // Not only |score-50|; include data quality
  const conviction = Math.abs(score - 50) / 50; // 0–1
  let c = 0.35 + conviction * 0.4 + dataQuality * 0.2 + agreementBoost * 0.05;
  return clamp01(c);
}

// ─── Strategy 1: Trend Following (EMA + ADX + MACD) ─────────────────────────
export function strategyTrendFollowing(shared) {
  const id = 'trendFollowing';
  const name = 'Trend Following';
  if (!shared.ok) return emptyStrategy(id, name);

  const { price, e20, e50, m, adxRes } = shared;
  const reasoning = [];
  let score = 50;
  let dq = 0.5;

  if (e20 != null && e50 != null) {
    dq += 0.15;
    if (price > e20 && e20 > e50) {
      score += 22;
      reasoning.push('قیمت بالای EMA20 و EMA20 بالای EMA50 (روند صعودی)');
    } else if (price < e20 && e20 < e50) {
      score -= 22;
      reasoning.push('قیمت زیر EMA20 و EMA20 زیر EMA50 (روند نزولی)');
    } else if (price > e50) {
      score += 10;
      reasoning.push('قیمت بالای EMA50');
    } else if (price < e50) {
      score -= 10;
      reasoning.push('قیمت زیر EMA50');
    }
  }

  if (adxRes?.adx != null) {
    dq += 0.15;
    if (adxRes.adx >= 25) {
      if (adxRes.plusDI > adxRes.minusDI) {
        score += 12;
        reasoning.push(`ADX=${adxRes.adx.toFixed(1)} قدرت روند صعودی`);
      } else {
        score -= 12;
        reasoning.push(`ADX=${adxRes.adx.toFixed(1)} قدرت روند نزولی`);
      }
    } else {
      score = score * 0.7 + 50 * 0.3; // pull toward neutral when weak trend
      reasoning.push(`ADX=${adxRes.adx.toFixed(1)} روند ضعیف`);
    }
  }

  if (m?.macd != null && !m.insufficient) {
    dq += 0.15;
    if (m.crossover === 'bullish') {
      score += 14;
      reasoning.push('تقاطع صعودی MACD');
    } else if (m.crossover === 'bearish') {
      score -= 14;
      reasoning.push('تقاطع نزولی MACD');
    } else if (m.momentumDir === 'bull') {
      score += 6;
      reasoning.push('هیستوگرام MACD مثبت');
    } else if (m.momentumDir === 'bear') {
      score -= 6;
      reasoning.push('هیستوگرام MACD منفی');
    }
  }

  score = clamp(Math.round(score));
  const signal = scoreToSignal(score);
  dq = clamp01(dq);
  const conf = confFromConviction(score, dq);
  const ts = computeTargetStop(
    price, signal,
    shared.sr?.support, shared.sr?.resistance,
    shared.a,
    shared.volPct > CONFIG.highVolPct ? 'high' : shared.volPct < CONFIG.lowVolPct ? 'low' : 'normal'
  );

  return {
    id, name, signal, score, confidence: conf,
    target: ts.target, stop: ts.stop, rr: ts.rr,
    reasoning, dataQuality: dq, active: true
  };
}

// ─── Strategy 2: Mean Reversion (RSI + BB + Stochastic) ─────────────────────
export function strategyMeanReversion(shared) {
  const id = 'meanReversion';
  const name = 'Mean Reversion';
  if (!shared.ok) return emptyStrategy(id, name);

  const { price, r, bb, stoch } = shared;
  const reasoning = [];
  let score = 50;
  let dq = 0.4;

  if (r != null) {
    dq += 0.2;
    if (r < 30) {
      score += 22;
      reasoning.push(`RSI=${r.toFixed(1)} اشباع فروش → برگشت صعودی محتمل`);
    } else if (r > 70) {
      score -= 22;
      reasoning.push(`RSI=${r.toFixed(1)} اشباع خرید → برگشت نزولی محتمل`);
    } else if (r < 40) {
      score += 8;
      reasoning.push(`RSI=${r.toFixed(1)} نسبتاً پایین`);
    } else if (r > 60) {
      score -= 8;
      reasoning.push(`RSI=${r.toFixed(1)} نسبتاً بالا`);
    }
  }

  if (bb?.pctB != null) {
    dq += 0.2;
    if (bb.pctB < 0.1) {
      score += 16;
      reasoning.push('قیمت نزدیک کف بولینگر');
    } else if (bb.pctB > 0.9) {
      score -= 16;
      reasoning.push('قیمت نزدیک سقف بولینگر');
    } else if (bb.pctB < 0.25) {
      score += 6;
    } else if (bb.pctB > 0.75) {
      score -= 6;
    }
  }

  if (stoch?.k != null) {
    dq += 0.15;
    if (stoch.k < 20) {
      score += 12;
      reasoning.push(`استوکاستیک K=${stoch.k.toFixed(1)} اشباع فروش`);
    } else if (stoch.k > 80) {
      score -= 12;
      reasoning.push(`استوکاستیک K=${stoch.k.toFixed(1)} اشباع خرید`);
    }
  }

  score = clamp(Math.round(score));
  const signal = scoreToSignal(score);
  dq = clamp01(dq);
  const conf = confFromConviction(score, dq);
  const ts = computeTargetStop(
    price, signal,
    shared.sr?.support, shared.sr?.resistance,
    shared.a,
    shared.volPct > CONFIG.highVolPct ? 'high' : shared.volPct < CONFIG.lowVolPct ? 'low' : 'normal'
  );

  return {
    id, name, signal, score, confidence: conf,
    target: ts.target, stop: ts.stop, rr: ts.rr,
    reasoning, dataQuality: dq, active: true
  };
}

// ─── Strategy 3: Momentum (ROC/Momentum + MACD Hist + Volume) ────────────────
export function strategyMomentum(shared) {
  const id = 'momentum';
  const name = 'Momentum';
  if (!shared.ok) return emptyStrategy(id, name);

  const { price, mom, rocVal, m, volA } = shared;
  const reasoning = [];
  let score = 50;
  let dq = 0.4;

  if (mom != null) {
    dq += 0.2;
    if (mom > 3) {
      score += 18;
      reasoning.push(`مومنتوم=${mom.toFixed(1)}٪ قوی صعودی`);
    } else if (mom < -3) {
      score -= 18;
      reasoning.push(`مومنتوم=${mom.toFixed(1)}٪ قوی نزولی`);
    } else if (mom > 1) {
      score += 8;
      reasoning.push('مومنتوم مثبت');
    } else if (mom < -1) {
      score -= 8;
      reasoning.push('مومنتوم منفی');
    }
  }

  if (rocVal != null && rocVal !== mom) {
    dq += 0.1;
    if (rocVal > 2) score += 6;
    else if (rocVal < -2) score -= 6;
  }

  if (m?.hist != null && !m.insufficient) {
    dq += 0.15;
    if (m.hist > 0 && m.momentumDir === 'bull') {
      score += 10;
      reasoning.push('هیستوگرام MACD در حال تقویت صعودی');
    } else if (m.hist < 0 && m.momentumDir === 'bear') {
      score -= 10;
      reasoning.push('هیستوگرام MACD در حال تقویت نزولی');
    }
  }

  if (volA?.available) {
    dq += 0.15;
    if (volA.spike) {
      // volume confirms momentum direction
      if (score > 55) {
        score += 8;
        reasoning.push('حجم بالا تأیید مومنتوم صعودی');
      } else if (score < 45) {
        score -= 8;
        reasoning.push('حجم بالا تأیید مومنتوم نزولی');
      }
    } else if (volA.weak) {
      score = score * 0.85 + 50 * 0.15;
      reasoning.push('حجم ضعیف — مومنتوم مشکوک');
    }
  }

  score = clamp(Math.round(score));
  const signal = scoreToSignal(score);
  dq = clamp01(dq);
  const conf = confFromConviction(score, dq);
  const ts = computeTargetStop(
    price, signal,
    shared.sr?.support, shared.sr?.resistance,
    shared.a,
    shared.volPct > CONFIG.highVolPct ? 'high' : shared.volPct < CONFIG.lowVolPct ? 'low' : 'normal'
  );

  return {
    id, name, signal, score, confidence: conf,
    target: ts.target, stop: ts.stop, rr: ts.rr,
    reasoning, dataQuality: dq, active: true
  };
}

// ─── Strategy 4: Breakout (S/R + ATR + Volume + Confirmation) ────────────────
export function strategyBreakout(shared) {
  const id = 'breakout';
  const name = 'Breakout';
  if (!shared.ok) return emptyStrategy(id, name);

  const { price, brk, sr, volA, a, volPct } = shared;
  const reasoning = [];
  let score = 50;
  let dq = 0.35;

  if (brk) {
    dq += 0.2;
    if (brk.up) {
      score += 20;
      reasoning.push('شکست صعودی از مقاومت اخیر');
    } else if (brk.down) {
      score -= 20;
      reasoning.push('شکست نزولی از حمایت اخیر');
    }
  }

  if (sr?.support != null && sr?.resistance != null && price > 0) {
    dq += 0.15;
    const range = sr.resistance - sr.support;
    const pos = range > 0 ? (price - sr.support) / range : 0.5;
    if (pos > 0.92) {
      score += 8;
      reasoning.push('قیمت نزدیک مقاومت — آمادگی شکست صعودی');
    } else if (pos < 0.08) {
      score -= 8;
      reasoning.push('قیمت نزدیک حمایت — آمادگی شکست نزولی');
    }
  }

  if (volA?.available) {
    dq += 0.2;
    if (volA.spike && (brk?.up || brk?.down)) {
      score = score > 50 ? score + 12 : score - 12;
      reasoning.push('حجم بالا تأیید شکست');
    } else if (volA.weak && (brk?.up || brk?.down)) {
      score = score * 0.7 + 50 * 0.3;
      reasoning.push('حجم ضعیف — شکست مشکوک (false breakout؟)');
    }
  }

  // ATR expansion supports genuine breakout
  if (volPct != null && volPct > CONFIG.highVolPct * 0.8 && (brk?.up || brk?.down)) {
    score = score > 50 ? Math.min(100, score + 6) : Math.max(0, score - 6);
    reasoning.push('نوسان بالا همراه شکست');
  }

  score = clamp(Math.round(score));
  const signal = scoreToSignal(score);
  dq = clamp01(dq);
  const conf = confFromConviction(score, dq);
  const ts = computeTargetStop(
    price, signal,
    sr?.support, sr?.resistance,
    a,
    volPct > CONFIG.highVolPct ? 'high' : volPct < CONFIG.lowVolPct ? 'low' : 'normal'
  );

  return {
    id, name, signal, score, confidence: conf,
    target: ts.target, stop: ts.stop, rr: ts.rr,
    reasoning, dataQuality: dq, active: true
  };
}

// ─── Strategy 5: Fibonacci / Market Structure ────────────────────────────────
export function strategyFibStructure(shared) {
  const id = 'fibStructure';
  const name = 'Fibonacci / Structure';
  if (!shared.ok) return emptyStrategy(id, name);

  const { price, fib, sr, a, volPct } = shared;
  const reasoning = [];
  let score = 50;
  let dq = 0.35;

  if (fib?.ok && !fib.insufficient) {
    dq += 0.3;
    if (fib.nearest?.near) {
      if (fib.bias === 'bull') {
        score += 18;
        reasoning.push(`نزدیک سطح فیبوناچی ${fib.nearest.level} (بایاس صعودی)`);
      } else if (fib.bias === 'bear') {
        score -= 18;
        reasoning.push(`نزدیک سطح فیبوناچی ${fib.nearest.level} (بایاس نزولی)`);
      } else {
        reasoning.push(`نزدیک سطح فیبوناچی ${fib.nearest.level}`);
      }
    }
    if (fib.upSwing) {
      score += 4;
      reasoning.push('ساختار سوئینگ صعودی');
    } else {
      score -= 4;
      reasoning.push('ساختار سوئینگ نزولی');
    }
  }

  if (sr?.support != null && price > 0) {
    dq += 0.15;
    const distSup = (price - sr.support) / price;
    if (distSup < 0.015) {
      score += 12;
      reasoning.push('نزدیک حمایت ساختاری');
    }
  }
  if (sr?.resistance != null && price > 0) {
    dq += 0.1;
    const distRes = (sr.resistance - price) / price;
    if (distRes < 0.015) {
      score -= 12;
      reasoning.push('نزدیک مقاومت ساختاری');
    }
  }

  score = clamp(Math.round(score));
  const signal = scoreToSignal(score);
  dq = clamp01(dq);
  const conf = confFromConviction(score, dq);
  const ts = computeTargetStop(
    price, signal,
    sr?.support, sr?.resistance,
    a,
    volPct > CONFIG.highVolPct ? 'high' : volPct < CONFIG.lowVolPct ? 'low' : 'normal'
  );

  return {
    id, name, signal, score, confidence: conf,
    target: ts.target, stop: ts.stop, rr: ts.rr,
    reasoning, dataQuality: dq, active: true
  };
}

// ─── Strategy 6: Fundamental / Macro (only if valid data) ────────────────────
export function strategyFundamental(symbol, fundSnapshot, asOfTs = null) {
  const id = 'fundamental';
  const name = 'Fundamental / Macro';
  const empty = emptyStrategy(id, name);

  // Filter snapshot by timestamp if provided (no look-ahead)
  let snap = fundSnapshot;
  if (snap && asOfTs != null && typeof asOfTs === 'number') {
    snap = filterFundByTimestamp(snap, asOfTs);
  }

  const fund = runFundamental(symbol, snap || null);
  if (!fund.ok || fund.score == null) {
    return {
      ...empty,
      reasoning: [fund.message || 'داده فاندامنتال معتبر موجود نیست'],
      dataQuality: 0.1,
      active: false
    };
  }

  const score = clamp(Math.round(fund.score));
  const signal = scoreToSignal(score);
  const dq = fund.coverage != null ? clamp01(fund.coverage) : 0.5;
  const conf = confFromConviction(score, dq);
  const reasoning = (fund.factors || []).map(f => f.text || f).slice(0, 5);
  if (!reasoning.length) {
    reasoning.push(`امتیاز فاندامنتال: ${score} (${fund.outlook || 'neutral'})`);
  }

  return {
    id, name, signal, score, confidence: conf,
    target: null, stop: null, rr: null, // levels set by structure strategies
    reasoning, dataQuality: dq, active: true,
    outlook: fund.outlook
  };
}

/**
 * Filter fundamental snapshot so only vars with date <= asOfTs are used.
 */
function filterFundByTimestamp(snapshot, asOfTs) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const out = {};
  const asOfDate = new Date(asOfTs);
  const asOfStr = Number.isFinite(asOfTs)
    ? asOfDate.toISOString().slice(0, 10)
    : null;

  for (const [varId, rec] of Object.entries(snapshot)) {
    if (!rec || typeof rec !== 'object') continue;
    if (!rec.date) {
      // no date → treat as current only if asOf is "now"; in backtest skip undated
      continue;
    }
    if (asOfStr && rec.date <= asOfStr) {
      out[varId] = rec;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Run all strategies and return array.
 */
export function runAllStrategies(candles, options = {}) {
  const shared = computeSharedIndicators(candles, options);
  if (!shared.ok) {
    return {
      ok: false,
      error: shared.error,
      strategies: [],
      shared: null
    };
  }

  const strategies = [
    strategyTrendFollowing(shared),
    strategyMeanReversion(shared),
    strategyMomentum(shared),
    strategyBreakout(shared),
    strategyFibStructure(shared),
    strategyFundamental(
      options.symbol,
      options.fundamentalSnapshot,
      options.asOfTs ?? null
    )
  ];

  return {
    ok: true,
    strategies,
    shared,
    indicators: {
      price: shared.price,
      ema20: shared.e20,
      ema50: shared.e50,
      rsi: shared.r,
      macd: shared.m?.macd,
      macdSignal: shared.m?.signal,
      macdHist: shared.m?.hist,
      macdCrossover: shared.m?.crossover,
      macdMomentum: shared.m?.momentumDir,
      macdPeriods: shared.m?.periods,
      atr: shared.a,
      atrPct: shared.volPct,
      momentum: shared.mom,
      roc: shared.rocVal,
      bollinger: shared.bb,
      stochastic: shared.stoch,
      adx: shared.adxRes,
      support: shared.sr?.support,
      resistance: shared.sr?.resistance,
      volume: shared.volA,
      breakout: shared.brk,
      fibonacci: shared.fib
    }
  };
}
