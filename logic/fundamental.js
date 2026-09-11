/**
 * Fundamental Analysis Engine V5.1
 * Five core US macro variables only. Fully offline / manual entry.
 * Asset-aware weights. No invented data. No external API dependency.
 */
import { getSymbol } from './symbols.js';
import { loadJSON, saveJSON } from './storage.js';

/** Canonical variable definitions */
export const FUND_VARS = Object.freeze([
  {
    id: 'fed_funds',
    nameFa: 'نرخ بهره فدرال',
    nameEn: 'US Federal Funds Rate',
    unit: '%',
    higherIs: 'mixed',
    description: 'نرخ بهره معیار فدرال رزرو'
  },
  {
    id: 'cpi',
    nameFa: 'تورم / CPI',
    nameEn: 'US CPI / Inflation',
    unit: '% YoY',
    higherIs: 'mixed',
    description: 'شاخص قیمت مصرف‌کننده آمریکا'
  },
  {
    id: 'nfp',
    nameFa: 'اشتغال غیرکشاورزی',
    nameEn: 'US Non-Farm Payrolls',
    unit: 'K',
    higherIs: 'mixed',
    description: 'تغییر اشتغال غیرکشاورزی (هزار نفر)'
  },
  {
    id: 'dxy',
    nameFa: 'شاخص دلار',
    nameEn: 'DXY / US Dollar Index',
    unit: 'index',
    higherIs: 'mixed',
    description: 'قدرت دلار آمریکا'
  },
  {
    id: 'us10y',
    nameFa: 'بازده اوراق ۱۰ ساله',
    nameEn: 'US 10-Year Treasury Yield',
    unit: '%',
    higherIs: 'mixed',
    description: 'بازده اوراق خزانه‌داری ۱۰ ساله آمریکا'
  }
]);

export const FUND_VAR_IDS = Object.freeze(FUND_VARS.map(v => v.id));

/**
 * Asset-aware weight vectors (sum to 1.0).
 */
const ASSET_WEIGHTS = Object.freeze({
  XAUUSD: Object.freeze({
    fed_funds: 0.22,
    cpi: 0.15,
    nfp: 0.08,
    dxy: 0.30,
    us10y: 0.25
  }),
  BRENT: Object.freeze({
    fed_funds: 0.18,
    cpi: 0.12,
    nfp: 0.22,
    dxy: 0.28,
    us10y: 0.20
  }),
  USDEUR: Object.freeze({
    fed_funds: 0.25,
    cpi: 0.18,
    nfp: 0.20,
    dxy: 0.22,
    us10y: 0.15
  }),
  DEFAULT: Object.freeze({
    fed_funds: 0.20,
    cpi: 0.15,
    nfp: 0.15,
    dxy: 0.30,
    us10y: 0.20
  })
});

/**
 * Direction of each variable's impact on the asset price.
 * +1 = higher indicator value is bullish for the asset
 * -1 = higher value is bearish
 */
const IMPACT_SIGN = Object.freeze({
  XAUUSD: Object.freeze({
    fed_funds: -1,
    cpi: 0.4,
    nfp: -0.3,
    dxy: -1,
    us10y: -1
  }),
  BRENT: Object.freeze({
    fed_funds: -0.7,
    cpi: -0.2,
    nfp: 0.8,
    dxy: -1,
    us10y: -0.6
  }),
  USDEUR: Object.freeze({
    fed_funds: 1,
    cpi: 0.6,
    nfp: 0.9,
    dxy: 1,
    us10y: 0.8
  }),
  DEFAULT: Object.freeze({
    fed_funds: -0.5,
    cpi: 0,
    nfp: 0.3,
    dxy: -0.8,
    us10y: -0.5
  })
});

function getWeights(symbolId) {
  const key = String(symbolId || '').toUpperCase();
  return ASSET_WEIGHTS[key] || ASSET_WEIGHTS.DEFAULT;
}

function getImpact(symbolId) {
  const key = String(symbolId || '').toUpperCase();
  return IMPACT_SIGN[key] || IMPACT_SIGN.DEFAULT;
}

const FUND_STORE = 'fundamental_data';

export function loadFundamentalStore() {
  return loadJSON(FUND_STORE, {}) || {};
}

export function saveFundamentalStore(store) {
  return saveJSON(FUND_STORE, store);
}

export function getFundamentalData(symbolId) {
  const store = loadFundamentalStore();
  const key = String(symbolId || '').toUpperCase();
  return store[key] || {};
}

export function upsertFundamentalVar(symbolId, varId, payload) {
  if (!FUND_VAR_IDS.includes(varId)) {
    return { ok: false, error: 'متغیر فاندامنتال نامعتبر است.' };
  }
  const key = String(symbolId || '').toUpperCase();
  if (!key) return { ok: false, error: 'نماد مشخص نیست.' };

  const actual = payload.actual != null && payload.actual !== '' ? Number(payload.actual) : null;
  const forecast = payload.forecast != null && payload.forecast !== '' ? Number(payload.forecast) : null;
  const previous = payload.previous != null && payload.previous !== '' ? Number(payload.previous) : null;
  const date = payload.date ? String(payload.date).slice(0, 10) : null;

  if (actual != null && !Number.isFinite(actual)) {
    return { ok: false, error: 'مقدار Actual باید عدد معتبر باشد.' };
  }
  if (forecast != null && !Number.isFinite(forecast)) {
    return { ok: false, error: 'مقدار Forecast باید عدد معتبر باشد.' };
  }
  if (previous != null && !Number.isFinite(previous)) {
    return { ok: false, error: 'مقدار Previous باید عدد معتبر باشد.' };
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'تاریخ باید به صورت YYYY-MM-DD باشد.' };
  }

  let change = null;
  let surprise = null;
  if (actual != null && previous != null) change = actual - previous;
  if (actual != null && forecast != null) surprise = actual - forecast;

  const store = loadFundamentalStore();
  if (!store[key]) store[key] = {};
  store[key][varId] = {
    actual,
    forecast,
    previous,
    date,
    change,
    surprise,
    updatedAt: Date.now()
  };
  saveFundamentalStore(store);
  return { ok: true, record: store[key][varId] };
}

export function clearFundamentalVar(symbolId, varId = null) {
  const key = String(symbolId || '').toUpperCase();
  const store = loadFundamentalStore();
  if (!store[key]) return { ok: true };
  if (varId) {
    delete store[key][varId];
  } else {
    delete store[key];
  }
  saveFundamentalStore(store);
  return { ok: true };
}

function computeImpulse(varId, rec) {
  if (!rec) return null;
  const { actual, forecast, previous, surprise, change } = rec;

  if (surprise != null && Number.isFinite(surprise)) {
    const scale = {
      fed_funds: 0.25,
      cpi: 0.3,
      nfp: 50,
      dxy: 0.8,
      us10y: 0.15
    }[varId] || 1;
    const raw = surprise / scale;
    return Math.max(-1, Math.min(1, raw));
  }

  if (change != null && Number.isFinite(change)) {
    const scale = {
      fed_funds: 0.25,
      cpi: 0.4,
      nfp: 80,
      dxy: 1.0,
      us10y: 0.20
    }[varId] || 1;
    const raw = change / scale;
    return Math.max(-1, Math.min(1, raw));
  }

  if (actual != null) return 0;
  return null;
}

/**
 * Core fundamental scoring.
 */
export function runFundamental(symbolId, snapshot = null) {
  const meta = getSymbol(symbolId);
  const weights = getWeights(symbolId);
  const impact = getImpact(symbolId);

  let data = {};
  if (snapshot && typeof snapshot === 'object' && Object.keys(snapshot).length) {
    for (const id of FUND_VAR_IDS) {
      if (!(id in snapshot)) continue;
      const v = snapshot[id];
      if (v && typeof v === 'object') {
        data[id] = v;
      } else if (Number.isFinite(Number(v))) {
        data[id] = { _legacyImpulse: Math.max(-2, Math.min(2, Number(v))) / 2 };
      }
    }
  } else {
    data = getFundamentalData(symbolId);
  }

  const factors = [];
  let weightedSum = 0;
  let weightUsed = 0;
  let anyData = false;

  for (const id of FUND_VAR_IDS) {
    const rec = data[id];
    if (!rec) continue;

    let impulse = null;
    if (rec._legacyImpulse != null) {
      impulse = rec._legacyImpulse;
    } else {
      impulse = computeImpulse(id, rec);
    }
    if (impulse == null || !Number.isFinite(impulse)) continue;

    anyData = true;
    const w = weights[id] || 0;
    const sign = impact[id] != null ? impact[id] : 0;
    const contrib = w * sign * impulse;
    weightedSum += contrib;
    weightUsed += Math.abs(w * (sign !== 0 ? 1 : 0.3));

    const dir = contrib > 0.02 ? 'bull' : contrib < -0.02 ? 'bear' : 'neutral';
    const varMeta = FUND_VARS.find(v => v.id === id);
    factors.push({
      key: id,
      nameFa: varMeta ? varMeta.nameFa : id,
      nameEn: varMeta ? varMeta.nameEn : id,
      impulse: Math.round(impulse * 100) / 100,
      weight: w,
      sign,
      contribution: Math.round(contrib * 1000) / 1000,
      dir,
      actual: rec.actual ?? null,
      forecast: rec.forecast ?? null,
      previous: rec.previous ?? null,
      surprise: rec.surprise ?? null,
      change: rec.change ?? null,
      date: rec.date ?? null
    });
  }

  if (!anyData || weightUsed < 0.05) {
    return {
      ok: false,
      status: 'insufficient_data',
      message: 'داده فاندامنتال کافی نیست. مقادیر Actual / Forecast / Previous را وارد کنید.',
      score: null,
      factors: [],
      coverage: 0,
      outlook: 'neutral',
      asset: meta ? meta.symbol : symbolId,
      weights,
      schema: FUND_VAR_IDS
    };
  }

  const norm = weightUsed > 0 ? weightedSum / weightUsed : 0;
  const score = Math.round(Math.max(0, Math.min(100, 50 + norm * 45)));

  let outlook = 'neutral';
  if (score >= 62) outlook = 'bullish';
  else if (score <= 38) outlook = 'bearish';
  else if (score >= 55) outlook = 'mild_bullish';
  else if (score <= 45) outlook = 'mild_bearish';

  return {
    ok: true,
    status: 'ok',
    message: null,
    score,
    factors,
    coverage: factors.length / FUND_VAR_IDS.length,
    outlook,
    asset: meta ? meta.symbol : symbolId,
    weights,
    schema: FUND_VAR_IDS,
    weightedSum: Math.round(weightedSum * 1000) / 1000,
    weightUsed: Math.round(weightUsed * 1000) / 1000
  };
}

export function buildSnapshotFromStore(symbolId) {
  return getFundamentalData(symbolId);
}

export function fundamentalSummaryFa(fund) {
  if (!fund || !fund.ok) {
    return fund?.message || 'داده فاندامنتال کافی نیست.';
  }
  const map = {
    bullish: 'چشم‌انداز فاندامنتال صعودی',
    mild_bullish: 'چشم‌انداز فاندامنتال نسبتاً صعودی',
    neutral: 'چشم‌انداز فاندامنتال خنثی',
    mild_bearish: 'چشم‌انداز فاندامنتال نسبتاً نزولی',
    bearish: 'چشم‌انداز فاندامنتال نزولی'
  };
  const top = [...(fund.factors || [])]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 2)
    .map(f => `${f.nameFa} (${f.dir === 'bull' ? 'مثبت' : f.dir === 'bear' ? 'منفی' : 'خنثی'})`)
    .join('، ');
  return `${map[fund.outlook] || map.neutral} · امتیاز ${fund.score}` + (top ? ` · محرک‌ها: ${top}` : '');
}
