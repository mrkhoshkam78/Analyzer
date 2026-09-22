/**
 * Entry Price Engine V9.01
 * Multi-scenario · EV-aware · structure + volatility · NO TRADE gate
 *
 * Design principles:
 * - Does not invent levels; only uses S/R, ATR, swings, fib when present.
 * - Evaluates competing scenarios (Pullback, Breakout, Retest, Reversal, Market).
 * - Scores Expected Value (EV) with conservative win-rate priors and cost drag.
 * - Tick-size rounding; symbol-aware decimals.
 * - Daily OHLC is NOT treated as sufficient for precise intraday entries.
 * - Kelly only when historical samples ≥ threshold; otherwise disabled.
 * - All probabilities are model estimates, not calibrated forecasts.
 */

import { CONFIG } from './config.js';
import { isNum } from './indicators.js';
import { getSymbol } from './symbols.js';
import { computeTargetStop } from './strategies.js';

/* ─── Symbol execution meta (offline typical estimates — not live quotes) ─── */
const EXEC_META = Object.freeze({
  XAUUSD: { tick: 0.01, spreadPts: 0.40, commissionPct: 0, slipAtrFrac: 0.05 },
  BRENT:  { tick: 0.01, spreadPts: 0.05, commissionPct: 0, slipAtrFrac: 0.06 },
  USDEUR: { tick: 0.00001, spreadPts: 0.00008, commissionPct: 0, slipAtrFrac: 0.04 },
  DEFAULT: { tick: 0.01, spreadPts: 0, commissionPct: 0, slipAtrFrac: 0.05 }
});

function execMeta(symbolId) {
  const key = String(symbolId || '').toUpperCase();
  return EXEC_META[key] || EXEC_META.DEFAULT;
}

function decimalsOf(symbolId) {
  const meta = getSymbol(symbolId);
  if (meta && Number.isFinite(meta.decimals)) return meta.decimals;
  const em = execMeta(symbolId);
  if (em.tick < 0.001) return 5;
  if (em.tick < 0.1) return 2;
  return 2;
}

/** Round to symbol tick size (avoid false precision). */
export function roundToTick(price, symbolId) {
  if (!isNum(price)) return null;
  const tick = execMeta(symbolId).tick;
  if (!tick || tick <= 0) {
    const d = decimalsOf(symbolId);
    const f = 10 ** d;
    return Math.round(price * f) / f;
  }
  return Math.round(price / tick) * tick;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

/* ─── Structure quality (0–1) ─── */
function structureQuality({ support, resistance, price, atr }) {
  if (!isNum(price) || price <= 0) return 0.3;
  const atrSafe = isNum(atr) && atr > 0 ? atr : price * 0.01;
  let q = 0.4;
  if (isNum(support) && support > 0 && support < price) {
    const dist = (price - support) / atrSafe;
    // support within 0.3–3 ATR is useful; farther is weak context
    if (dist >= 0.2 && dist <= 3.5) q += 0.2;
    else if (dist < 0.2) q += 0.1;
  }
  if (isNum(resistance) && resistance > 0 && resistance > price) {
    const dist = (resistance - price) / atrSafe;
    if (dist >= 0.2 && dist <= 3.5) q += 0.2;
    else if (dist < 0.2) q += 0.1;
  }
  if (isNum(support) && isNum(resistance) && resistance > support) {
    const width = (resistance - support) / atrSafe;
    if (width >= 1.0 && width <= 8) q += 0.1; // meaningful range
  }
  return clamp(q, 0.15, 0.95);
}

/* ─── Conservative prior win rate by scenario × regime ───
 * These are explicit model priors for ranking, NOT empirical forecasts.
 * Capped and dampened by data quality / sample count.
 */
const WIN_PRIOR = Object.freeze({
  Pullback: {
    'Trending Bullish': 0.52, 'Trending Bearish': 0.52, Range: 0.48,
    'High Volatility': 0.42, 'Low Volatility': 0.50, Unclear: 0.45, Breakout: 0.48
  },
  Breakout: {
    'Trending Bullish': 0.48, 'Trending Bearish': 0.48, Range: 0.38,
    'High Volatility': 0.44, 'Low Volatility': 0.40, Unclear: 0.40, Breakout: 0.50
  },
  Retest: {
    'Trending Bullish': 0.54, 'Trending Bearish': 0.54, Range: 0.46,
    'High Volatility': 0.44, 'Low Volatility': 0.52, Unclear: 0.45, Breakout: 0.52
  },
  Reversal: {
    'Trending Bullish': 0.38, 'Trending Bearish': 0.38, Range: 0.50,
    'High Volatility': 0.40, 'Low Volatility': 0.48, Unclear: 0.42, Breakout: 0.36
  },
  Market: {
    'Trending Bullish': 0.46, 'Trending Bearish': 0.46, Range: 0.42,
    'High Volatility': 0.38, 'Low Volatility': 0.45, Unclear: 0.40, Breakout: 0.44
  }
});

function priorWin(scenario, regime, agreement, structureQ, dataQuality) {
  const table = WIN_PRIOR[scenario] || WIN_PRIOR.Market;
  let p = table[regime] ?? table.Unclear ?? 0.45;
  // agreement nudges ±4pp max
  p += clamp((agreement - 0.5) * 0.08, -0.04, 0.04);
  // structure quality ±3pp
  p += (structureQ - 0.5) * 0.06;
  // data quality dampens extremes toward 0.45
  const dq = clamp(dataQuality ?? 0.5, 0.2, 1);
  p = p * (0.55 + 0.45 * dq) + 0.45 * (1 - (0.55 + 0.45 * dq));
  return clamp(p, 0.28, 0.62);
}

/* ─── Cost model (spread + slippage as fraction of price) ─── */
function estimateCostFrac(price, atr, symbolId) {
  if (!isNum(price) || price <= 0) return 0;
  const em = execMeta(symbolId);
  const atrSafe = isNum(atr) && atr > 0 ? atr : price * 0.01;
  const spreadFrac = (em.spreadPts || 0) / price;
  const slipFrac = (em.slipAtrFrac || 0) * atrSafe / price;
  const commission = em.commissionPct || 0;
  // round-trip approximate: entry + exit costs
  return spreadFrac * 2 + slipFrac * 2 + commission * 2;
}

/* ─── Expected value in R-units and price ─── */
function computeEV({ winP, reward, risk, costFrac, price }) {
  if (!isNum(risk) || risk <= 0 || !isNum(reward) || reward <= 0 || !isNum(price) || price <= 0) {
    return { evR: null, evPrice: null, netRR: null };
  }
  const costPrice = costFrac * price;
  // net reward/risk after cost drag on both sides (conservative)
  const netReward = Math.max(0, reward - costPrice);
  const netRisk = risk + costPrice;
  const lossP = 1 - winP;
  const evPrice = winP * netReward - lossP * netRisk;
  const evR = netRisk > 0 ? evPrice / netRisk : null;
  const netRR = netRisk > 0 ? netReward / netRisk : null;
  return {
    evR: evR != null ? round2(evR) : null,
    evPrice: evPrice != null ? round2(evPrice) : null,
    netRR: netRR != null ? round2(netRR) : null
  };
}

/* ─── Position size (fixed fractional risk); Kelly optional ─── */
function positionSize({ equity, riskPct, entry, stop, winP, netRR, histSamples }) {
  if (!isNum(equity) || equity <= 0 || !isNum(entry) || !isNum(stop)) {
    return { units: null, riskAmount: null, method: 'none', kellyFrac: null, note: 'سرمایه یا فاصله حد ضرر نامعتبر' };
  }
  const dist = Math.abs(entry - stop);
  if (dist <= 0) {
    return { units: null, riskAmount: null, method: 'none', kellyFrac: null, note: 'فاصله حد ضرر صفر' };
  }
  const pct = isNum(riskPct) && riskPct > 0 ? clamp(riskPct, 0.001, 0.05) : 0.01;
  const riskAmount = equity * pct;
  const unitsFixed = riskAmount / dist;

  // Conservative Kelly only with enough historical samples
  let kellyFrac = null;
  let method = 'fixed_fractional';
  let note = `ریسک ${round2(pct * 100)}% سرمایه (کسری ثابت)`;
  if (isNum(winP) && isNum(netRR) && netRR > 0 && histSamples >= CONFIG.minSamplesForKelly) {
    // f* = p - (1-p)/b  where b = netRR
    const raw = winP - (1 - winP) / netRR;
    // half-Kelly, capped
    kellyFrac = clamp(raw * 0.5, 0, 0.02);
    if (kellyFrac > 0) {
      method = 'half_kelly_capped';
      note = `نیمه‌کلی محدود (نمونه‌های تاریخی: ${histSamples})`;
    } else {
      kellyFrac = null;
      note = 'Kelly منفی — فقط کسری ثابت';
    }
  } else if (histSamples < CONFIG.minSamplesForKelly) {
    note += ' · Kelly غیرفعال (داده تاریخی ناکافی)';
  }

  const unitsKelly = kellyFrac != null ? (equity * kellyFrac) / dist : null;
  const units = unitsKelly != null ? Math.min(unitsFixed, unitsKelly) : unitsFixed;

  return {
    units: units > 0 ? Math.round(units * 1e6) / 1e6 : null,
    riskAmount: round2(riskAmount),
    method,
    kellyFrac,
    note
  };
}

/* ─── Build one scenario candidate ─── */
function buildScenario(opts) {
  const {
    id, name, direction, entry, zoneLow, zoneHigh, stop, target1, target2,
    invalidation, activation, confirmation, regime, agreement, structureQ,
    dataQuality, atr, price, symbolId, spaceToObstacle
  } = opts;

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target1 - entry);
  const rr = risk > 0 ? reward / risk : null;
  const costFrac = estimateCostFrac(price, atr, symbolId);
  const winP = priorWin(id, regime, agreement, structureQ, dataQuality);
  const { evR, evPrice, netRR } = computeEV({ winP, reward, risk, costFrac, price });

  // Structure invalidation risk: if stop is beyond invalidation, ok; else weak
  let invalidationRisk = 0.3;
  if (isNum(invalidation)) {
    if (direction === 'Long' && stop <= invalidation) invalidationRisk = 0.2;
    else if (direction === 'Short' && stop >= invalidation) invalidationRisk = 0.2;
    else invalidationRisk = 0.55;
  }

  // Fill probability heuristic: closer preferred → higher; stretched → lower
  const distEntry = Math.abs(price - entry) / (isNum(atr) && atr > 0 ? atr : price * 0.01);
  const fillP = clamp(1 - distEntry * 0.25, 0.25, 0.95);

  // Score for ranking (higher better)
  let score = 0;
  if (evR != null) score += evR * 40;
  if (netRR != null) score += Math.min(netRR, 3) * 8;
  score += structureQ * 15;
  score += fillP * 10;
  score += (1 - invalidationRisk) * 10;
  score += agreement * 12;
  if (isNum(spaceToObstacle) && spaceToObstacle > 0.8) score += 5;
  if (spaceToObstacle != null && spaceToObstacle < 0.4) score -= 8;
  // reject path markers
  if (evR != null && evR < 0) score -= 25;
  if (rr != null && rr < 1.0) score -= 20;

  return {
    id,
    name,
    direction,
    entry: roundToTick(entry, symbolId),
    zone: {
      low: roundToTick(zoneLow, symbolId),
      high: roundToTick(zoneHigh, symbolId)
    },
    stop: roundToTick(stop, symbolId),
    target1: roundToTick(target1, symbolId),
    target2: target2 != null ? roundToTick(target2, symbolId) : null,
    invalidation: invalidation != null ? roundToTick(invalidation, symbolId) : null,
    activation: activation || null,
    confirmation: confirmation || [],
    rr: rr != null ? round2(rr) : null,
    netRR,
    winP: round2(winP),
    evR,
    evPrice,
    costFrac: round2(costFrac * 10000) / 10000,
    fillP: round2(fillP),
    structureQ: round2(structureQ),
    invalidationRisk: round2(invalidationRisk),
    spaceToObstacle: spaceToObstacle != null ? round2(spaceToObstacle) : null,
    score: round2(score),
    rejected: false,
    rejectReason: null
  };
}

function reject(sc, reason) {
  return { ...sc, rejected: true, rejectReason: reason, score: -999 };
}

/* ─── Scenario generators ─── */
function genPullback(ctx) {
  const { price, signal, support, resistance, atrSafe, regime, volRegime, isBuy, symbolId } = ctx;
  if (signal === 'HOLD') return null;
  if (!(regime === 'Trending Bullish' || regime === 'Trending Bearish' || regime === 'Range' || regime === 'Low Volatility')) {
    // still allow weak pullback in other regimes but marked lower via prior
  }
  const confirmation = ['پولبک به ساختار / میانگین نوسان'];
  let entry, zoneLow, zoneHigh, stop, inv, space;

  if (isBuy) {
    const pull = isNum(support) ? support : price - atrSafe * 1.15;
    entry = Math.max(pull, price - atrSafe * 0.85);
    // if already near support, tighten
    if (isNum(support) && (price - support) / atrSafe < 0.6) {
      entry = support + atrSafe * 0.12;
      confirmation.push('نزدیک حمایت — ورود فشرده');
    }
    zoneLow = entry - atrSafe * 0.25;
    zoneHigh = entry + atrSafe * 0.35;
    stop = isNum(support)
      ? Math.min(support, entry) - atrSafe * (volRegime === 'high' ? 0.7 : 0.45)
      : entry - atrSafe * 1.15;
    inv = stop - atrSafe * 0.15;
    const obstacle = isNum(resistance) ? resistance : entry + atrSafe * 2.2;
    space = (obstacle - entry) / atrSafe;
  } else {
    const pull = isNum(resistance) ? resistance : price + atrSafe * 1.15;
    entry = Math.min(pull, price + atrSafe * 0.85);
    if (isNum(resistance) && (resistance - price) / atrSafe < 0.6) {
      entry = resistance - atrSafe * 0.12;
      confirmation.push('نزدیک مقاومت — ورود فشرده');
    }
    zoneLow = entry - atrSafe * 0.35;
    zoneHigh = entry + atrSafe * 0.25;
    stop = isNum(resistance)
      ? Math.max(resistance, entry) + atrSafe * (volRegime === 'high' ? 0.7 : 0.45)
      : entry + atrSafe * 1.15;
    inv = stop + atrSafe * 0.15;
    const obstacle = isNum(support) ? support : entry - atrSafe * 2.2;
    space = (entry - obstacle) / atrSafe;
  }

  const ts = computeTargetStop(entry, signal, support, resistance, atrSafe, volRegime);
  let t1 = ts.target;
  let t2 = isBuy ? t1 + atrSafe * 1.15 : t1 - atrSafe * 1.15;
  // ensure directional integrity vs entry
  if (isBuy && !(stop < entry && entry < t1)) {
    stop = entry - atrSafe * 1.1;
    t1 = entry + atrSafe * 2.0;
    t2 = entry + atrSafe * 3.0;
  }
  if (!isBuy && !(t1 < entry && entry < stop)) {
    stop = entry + atrSafe * 1.1;
    t1 = entry - atrSafe * 2.0;
    t2 = entry - atrSafe * 3.0;
  }

  return buildScenario({
    id: 'Pullback',
    name: 'پولبک (Pullback)',
    direction: isBuy ? 'Long' : 'Short',
    entry, zoneLow, zoneHigh, stop, target1: t1, target2: t2,
    invalidation: inv,
    activation: isBuy
      ? `قیمت به ناحیه ${zoneLow}–${zoneHigh} برسد و رد نشود`
      : `قیمت به ناحیه ${zoneLow}–${zoneHigh} برسد و رد نشود`,
    confirmation,
    spaceToObstacle: space,
    ...ctx
  });
}

function genBreakout(ctx) {
  const { price, signal, support, resistance, atrSafe, regime, volRegime, isBuy, symbolId } = ctx;
  if (signal === 'HOLD') return null;

  const nearBreakBuy = isBuy && isNum(resistance) && price >= resistance * 0.998;
  const nearBreakSell = !isBuy && isNum(support) && price <= support * 1.002;
  const alreadyBrokeBuy = isBuy && isNum(resistance) && price > resistance + atrSafe * 0.05;
  const alreadyBrokeSell = !isBuy && isNum(support) && price < support - atrSafe * 0.05;

  if (!nearBreakBuy && !nearBreakSell && !alreadyBrokeBuy && !alreadyBrokeSell) {
    // speculative breakout only if regime supports
    if (!(regime === 'Trending Bullish' || regime === 'Trending Bearish' || regime === 'Breakout' || regime === 'High Volatility')) {
      return null;
    }
  }

  const confirmation = [];
  let entry, zoneLow, zoneHigh, stop, inv, space, activation;

  if (isBuy) {
    const lvl = isNum(resistance) ? resistance : price + atrSafe * 0.3;
    entry = lvl + atrSafe * 0.08;
    zoneLow = lvl;
    zoneHigh = lvl + atrSafe * 0.55;
    stop = lvl - atrSafe * (volRegime === 'high' ? 0.9 : 0.6);
    inv = stop - atrSafe * 0.1;
    space = atrSafe > 0 ? (atrSafe * 2.5) / atrSafe : 2.5;
    activation = `شکست و تثبیت بالای ${roundToTick(lvl, symbolId)}`;
    confirmation.push('شکست مقاومت / ادامه روند');
    if (alreadyBrokeBuy) confirmation.push('قیمت هم‌اکنون بالای سطح شکست');
  } else {
    const lvl = isNum(support) ? support : price - atrSafe * 0.3;
    entry = lvl - atrSafe * 0.08;
    zoneLow = lvl - atrSafe * 0.55;
    zoneHigh = lvl;
    stop = lvl + atrSafe * (volRegime === 'high' ? 0.9 : 0.6);
    inv = stop + atrSafe * 0.1;
    space = 2.5;
    activation = `شکست و تثبیت زیر ${roundToTick(lvl, symbolId)}`;
    confirmation.push('شکست حمایت / ادامه نزول');
    if (alreadyBrokeSell) confirmation.push('قیمت هم‌اکنون زیر سطح شکست');
  }

  const ts = computeTargetStop(entry, signal, support, resistance, atrSafe, volRegime);
  let t1 = isBuy
    ? Math.max(ts.target, entry + atrSafe * 1.8)
    : Math.min(ts.target, entry - atrSafe * 1.8);
  let t2 = isBuy ? t1 + atrSafe * 1.3 : t1 - atrSafe * 1.3;

  return buildScenario({
    id: 'Breakout',
    name: 'شکست (Breakout)',
    direction: isBuy ? 'Long' : 'Short',
    entry, zoneLow, zoneHigh, stop, target1: t1, target2: t2,
    invalidation: inv, activation, confirmation,
    spaceToObstacle: space,
    ...ctx
  });
}

function genRetest(ctx) {
  const { price, signal, support, resistance, atrSafe, regime, volRegime, isBuy, symbolId } = ctx;
  if (signal === 'HOLD') return null;

  // Retest requires price already beyond the broken level
  const brokeUp = isNum(resistance) && price > resistance + atrSafe * 0.15;
  const brokeDn = isNum(support) && price < support - atrSafe * 0.15;
  if (isBuy && !brokeUp) return null;
  if (!isBuy && !brokeDn) return null;

  const confirmation = ['ریتست سطح شکسته'];
  let entry, zoneLow, zoneHigh, stop, inv, space, activation;

  if (isBuy) {
    const lvl = resistance;
    entry = lvl + atrSafe * 0.05;
    zoneLow = lvl - atrSafe * 0.12;
    zoneHigh = lvl + atrSafe * 0.35;
    stop = lvl - atrSafe * (volRegime === 'high' ? 0.75 : 0.5);
    inv = stop - atrSafe * 0.1;
    const nextRes = price + atrSafe * 2.0;
    space = (nextRes - entry) / atrSafe;
    activation = `بازگشت قیمت به حوالی ${roundToTick(lvl, symbolId)} و نگهداری`;
  } else {
    const lvl = support;
    entry = lvl - atrSafe * 0.05;
    zoneLow = lvl - atrSafe * 0.35;
    zoneHigh = lvl + atrSafe * 0.12;
    stop = lvl + atrSafe * (volRegime === 'high' ? 0.75 : 0.5);
    inv = stop + atrSafe * 0.1;
    space = 2.0;
    activation = `بازگشت قیمت به حوالی ${roundToTick(lvl, symbolId)} و رد`;
  }

  const ts = computeTargetStop(entry, signal, support, resistance, atrSafe, volRegime);
  let t1 = isBuy
    ? Math.max(ts.target, entry + atrSafe * 1.9)
    : Math.min(ts.target, entry - atrSafe * 1.9);
  let t2 = isBuy ? t1 + atrSafe * 1.2 : t1 - atrSafe * 1.2;

  return buildScenario({
    id: 'Retest',
    name: 'ریتست (Retest)',
    direction: isBuy ? 'Long' : 'Short',
    entry, zoneLow, zoneHigh, stop, target1: t1, target2: t2,
    invalidation: inv, activation, confirmation,
    spaceToObstacle: space,
    ...ctx
  });
}

function genReversal(ctx) {
  const { price, signal, support, resistance, atrSafe, regime, volRegime, isBuy, fib, symbolId } = ctx;
  if (signal === 'HOLD') return null;
  // Reversal only near extremes / opposing structure
  const nearSup = isNum(support) && (price - support) / price < 0.015;
  const nearRes = isNum(resistance) && (resistance - price) / price < 0.015;
  const fibNear = fib?.ok && fib.nearest?.near;

  if (isBuy && !(nearSup || (fibNear && fib.bias === 'bull'))) return null;
  if (!isBuy && !(nearRes || (fibNear && fib.bias === 'bear'))) return null;
  // avoid reversal against strong trend without extreme
  if (isBuy && regime === 'Trending Bearish' && !nearSup) return null;
  if (!isBuy && regime === 'Trending Bullish' && !nearRes) return null;

  const confirmation = ['سناریوی برگشت از سطح کلیدی'];
  if (fibNear) confirmation.push(`فیبوناچی ${fib.nearest.level}`);

  let entry, zoneLow, zoneHigh, stop, inv, space;

  if (isBuy) {
    entry = isNum(support) ? support + atrSafe * 0.1 : price;
    if (fibNear && fib.bias === 'bull') entry = (entry + fib.nearest.price) / 2;
    zoneLow = entry - atrSafe * 0.2;
    zoneHigh = entry + atrSafe * 0.4;
    stop = entry - atrSafe * (volRegime === 'high' ? 1.0 : 0.7);
    inv = stop - atrSafe * 0.15;
    space = isNum(resistance) ? (resistance - entry) / atrSafe : 2.0;
  } else {
    entry = isNum(resistance) ? resistance - atrSafe * 0.1 : price;
    if (fibNear && fib.bias === 'bear') entry = (entry + fib.nearest.price) / 2;
    zoneLow = entry - atrSafe * 0.4;
    zoneHigh = entry + atrSafe * 0.2;
    stop = entry + atrSafe * (volRegime === 'high' ? 1.0 : 0.7);
    inv = stop + atrSafe * 0.15;
    space = isNum(support) ? (entry - support) / atrSafe : 2.0;
  }

  const ts = computeTargetStop(entry, signal, support, resistance, atrSafe, volRegime);
  let t1 = ts.target;
  let t2 = isBuy ? t1 + atrSafe : t1 - atrSafe;

  return buildScenario({
    id: 'Reversal',
    name: 'برگشت (Reversal)',
    direction: isBuy ? 'Long' : 'Short',
    entry, zoneLow, zoneHigh, stop, target1: t1, target2: t2,
    invalidation: inv,
    activation: 'تأیید برگشت با کندل ساختاری / رد سطح',
    confirmation,
    spaceToObstacle: space,
    ...ctx
  });
}

function genMarket(ctx) {
  const { price, signal, support, resistance, atrSafe, volRegime, isBuy, symbolId } = ctx;
  if (signal === 'HOLD') return null;

  const entry = price;
  const zoneLow = isBuy ? price - atrSafe * 0.15 : price - atrSafe * 0.2;
  const zoneHigh = isBuy ? price + atrSafe * 0.2 : price + atrSafe * 0.15;
  const ts = computeTargetStop(entry, signal, support, resistance, atrSafe, volRegime);
  let stop = ts.stop;
  let t1 = ts.target;
  let t2 = isBuy ? t1 + atrSafe * 1.1 : t1 - atrSafe * 1.1;
  if (isBuy && !(stop < entry && entry < t1)) {
    stop = entry - atrSafe * 1.1;
    t1 = entry + atrSafe * 2.0;
    t2 = entry + atrSafe * 3.0;
  }
  if (!isBuy && !(t1 < entry && entry < stop)) {
    stop = entry + atrSafe * 1.1;
    t1 = entry - atrSafe * 2.0;
    t2 = entry - atrSafe * 3.0;
  }
  const inv = isBuy ? stop - atrSafe * 0.1 : stop + atrSafe * 0.1;
  const space = isBuy
    ? (isNum(resistance) ? (resistance - entry) / atrSafe : 2)
    : (isNum(support) ? (entry - support) / atrSafe : 2);

  return buildScenario({
    id: 'Market',
    name: 'ورود بازاری (Market)',
    direction: isBuy ? 'Long' : 'Short',
    entry, zoneLow, zoneHigh, stop, target1: t1, target2: t2,
    invalidation: inv,
    activation: 'اجرای فوری در قیمت جاری',
    confirmation: ['ورود در قیمت بازار — بدون انتظار پولبک'],
    spaceToObstacle: space,
    ...ctx
  });
}

/* ─── Gate rules ─── */
function applyGates(sc, ctx) {
  if (!sc) return null;
  const { riskScore, agreement, eventState, dataQuality, timeframe } = ctx;

  if (eventState === 'IMMINENT_EVENT' || eventState === 'EVENT_REACTION') {
    return reject(sc, `ریسک رویداد (${eventState})`);
  }
  if (riskScore >= 80 && agreement < 0.4) {
    return reject(sc, 'ریسک بالا و توافق استراتژی پایین');
  }
  if (sc.rr != null && sc.rr < CONFIG.entryMinRR && sc.id !== 'Breakout') {
    return reject(sc, `R:R خام ${sc.rr} < ${CONFIG.entryMinRR}`);
  }
  if (sc.evR != null && sc.evR < CONFIG.entryMinEV_R) {
    return reject(sc, `EV خالص منفی/ضعیف (${sc.evR}R)`);
  }
  if (sc.structureQ < 0.25 && sc.id !== 'Market') {
    return reject(sc, 'کیفیت ساختار ناکافی');
  }
  if ((dataQuality ?? 0.5) < 0.25) {
    return reject(sc, 'کیفیت داده بسیار پایین');
  }
  // Daily data disclaimer flag (not hard reject)
  if (timeframe === '1D' || timeframe === 'D' || timeframe === '1d') {
    sc.confirmation = [...(sc.confirmation || []), 'داده روزانه: ورود سوئینگ — نه اسکالپ درون‌روزی'];
  }
  return sc;
}

/**
 * Main entry point — V9.01
 * @param {object} input
 */
export function computeEntry(input = {}) {
  const {
    price,
    signal = 'HOLD',
    support = null,
    resistance = null,
    atr = null,
    atrPct = null,
    regime = 'Unclear',
    mtf = null,
    strategyAgreement = 0.5,
    riskScore = 50,
    fib = null,
    eventState = 'UNKNOWN',
    sessionLiquidity = 'normal',
    symbolId = null,
    dataQuality = 0.5,
    timeframe = '1D',
    equity = null,
    riskPct = 0.01,
    histSamples = 0,
    candleCount = 0
  } = input;

  const computedAt = new Date().toISOString();
  const empty = {
    valid: false,
    version: 'v9.01',
    entryType: 'No Valid Entry',
    direction: 'No Trade',
    preferredEntry: null,
    entryZone: null,
    currentPrice: price,
    confirmation: [],
    invalidation: null,
    target1: null,
    target2: null,
    stop: null,
    rr: null,
    netRR: null,
    winP: null,
    evR: null,
    evPrice: null,
    waitForEntry: true,
    reason: 'سیگنال یا ساختار کافی نیست',
    scenarios: [],
    selectedScenario: null,
    rejectedScenarios: [],
    position: null,
    regime,
    dataQuality,
    modelConfidence: 0.2,
    limitations: [],
    costNote: null,
    computedAt
  };

  const limitations = [];
  if (!isNum(candleCount) || candleCount < CONFIG.minCandles) {
    limitations.push('تعداد کندل کمتر از حداقل موتور');
  }
  if (candleCount > 0 && candleCount < 80) {
    limitations.push('نمونه روزانه محدود — تخمین احتمال کالیبره‌شده نیست');
  }
  if (histSamples < CONFIG.minSamplesForKelly) {
    limitations.push('Kelly غیرفعال: نمونه‌های تاریخی ناکافی');
  }
  limitations.push('اسپرد/لغزش: برآورد آفلاین نوعی — نه قیمت زنده');
  limitations.push('احتمال موفقیت: prior مدل + تعدیل ساختار؛ نه پیش‌بینی تضمینی');
  if (timeframe === '1D' || timeframe === 'D' || !timeframe) {
    limitations.push('تایم‌فریم روزانه برای ورود دقیق درون‌روزی کافی نیست');
  }

  if (!isNum(price) || price <= 0) {
    return { ...empty, reason: 'قیمت نامعتبر', limitations };
  }

  if (signal === 'HOLD') {
    return {
      ...empty,
      reason: 'سیگنال HOLD — No Trade',
      direction: 'No Trade',
      entryType: 'No Trade',
      limitations
    };
  }

  if (eventState === 'IMMINENT_EVENT' || eventState === 'EVENT_REACTION') {
    return {
      ...empty,
      reason: `ریسک رویداد (${eventState}) — صبر تا آرامش`,
      direction: 'No Trade',
      entryType: 'No Trade',
      limitations
    };
  }

  if (riskScore >= 75 && strategyAgreement < 0.45) {
    return {
      ...empty,
      reason: 'ریسک بالا و توافق استراتژی پایین — No Trade',
      direction: 'No Trade',
      entryType: 'No Trade',
      limitations
    };
  }

  const atrSafe = isNum(atr) && atr > 0 ? atr : price * 0.008;
  const volRegime = isNum(atrPct)
    ? (atrPct > CONFIG.highVolPct ? 'high' : atrPct < CONFIG.lowVolPct ? 'low' : 'normal')
    : 'normal';
  const isBuy = signal === 'BUY';
  const structureQ = structureQuality({ support, resistance, price, atr: atrSafe });
  const agreement = clamp(strategyAgreement ?? 0.5, 0, 1);

  // MTF soft factor
  let mtfNote = null;
  if (mtf?.ok) {
    if (mtf.alignment === (isBuy ? 'bullish' : 'bearish')) mtfNote = `توافق MTF: ${mtf.agreementLabel}`;
    else if (mtf.htfLtfConflict) mtfNote = 'تعارض HTF/LTF';
  }

  const ctx = {
    price, signal, support, resistance, atrSafe, atr: atrSafe, atrPct,
    regime, volRegime, isBuy, fib, symbolId,
    agreement, structureQ, dataQuality, riskScore, eventState,
    sessionLiquidity, timeframe, mtf
  };

  // Generate candidates
  const raw = [
    genPullback(ctx),
    genBreakout(ctx),
    genRetest(ctx),
    genReversal(ctx),
    genMarket(ctx)
  ].filter(Boolean);

  const gated = raw.map(sc => applyGates(sc, ctx));
  const alive = gated.filter(sc => sc && !sc.rejected);
  const rejected = gated.filter(sc => sc && sc.rejected).map(sc => ({
    id: sc.id,
    name: sc.name,
    reason: sc.rejectReason,
    score: sc.score,
    rr: sc.rr,
    evR: sc.evR
  }));

  // Fib confluence soft boost
  if (fib?.ok && fib.nearest?.near) {
    for (const sc of alive) {
      if ((isBuy && fib.bias === 'bull') || (!isBuy && fib.bias === 'bear')) {
        sc.confirmation = [...sc.confirmation, `هم‌ترازی فیب ${fib.nearest.level}`];
        sc.score = round2(sc.score + 4);
      }
    }
  }
  if (mtfNote) {
    for (const sc of alive) {
      sc.confirmation = [...sc.confirmation, mtfNote];
      if (mtf?.htfLtfConflict) sc.score = round2(sc.score - 5);
      else sc.score = round2(sc.score + 3);
    }
  }
  if (sessionLiquidity === 'low') {
    for (const sc of alive) {
      sc.score = round2(sc.score - 4);
      sc.confirmation = [...sc.confirmation, 'نقدشوندگی سشن پایین'];
    }
  }

  alive.sort((a, b) => b.score - a.score);

  if (!alive.length) {
    return {
      ...empty,
      reason: 'هیچ سناریوی معتبری از دروازه‌های EV/R:R/ساختار عبور نکرد — No Trade',
      direction: 'No Trade',
      entryType: 'No Trade',
      scenarios: [],
      rejectedScenarios: rejected,
      limitations,
      modelConfidence: clamp(0.15 + structureQ * 0.15 + agreement * 0.1, 0.1, 0.4)
    };
  }

  const best = alive[0];
  // Wait-for-entry if preferred is meaningfully away from market
  const distAtr = Math.abs(price - best.entry) / atrSafe;
  const waitForEntry =
    distAtr > 0.35 &&
    (best.id === 'Pullback' || best.id === 'Retest' || best.id === 'Reversal');

  const atMarket = Math.abs(price - best.entry) / price < 0.0025;

  // Position sizing
  const pos = positionSize({
    equity: isNum(equity) ? equity : null,
    riskPct,
    entry: best.entry,
    stop: best.stop,
    winP: best.winP,
    netRR: best.netRR,
    histSamples
  });

  // Model confidence (honest, capped)
  let modelConf =
    0.2 * agreement +
    0.2 * structureQ +
    0.15 * (dataQuality ?? 0.5) +
    0.15 * (best.evR != null ? clamp((best.evR + 0.2) / 0.6, 0, 1) : 0.3) +
    0.15 * (1 - (riskScore / 100)) +
    0.15 * (best.fillP ?? 0.5);
  if (candleCount < 80) modelConf *= 0.85;
  if (waitForEntry) modelConf *= 0.95;
  modelConf = clamp(modelConf, 0.12, 0.78);

  const em = execMeta(symbolId);
  const costNote = `برآورد هزینه رفت‌وبرگشت: spread≈${em.spreadPts} + slip≈${round2(em.slipAtrFrac * 100)}%ATR (آفلاین)`;

  return {
    valid: true,
    version: 'v9.01',
    entryType: best.name,
    direction: best.direction,
    preferredEntry: best.entry,
    entryZone: best.zone,
    currentPrice: price,
    confirmation: best.confirmation,
    invalidation: best.invalidation,
    target1: best.target1,
    target2: best.target2,
    stop: best.stop,
    rr: best.rr,
    netRR: best.netRR,
    winP: best.winP,
    evR: best.evR,
    evPrice: best.evPrice,
    fillP: best.fillP,
    activation: best.activation,
    waitForEntry: waitForEntry && !atMarket,
    reason: waitForEntry && !atMarket
      ? `Wait for Entry — ${best.name}`
      : `انتخاب سناریو: ${best.name} (امتیاز ${best.score})`,
    scenarios: alive.map(s => ({
      id: s.id,
      name: s.name,
      direction: s.direction,
      entry: s.entry,
      stop: s.stop,
      target1: s.target1,
      rr: s.rr,
      netRR: s.netRR,
      winP: s.winP,
      evR: s.evR,
      score: s.score,
      fillP: s.fillP
    })),
    selectedScenario: best.id,
    rejectedScenarios: rejected,
    position: pos,
    regime,
    structureQ: best.structureQ,
    dataQuality,
    modelConfidence: round2(modelConf),
    limitations,
    costNote,
    computedAt,
    // backward-compat fields used by decision/UI
    symbolId,
    atrUsed: atrSafe,
    volRegime
  };
}
