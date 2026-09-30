/**
 * Fundamental Analysis Engine V6.0 (Analyzer v11.0.1)
 * Offline-only · Asset-specific drivers · History + Surprise Z · Regime-aware weights
 * No external API dependency.
 */
import { getSymbol } from './symbols.js';
import { loadJSON, saveJSON } from './storage.js';

/** Core US macro (always available for all assets) */
export const FUND_VARS_CORE = Object.freeze([
  {
    id: 'fed_funds',
    nameFa: 'نرخ بهره فدرال',
    nameEn: 'US Federal Funds Rate',
    unit: '%',
    higherIs: 'mixed',
    description: 'نرخ بهره معیار فدرال رزرو',
    scaleSurprise: 0.25,
    scaleChange: 0.25
  },
  {
    id: 'cpi',
    nameFa: 'تورم / CPI',
    nameEn: 'US CPI / Inflation',
    unit: '% YoY',
    higherIs: 'mixed',
    description: 'شاخص قیمت مصرف‌کننده آمریکا',
    scaleSurprise: 0.3,
    scaleChange: 0.4
  },
  {
    id: 'nfp',
    nameFa: 'اشتغال غیرکشاورزی',
    nameEn: 'US Non-Farm Payrolls',
    unit: 'K',
    higherIs: 'mixed',
    description: 'تغییر اشتغال غیرکشاورزی (هزار نفر)',
    scaleSurprise: 50,
    scaleChange: 80
  },
  {
    id: 'dxy',
    nameFa: 'شاخص دلار',
    nameEn: 'DXY / US Dollar Index',
    unit: 'index',
    higherIs: 'mixed',
    description: 'قدرت دلار آمریکا',
    scaleSurprise: 0.8,
    scaleChange: 1.0
  },
  {
    id: 'us10y',
    nameFa: 'بازده اوراق ۱۰ ساله',
    nameEn: 'US 10-Year Treasury Yield',
    unit: '%',
    higherIs: 'mixed',
    description: 'بازده اوراق خزانه‌داری ۱۰ ساله آمریکا',
    scaleSurprise: 0.15,
    scaleChange: 0.2
  }
]);

/** Asset-specific optional drivers (manual offline entry) */
export const FUND_VARS_ASSET = Object.freeze({
  XAUUSD: Object.freeze([
    {
      id: 'real_yield',
      nameFa: 'بازده واقعی ۱۰ساله',
      nameEn: 'US 10Y Real Yield',
      unit: '%',
      higherIs: 'bearish_for_gold',
      description: 'بازده واقعی اوراق (تقریبی: اسمی − تورم انتظاری)',
      scaleSurprise: 0.15,
      scaleChange: 0.2
    },
    {
      id: 'vix',
      nameFa: 'شاخص ترس (VIX)',
      nameEn: 'VIX',
      unit: 'index',
      higherIs: 'bullish_for_gold',
      description: 'نوسان ضمنی سهام آمریکا',
      scaleSurprise: 2.5,
      scaleChange: 3.0
    },
    {
      id: 'geo_risk',
      nameFa: 'ریسک ژئوپلیتیک',
      nameEn: 'Geopolitical Risk Score',
      unit: '0–10',
      higherIs: 'bullish_for_gold',
      description: 'امتیاز دستی تنش‌های ژئوپلیتیک (۰ آرام، ۱۰ بحرانی)',
      scaleSurprise: 1.0,
      scaleChange: 1.5
    }
  ]),
  BRENT: Object.freeze([
    {
      id: 'opec_prod',
      nameFa: 'تولید اوپک',
      nameEn: 'OPEC Production',
      unit: 'mb/d',
      higherIs: 'bearish_for_oil',
      description: 'تولید روزانه اوپک (میلیون بشکه)',
      scaleSurprise: 0.3,
      scaleChange: 0.4
    },
    {
      id: 'us_inventory',
      nameFa: 'موجودی نفت آمریکا',
      nameEn: 'US Crude Inventories',
      unit: 'M bbl',
      higherIs: 'bearish_for_oil',
      description: 'تغییر موجودی نفت خام آمریکا',
      scaleSurprise: 2.5,
      scaleChange: 3.0
    },
    {
      id: 'china_pmi',
      nameFa: 'PMI چین',
      nameEn: 'China PMI',
      unit: 'index',
      higherIs: 'bullish_for_oil',
      description: 'شاخص مدیران خرید چین (تقاضای صنعتی)',
      scaleSurprise: 1.0,
      scaleChange: 1.2
    }
  ]),
  USDEUR: Object.freeze([
    {
      id: 'ecb_rate',
      nameFa: 'نرخ بهره ECB',
      nameEn: 'ECB Deposit Rate',
      unit: '%',
      higherIs: 'bearish_for_usdeur',
      description: 'نرخ سپرده بانک مرکزی اروپا',
      scaleSurprise: 0.25,
      scaleChange: 0.25
    },
    {
      id: 'eur_cpi',
      nameFa: 'تورم منطقه یورو',
      nameEn: 'Eurozone CPI',
      unit: '% YoY',
      higherIs: 'bearish_for_usdeur',
      description: 'تورم مصرف‌کننده منطقه یورو',
      scaleSurprise: 0.3,
      scaleChange: 0.4
    }
  ])
});

export const FUND_VARS = Object.freeze([
  ...FUND_VARS_CORE,
  ...Object.values(FUND_VARS_ASSET).flat()
]);

export const FUND_VAR_IDS = Object.freeze(FUND_VARS.map(v => v.id));

const ASSET_WEIGHTS_CORE = Object.freeze({
  XAUUSD: Object.freeze({
    fed_funds: 0.18, cpi: 0.12, nfp: 0.06, dxy: 0.26, us10y: 0.18,
    real_yield: 0.12, vix: 0.05, geo_risk: 0.03
  }),
  BRENT: Object.freeze({
    fed_funds: 0.12, cpi: 0.08, nfp: 0.14, dxy: 0.20, us10y: 0.12,
    opec_prod: 0.14, us_inventory: 0.12, china_pmi: 0.08
  }),
  USDEUR: Object.freeze({
    fed_funds: 0.20, cpi: 0.12, nfp: 0.14, dxy: 0.18, us10y: 0.10,
    ecb_rate: 0.16, eur_cpi: 0.10
  }),
  DEFAULT: Object.freeze({
    fed_funds: 0.20, cpi: 0.15, nfp: 0.15, dxy: 0.30, us10y: 0.20
  })
});

const IMPACT_SIGN = Object.freeze({
  XAUUSD: Object.freeze({
    fed_funds: -1, cpi: 0.35, nfp: -0.25, dxy: -1, us10y: -0.9,
    real_yield: -1, vix: 0.7, geo_risk: 0.85
  }),
  BRENT: Object.freeze({
    fed_funds: -0.65, cpi: -0.15, nfp: 0.75, dxy: -1, us10y: -0.5,
    opec_prod: -0.9, us_inventory: -0.85, china_pmi: 0.8
  }),
  USDEUR: Object.freeze({
    fed_funds: 1, cpi: 0.55, nfp: 0.85, dxy: 1, us10y: 0.7,
    ecb_rate: -0.9, eur_cpi: -0.55
  }),
  DEFAULT: Object.freeze({
    fed_funds: -0.5, cpi: 0, nfp: 0.3, dxy: -0.8, us10y: -0.5
  })
});

const REGIME_WEIGHT_BIAS = Object.freeze({
  'Trending Bullish': { growth: 1.15, defensive: 0.9, dollar: 0.95 },
  'Trending Bearish': { growth: 0.9, defensive: 1.15, dollar: 1.1 },
  Range: { growth: 1.0, defensive: 1.0, dollar: 1.0 },
  'High Volatility': { growth: 0.85, defensive: 1.2, dollar: 1.15 },
  'Low Volatility': { growth: 1.05, defensive: 0.95, dollar: 0.95 },
  Breakout: { growth: 1.1, defensive: 0.95, dollar: 1.0 },
  Unclear: { growth: 1.0, defensive: 1.0, dollar: 1.0 }
});

const VAR_REGIME_BUCKET = Object.freeze({
  nfp: 'growth', china_pmi: 'growth', opec_prod: 'growth', us_inventory: 'growth',
  fed_funds: 'defensive', us10y: 'defensive', real_yield: 'defensive', vix: 'defensive', geo_risk: 'defensive',
  dxy: 'dollar', cpi: 'defensive', ecb_rate: 'defensive', eur_cpi: 'defensive'
});

const HISTORY_MAX = 12;
const FUND_STORE = 'fundamental_data_v6';
const FUND_HISTORY = 'fundamental_history_v6';

function getWeightsBase(symbolId) {
  const key = String(symbolId || '').toUpperCase();
  return { ...(ASSET_WEIGHTS_CORE[key] || ASSET_WEIGHTS_CORE.DEFAULT) };
}

function getImpact(symbolId) {
  const key = String(symbolId || '').toUpperCase();
  return IMPACT_SIGN[key] || IMPACT_SIGN.DEFAULT;
}

export function getSchemaForSymbol(symbolId) {
  const key = String(symbolId || '').toUpperCase();
  const extra = FUND_VARS_ASSET[key] || [];
  return Object.freeze([...FUND_VARS_CORE, ...extra]);
}

export function getVarMeta(varId) {
  return FUND_VARS.find(v => v.id === varId) || null;
}

export function loadFundamentalStore() {
  return loadJSON(FUND_STORE, {}) || {};
}

export function saveFundamentalStore(store) {
  return saveJSON(FUND_STORE, store);
}

function loadHistoryStore() {
  return loadJSON(FUND_HISTORY, {}) || {};
}

function saveHistoryStore(store) {
  return saveJSON(FUND_HISTORY, store);
}

export function getFundamentalData(symbolId) {
  const store = loadFundamentalStore();
  const key = String(symbolId || '').toUpperCase();
  return store[key] || {};
}

export function getFundamentalHistory(symbolId, varId) {
  const store = loadHistoryStore();
  const key = String(symbolId || '').toUpperCase();
  const sym = store[key] || {};
  if (varId) return Array.isArray(sym[varId]) ? sym[varId] : [];
  return sym;
}

function pushHistory(symbolId, varId, record) {
  const store = loadHistoryStore();
  const key = String(symbolId || '').toUpperCase();
  if (!store[key]) store[key] = {};
  if (!Array.isArray(store[key][varId])) store[key][varId] = [];
  const arr = store[key][varId];
  arr.unshift({
    actual: record.actual,
    forecast: record.forecast,
    previous: record.previous,
    surprise: record.surprise,
    change: record.change,
    date: record.date,
    updatedAt: record.updatedAt
  });
  if (arr.length > HISTORY_MAX) arr.length = HISTORY_MAX;
  store[key][varId] = arr;
  saveHistoryStore(store);
}

export function surpriseZScore(symbolId, varId, currentSurprise) {
  if (currentSurprise == null || !Number.isFinite(currentSurprise)) return null;
  const hist = getFundamentalHistory(symbolId, varId);
  const surprises = hist
    .map(h => h.surprise)
    .filter(s => s != null && Number.isFinite(s));
  if (surprises.length < 3) return null;
  const mean = surprises.reduce((a, b) => a + b, 0) / surprises.length;
  const variance = surprises.reduce((a, b) => a + (b - mean) ** 2, 0) / surprises.length;
  const sd = Math.sqrt(variance);
  if (sd < 1e-9) return 0;
  return (currentSurprise - mean) / sd;
}

export function getWeights(symbolId, regime = 'Unclear') {
  const base = getWeightsBase(symbolId);
  const bias = REGIME_WEIGHT_BIAS[regime] || REGIME_WEIGHT_BIAS.Unclear;
  const adjusted = {};
  let sum = 0;
  for (const [id, w] of Object.entries(base)) {
    const bucket = VAR_REGIME_BUCKET[id] || 'growth';
    const mult = bias[bucket] != null ? bias[bucket] : 1;
    adjusted[id] = w * mult;
    sum += adjusted[id];
  }
  if (sum > 0) {
    for (const id of Object.keys(adjusted)) adjusted[id] = adjusted[id] / sum;
  }
  return adjusted;
}

export function upsertFundamentalVar(symbolId, varId, payload) {
  if (!FUND_VAR_IDS.includes(varId)) {
    return { ok: false, error: 'متغیر فاندامنتال نامعتبر است.' };
  }
  const key = String(symbolId || '').toUpperCase();
  if (!key) return { ok: false, error: 'نماد مشخص نیست.' };

  const schemaIds = getSchemaForSymbol(key).map(v => v.id);
  if (!schemaIds.includes(varId)) {
    return { ok: false, error: 'این متغیر برای نماد انتخاب‌شده تعریف نشده است.' };
  }

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
  const record = {
    actual,
    forecast,
    previous,
    date,
    change,
    surprise,
    updatedAt: Date.now()
  };
  store[key][varId] = record;
  const saved = saveFundamentalStore(store);
  if (!saved) {
    return { ok: false, error: 'localStorage پر است یا در دسترس نیست — ذخیره نشد.' };
  }
  pushHistory(key, varId, record);
  // re-read to confirm
  const verify = getFundamentalData(key)[varId];
  if (!verify) {
    return { ok: false, error: 'ذخیره تأیید نشد. حافظه مرورگر را بررسی کنید.' };
  }
  return { ok: true, record: verify };
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

function computeImpulse(varId, rec, zScore) {
  if (!rec) return null;
  const meta = getVarMeta(varId);
  const scaleS = meta?.scaleSurprise || 1;
  const scaleC = meta?.scaleChange || 1;

  if (zScore != null && Number.isFinite(zScore)) {
    return Math.max(-1, Math.min(1, zScore / 2.5));
  }
  if (rec.surprise != null && Number.isFinite(rec.surprise)) {
    return Math.max(-1, Math.min(1, rec.surprise / scaleS));
  }
  if (rec.change != null && Number.isFinite(rec.change)) {
    return Math.max(-1, Math.min(1, rec.change / scaleC));
  }
  if (rec.actual != null) return 0;
  return null;
}

function freshnessScore(rec) {
  if (!rec?.updatedAt && !rec?.date) return 0.5;
  const now = Date.now();
  let ts = rec.updatedAt || null;
  if (!ts && rec.date) {
    const d = Date.parse(rec.date);
    if (Number.isFinite(d)) ts = d;
  }
  if (!ts) return 0.5;
  const ageDays = (now - ts) / (86400 * 1000);
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.85;
  if (ageDays <= 90) return 0.6;
  if (ageDays <= 180) return 0.4;
  return 0.25;
}

/**
 * Core fundamental scoring — offline, regime-aware, history-aware.
 */
export function runFundamental(symbolId, snapshot = undefined, options = {}) {
  const meta = getSymbol(symbolId);
  const regime = options.regime || 'Unclear';
  const weights = getWeights(symbolId, regime);
  const impact = getImpact(symbolId);
  const schema = getSchemaForSymbol(symbolId);
  const schemaIds = schema.map(v => v.id);

  let data = {};
  // snapshot with keys → use it
  // snapshot === undefined → load offline store (UI / live summary)
  // snapshot === null or {} → explicit empty (toggle OFF / pipeline disabled)
  if (snapshot && typeof snapshot === 'object' && Object.keys(snapshot).length) {
    for (const id of schemaIds) {
      if (!(id in snapshot)) continue;
      const v = snapshot[id];
      if (v && typeof v === 'object') {
        data[id] = v;
      } else if (Number.isFinite(Number(v))) {
        data[id] = { _legacyImpulse: Math.max(-2, Math.min(2, Number(v))) / 2 };
      }
    }
  } else if (snapshot === undefined && options.allowStore !== false) {
    data = getFundamentalData(symbolId);
  } else {
    data = {};
  }

  const factors = [];
  let weightedSum = 0;
  let weightUsed = 0;
  let anyData = false;
  let freshnessSum = 0;
  let freshnessN = 0;

  for (const id of schemaIds) {
    const rec = data[id];
    if (!rec) continue;

    let impulse = null;
    let z = null;
    if (rec._legacyImpulse != null) {
      impulse = rec._legacyImpulse;
    } else {
      z = surpriseZScore(symbolId, id, rec.surprise);
      impulse = computeImpulse(id, rec, z);
    }
    if (impulse == null || !Number.isFinite(impulse)) continue;

    anyData = true;
    const w = weights[id] || 0;
    const sign = impact[id] != null ? impact[id] : 0;
    const contrib = w * sign * impulse;
    weightedSum += contrib;
    weightUsed += Math.abs(w * (sign !== 0 ? 1 : 0.3));

    const fresh = freshnessScore(rec);
    freshnessSum += fresh;
    freshnessN += 1;

    const dir = contrib > 0.02 ? 'bull' : contrib < -0.02 ? 'bear' : 'neutral';
    const varMeta = getVarMeta(id);
    factors.push({
      key: id,
      nameFa: varMeta ? varMeta.nameFa : id,
      nameEn: varMeta ? varMeta.nameEn : id,
      impulse: Math.round(impulse * 100) / 100,
      weight: Math.round(w * 1000) / 1000,
      sign,
      contribution: Math.round(contrib * 1000) / 1000,
      dir,
      actual: rec.actual ?? null,
      forecast: rec.forecast ?? null,
      previous: rec.previous ?? null,
      surprise: rec.surprise ?? null,
      change: rec.change ?? null,
      surpriseZ: z != null ? Math.round(z * 100) / 100 : null,
      date: rec.date ?? null,
      freshness: Math.round(fresh * 100) / 100
    });
  }

  if (!anyData || weightUsed < 0.05) {
    return {
      ok: false,
      status: 'insufficient_data',
      message: 'داده بنیادی کافی نیست. مقادیر واقعی / پیش‌بینی / قبلی را وارد کنید.',
      score: null,
      factors: [],
      coverage: 0,
      outlook: 'neutral',
      asset: meta ? meta.symbol : symbolId,
      weights,
      schema: schemaIds,
      confidence: 0,
      regime
    };
  }

  const norm = weightUsed > 0 ? weightedSum / weightUsed : 0;
  const score = Math.round(Math.max(0, Math.min(100, 50 + norm * 45)));

  let outlook = 'neutral';
  if (score >= 62) outlook = 'bullish';
  else if (score <= 38) outlook = 'bearish';
  else if (score >= 55) outlook = 'mild_bullish';
  else if (score <= 45) outlook = 'mild_bearish';

  const coverage = factors.length / Math.max(1, schemaIds.length);
  const avgFresh = freshnessN > 0 ? freshnessSum / freshnessN : 0.5;
  const confidence = Math.round(
    Math.max(0.1, Math.min(0.92, coverage * 0.55 + avgFresh * 0.35 + (factors.length >= 4 ? 0.1 : 0))) * 100
  ) / 100;

  return {
    ok: true,
    status: 'ok',
    message: null,
    score,
    factors,
    coverage: Math.round(coverage * 100) / 100,
    outlook,
    asset: meta ? meta.symbol : symbolId,
    weights,
    schema: schemaIds,
    weightedSum: Math.round(weightedSum * 1000) / 1000,
    weightUsed: Math.round(weightUsed * 1000) / 1000,
    confidence,
    regime,
    version: 'v6.0'
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
    .slice(0, 3)
    .map(f => {
      const z = f.surpriseZ != null ? ` Z=${f.surpriseZ}` : '';
      return `${f.nameFa} (${f.dir === 'bull' ? 'مثبت' : f.dir === 'bear' ? 'منفی' : 'خنثی'}${z})`;
    })
    .join('، ');
  const conf = fund.confidence != null ? ` · اطمینان ${Math.round(fund.confidence * 100)}%` : '';
  return `${map[fund.outlook] || map.neutral} · امتیاز ${fund.score}${conf}` + (top ? ` · محرک‌ها: ${top}` : '');
}
