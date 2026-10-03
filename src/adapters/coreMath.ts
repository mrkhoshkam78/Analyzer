/**
 * Pure numerical cores — TypeScript mirrors of rust-core decision/entry/backtest.
 * Used until WASM is wired; formulas match logic/entry.js + config thresholds.
 * Version: 12.0.1
 */

export const BUY_THRESHOLD = 57;
export const SELL_THRESHOLD = 43;
export const TECH_WEIGHT = 0.7;
export const FUND_WEIGHT = 0.3;
export const ENTRY_MIN_RR = 1.05;
export const ENTRY_MIN_EV_R = -0.08;
export const MIN_SAMPLES_FOR_KELLY = 30;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function combineScores(technical: number, fundamental: number | null | undefined): number {
  const t = clamp(technical, 0, 100);
  if (fundamental == null || !Number.isFinite(fundamental)) return t;
  const f = clamp(fundamental, 0, 100);
  return TECH_WEIGHT * t + FUND_WEIGHT * f;
}

export function signalFromScore(combined: number): 'BUY' | 'SELL' | 'HOLD' {
  if (combined >= BUY_THRESHOLD) return 'BUY';
  if (combined <= SELL_THRESHOLD) return 'SELL';
  return 'HOLD';
}

export function baseConfidence(combined: number): number {
  return clamp(0.5 + Math.abs(combined - 50) / 100, 0.25, 0.95);
}

export function decide(technical: number, fundamental?: number | null) {
  const combined = combineScores(technical, fundamental);
  return {
    signal: signalFromScore(combined),
    combinedScore: Math.round(combined * 100) / 100,
    technicalScore: technical,
    fundamentalScore: fundamental ?? null,
    fundamentalApplied: fundamental != null && Number.isFinite(fundamental),
    confidence: Math.round(baseConfidence(combined) * 1000) / 1000,
  };
}

export function computeEV(opts: {
  winP: number;
  reward: number;
  risk: number;
  costFrac: number;
  price: number;
}): { evR: number | null; evPrice: number | null; netRR: number | null } {
  const { winP, reward, risk, costFrac, price } = opts;
  if (!(risk > 0 && reward > 0 && price > 0 && Number.isFinite(risk) && Number.isFinite(reward))) {
    return { evR: null, evPrice: null, netRR: null };
  }
  const costPrice = costFrac * price;
  const netReward = Math.max(0, reward - costPrice);
  const netRisk = risk + costPrice;
  const lossP = 1 - winP;
  const evPrice = winP * netReward - lossP * netRisk;
  const evR = netRisk > 0 ? evPrice / netRisk : null;
  const netRR = netRisk > 0 ? netReward / netRisk : null;
  return {
    evR: evR != null ? round2(evR) : null,
    evPrice: round2(evPrice),
    netRR: netRR != null ? round2(netRR) : null,
  };
}

export function estimateCostFrac(
  price: number,
  atr: number | null | undefined,
  spreadPts: number,
  slipAtrFrac: number,
  commissionPct: number
): number {
  if (!(price > 0 && Number.isFinite(price))) return 0;
  const atrSafe = atr != null && atr > 0 ? atr : price * 0.01;
  return (spreadPts / price) * 2 + slipAtrFrac * atrSafe / price * 2 + commissionPct * 2;
}

export function priorWin(
  baseP: number,
  agreement: number,
  structureQ: number,
  dataQuality: number
): number {
  let p = baseP;
  p += clamp((agreement - 0.5) * 0.08, -0.04, 0.04);
  p += (structureQ - 0.5) * 0.06;
  const dq = clamp(dataQuality, 0.2, 1);
  const mix = 0.55 + 0.45 * dq;
  p = p * mix + 0.45 * (1 - mix);
  return clamp(p, 0.26, 0.68);
}

export function passesGates(
  rawRR: number,
  evR: number | null | undefined,
  soft = false
): { ok: boolean; reason: string } {
  const minRR = soft ? Math.min(ENTRY_MIN_RR, 0.95) : ENTRY_MIN_RR;
  const minEV = soft ? Math.min(ENTRY_MIN_EV_R, -0.15) : ENTRY_MIN_EV_R;
  if (rawRR < minRR) return { ok: false, reason: `R:R خام ضعیف (${rawRR.toFixed(2)})` };
  if (evR != null && evR < minEV) return { ok: false, reason: `EV خالص منفی/ضعیف (${evR}R)` };
  return { ok: true, reason: '' };
}

export function positionSize(opts: {
  equity: number;
  riskPct: number;
  entry: number;
  stop: number;
  winP?: number | null;
  netRR?: number | null;
  histSamples: number;
}) {
  const { equity, riskPct, entry, stop, winP, netRR, histSamples } = opts;
  if (!(equity > 0 && Number.isFinite(entry) && Number.isFinite(stop))) {
    return { units: null, unitsFixed: null, unitsKelly: null, kellyFrac: null, note: 'ورودی نامعتبر' };
  }
  const dist = Math.abs(entry - stop);
  if (dist <= 0) return { units: null, unitsFixed: null, unitsKelly: null, kellyFrac: null, note: 'فاصله صفر' };
  const unitsFixed = (equity * Math.max(0, riskPct)) / dist;
  let kellyFrac: number | null = null;
  let unitsKelly: number | null = null;
  let note = 'کسری ثابت ریسک';
  if (histSamples >= MIN_SAMPLES_FOR_KELLY && winP != null && netRR != null && netRR > 0) {
    const f = winP - (1 - winP) / netRR;
    const half = clamp(f * 0.5, 0, 0.25);
    if (half > 0) {
      kellyFrac = half;
      unitsKelly = (equity * half) / dist;
      note = 'نیمه‌Kelly + سقف';
    } else {
      note = 'Kelly منفی — فقط کسری ثابت';
    }
  } else if (histSamples < MIN_SAMPLES_FOR_KELLY) {
    note += ' · Kelly غیرفعال (داده تاریخی ناکافی)';
  }
  const units = unitsKelly != null ? Math.min(unitsFixed, unitsKelly) : unitsFixed;
  return { units, unitsFixed, unitsKelly, kellyFrac, note };
}
