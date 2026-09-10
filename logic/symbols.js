/**
 * Offline Symbol Registry
 * Only these three assets are allowed. No online API.
 * Extensible: add a new entry here to support another symbol later.
 */

export const SYMBOLS = Object.freeze({
  XAUUSD: Object.freeze({
    id: 'XAUUSD',
    symbol: 'XAUUSD',
    nameFa: 'طلا (انس دلار)',
    nameEn: 'Gold / USD',
    type: 'commodity',
    typeFa: 'کالا',
    unit: 'USD/oz',
    unitFa: 'دلار / اونس',
    decimals: 2,
    // Optional per-asset analysis hints (engine still uses shared indicators)
    volatilityHighPct: 2.5,
    volatilityLowPct: 0.6,
    descriptionFa: 'قیمت جهانی طلا بر حسب دلار آمریکا'
  }),
  USDEUR: Object.freeze({
    id: 'USDEUR',
    symbol: 'USDEUR',
    nameFa: 'دلار / یورو',
    nameEn: 'USD / EUR',
    type: 'forex',
    typeFa: 'فارکس',
    unit: 'EUR per USD',
    unitFa: 'یورو به ازای هر دلار',
    decimals: 5,
    volatilityHighPct: 1.2,
    volatilityLowPct: 0.25,
    descriptionFa: 'نرخ تبدیل دلار آمریکا به یورو'
  }),
  BRENT: Object.freeze({
    id: 'BRENT',
    symbol: 'BRENT',
    nameFa: 'نفت برنت',
    nameEn: 'Brent Crude',
    type: 'commodity',
    typeFa: 'کالا',
    unit: 'USD/bbl',
    unitFa: 'دلار / بشکه',
    decimals: 2,
    volatilityHighPct: 3.5,
    volatilityLowPct: 0.8,
    descriptionFa: 'قیمت نفت خام برنت بر حسب دلار'
  })
});

export const SYMBOL_LIST = Object.freeze(
  Object.values(SYMBOLS).map(s => s.symbol)
);

export function getSymbol(id) {
  if (!id) return null;
  const key = String(id).trim().toUpperCase();
  return SYMBOLS[key] || null;
}

export function isAllowedSymbol(id) {
  return getSymbol(id) != null;
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
