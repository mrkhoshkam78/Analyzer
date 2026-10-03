/**
 * Data Provider — فقط منبع دستی (CSV/چسباندن). کاملاً آفلاین.
 */
export const ProviderType = Object.freeze({
  MANUAL: 'manual'
});

export function validateCandles(candles) {
  const issues = [];
  if (!candles || !candles.length) {
    return { ok: false, issues: ['empty'], validCount: 0, dataAgeMs: null };
  }
  let valid = 0;
  let outliers = 0;
  const closes = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const ok = [c.o, c.h, c.l, c.c].every(x => typeof x === 'number' && Number.isFinite(x) && x > 0) && c.h >= c.l;
    if (!ok) continue;
    valid++;
    if (closes.length && Math.abs(c.c - closes[closes.length - 1]) / closes[closes.length - 1] > 0.25) {
      outliers++;
    }
    closes.push(c.c);
  }
  if (valid < candles.length) issues.push('invalid_rows');
  if (outliers > 0) issues.push('possible_outliers');
  return {
    ok: valid > 0,
    issues,
    validCount: valid,
    outlierHints: outliers,
    source: ProviderType.MANUAL,
    isRealtime: false,
    dataAgeMs: null
  };
}

export function createManualProvider(text, parseFn) {
  return {
    type: ProviderType.MANUAL,
    isRealtime: false,
    async fetchOHLCV() {
      const { candles, error } = parseFn(text || '');
      const validation = validateCandles(candles);
      return { candles, error, validation };
    }
  };
}
