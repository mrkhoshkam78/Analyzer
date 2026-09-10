/**
 * Offline Symbol Registry V5.01
 * Built-in + user custom assets. Categories: metals, forex, stocks.
 */

const CUSTOM_KEY = 'oma_v5_custom_assets';

export const CATEGORIES = Object.freeze({
  metals: { id: 'metals', nameFa: 'فلزات' },
  forex: { id: 'forex', nameFa: 'فارکس' },
  stocks: { id: 'stocks', nameFa: 'بورس' },
  commodity: { id: 'commodity', nameFa: 'کالا' }
});

const BUILTIN = {
  XAUUSD: {
    id: 'XAUUSD', symbol: 'XAUUSD', nameFa: 'طلا (انس دلار)', nameEn: 'Gold / USD',
    type: 'commodity', category: 'metals', typeFa: 'فلزات',
    unit: 'USD/oz', unitFa: 'دلار / اونس', decimals: 2,
    volatilityHighPct: 2.5, volatilityLowPct: 0.6,
    descriptionFa: 'قیمت جهانی طلا بر حسب دلار آمریکا', builtin: true
  },
  USDEUR: {
    id: 'USDEUR', symbol: 'USDEUR', nameFa: 'دلار / یورو', nameEn: 'USD / EUR',
    type: 'forex', category: 'forex', typeFa: 'فارکس',
    unit: 'EUR per USD', unitFa: 'یورو به ازای هر دلار', decimals: 5,
    volatilityHighPct: 1.2, volatilityLowPct: 0.25,
    descriptionFa: 'نرخ تبدیل دلار آمریکا به یورو', builtin: true
  },
  BRENT: {
    id: 'BRENT', symbol: 'BRENT', nameFa: 'نفت برنت', nameEn: 'Brent Crude',
    type: 'commodity', category: 'commodity', typeFa: 'کالا',
    unit: 'USD/bbl', unitFa: 'دلار / بشکه', decimals: 2,
    volatilityHighPct: 3.5, volatilityLowPct: 0.8,
    descriptionFa: 'قیمت نفت خام برنت بر حسب دلار', builtin: true
  }
};

function loadCustom() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function saveCustom(map) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

function registry() {
  return { ...BUILTIN, ...loadCustom() };
}

export const SYMBOLS = BUILTIN; // frozen builtins for backward compat

export function getAllSymbols() {
  return Object.values(registry()).map(s => Object.freeze({ ...s }));
}

export const SYMBOL_LIST = Object.freeze(Object.keys(BUILTIN));

export function getSymbol(id) {
  if (!id) return null;
  const key = String(id).trim().toUpperCase();
  return registry()[key] || null;
}

export function isAllowedSymbol(id) {
  return getSymbol(id) != null;
}

export function registerCustomAsset(meta) {
  const symbol = String(meta.symbol || meta.id || '').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{2,16}$/.test(symbol)) {
    return { ok: false, error: 'نماد باید ۲ تا ۱۶ کاراکتر لاتین/عدد باشد.' };
  }
  if (BUILTIN[symbol]) {
    return { ok: false, error: 'این نماد از پیش تعریف‌شده است.' };
  }
  const category = ['metals', 'forex', 'stocks', 'commodity'].includes(meta.category)
    ? meta.category
    : 'stocks';
  const catFa = CATEGORIES[category]?.nameFa || 'سایر';
  const entry = {
    id: symbol,
    symbol,
    nameFa: String(meta.nameFa || symbol).slice(0, 40),
    nameEn: String(meta.nameEn || symbol).slice(0, 40),
    type: category === 'forex' ? 'forex' : category === 'metals' ? 'commodity' : 'stock',
    category,
    typeFa: catFa,
    unit: String(meta.unit || 'USD').slice(0, 20),
    unitFa: String(meta.unitFa || meta.unit || 'واحد').slice(0, 30),
    decimals: Number.isFinite(+meta.decimals) ? Math.min(8, Math.max(0, +meta.decimals)) : 2,
    descriptionFa: String(meta.descriptionFa || '').slice(0, 80),
    builtin: false
  };
  const map = loadCustom();
  map[symbol] = entry;
  saveCustom(map);
  return { ok: true, asset: entry };
}

export function formatPrice(value, symbolId) {
  if (value == null || !Number.isFinite(value)) return '—';
  const meta = getSymbol(symbolId);
  const d = meta ? meta.decimals : 2;
  return value.toLocaleString('fa-IR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
}
