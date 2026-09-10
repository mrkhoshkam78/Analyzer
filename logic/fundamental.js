/**
 * Fundamental Analysis Layer — independent of technical.
 * بدون داده واقعی کاربر، حدس نمی‌زند؛ وضعیت «داده کافی نیست» برمی‌گرداند.
 */
import { getSymbol } from './symbols.js';

/**
 * Expected fundamental factor keys per asset (documentation + structure only).
 * Values must be supplied by user/provider — never invented.
 */
export const FUNDAMENTAL_SCHEMA = Object.freeze({
  XAUUSD: Object.freeze([
    'interest_rate_us', 'usd_strength', 'inflation', 'monetary_policy',
    'bond_yield', 'geopolitical_risk', 'gold_demand'
  ]),
  USDEUR: Object.freeze([
    'rate_diff_us_eu', 'inflation_us', 'inflation_eu', 'fed_policy',
    'ecb_policy', 'relative_growth', 'risk_sentiment'
  ]),
  BRENT: Object.freeze([
    'oil_supply', 'oil_demand', 'inventories', 'production',
    'supply_disruption', 'global_growth', 'geopolitical_risk'
  ])
});

/**
 * @param {string} symbolId
 * @param {object|null} snapshot - optional user-provided factors { key: number in [-2..+2] }
 *   +2 strong bull for asset, -2 strong bear, 0 neutral
 * @returns fundamental assessment
 */
export function runFundamental(symbolId, snapshot = null) {
  const meta = getSymbol(symbolId);
  const schema = FUNDAMENTAL_SCHEMA[symbolId] || [];

  if (!snapshot || typeof snapshot !== 'object' || !Object.keys(snapshot).length) {
    return {
      ok: false,
      status: 'insufficient_data',
      message: 'داده فاندامنتال کافی نیست. بدون داده واقعی حدس زده نمی‌شود.',
      score: null,
      factors: [],
      schema,
      asset: meta ? meta.symbol : symbolId
    };
  }

  // Only accept known keys for this asset
  const factors = [];
  let sum = 0;
  let n = 0;
  for (const key of schema) {
    if (!(key in snapshot)) continue;
    const v = Number(snapshot[key]);
    if (!Number.isFinite(v)) continue;
    const clamped = Math.max(-2, Math.min(2, v));
    sum += clamped;
    n++;
    factors.push({
      key,
      value: clamped,
      dir: clamped > 0.3 ? 'bull' : clamped < -0.3 ? 'bear' : 'neutral'
    });
  }

  if (n === 0) {
    return {
      ok: false,
      status: 'insufficient_data',
      message: 'هیچ متغیر فاندامنتال معتبری برای این نماد ارائه نشده است.',
      score: null,
      factors: [],
      schema,
      asset: meta ? meta.symbol : symbolId
    };
  }

  // Map average [-2,2] → score [0,100]
  const avg = sum / n;
  const score = Math.round(Math.max(0, Math.min(100, 50 + avg * 25)));

  return {
    ok: true,
    status: 'ok',
    message: null,
    score,
    factors,
    schema,
    coverage: n / schema.length,
    asset: meta ? meta.symbol : symbolId
  };
}
