/**
 * MPB Pattern Memory — persistent library in localStorage + JSON export/import
 * Patterns are never fabricated; only stored after a real MPB run.
 */
const PREFIX = 'oma_mpb_patterns_v1';
const MAX_PATTERNS = 200;

function key(symbol, timeframe) {
  return `${PREFIX}_${String(symbol || 'ALL').toUpperCase()}_${String(timeframe || 'ALL')}`;
}

function readAll() {
  try {
    const raw = localStorage.getItem(PREFIX + '_index');
    if (!raw) return { version: 1, items: [] };
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.items)) return { version: 1, items: [] };
    return obj;
  } catch {
    return { version: 1, items: [] };
  }
}

function writeAll(store) {
  try {
    localStorage.setItem(PREFIX + '_index', JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/**
 * Save a pattern snapshot from an MPB result.
 * @returns {{ ok: boolean, id: string|null, total: number }}
 */
export function savePatternFromResult(mpbResult, meta = {}) {
  if (!mpbResult || mpbResult.status === 'ERROR') {
    return { ok: false, id: null, total: readAll().items.length };
  }
  const store = readAll();
  const id = `P_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const ap = mpbResult.activePatterns?.[0] || {};
  const item = {
    id,
    savedAt: new Date().toISOString(),
    symbol: mpbResult.symbol || meta.symbol || 'UNKNOWN',
    timeframe: mpbResult.timeframe || meta.timeframe || '1D',
    status: mpbResult.status || 'OK',
    patternId: ap.id || null,
    patternLabel: ap.label || null,
    similarity: ap.similarity ?? null,
    regime: mpbResult.regime?.primary || null,
    confidence: mpbResult.confidence?.overall ?? null,
    confidenceLabel: mpbResult.confidence?.label || null,
    dataQuality: mpbResult.dataQuality?.score ?? null,
    dna: ap.dna || null,
    metaPatterns: mpbResult.metaPatterns || null,
    outcomes: mpbResult.outcomes || null,
    evidence: (mpbResult.evidence || []).slice(0, 12),
    contradictions: (mpbResult.contradictions || []).slice(0, 12),
    reasoningTrace: (mpbResult.reasoningTrace || []).slice(0, 8),
    historicalMatchCount: (mpbResult.historicalMatches || []).length,
    validation: mpbResult.validation || null
  };
  store.items.unshift(item);
  if (store.items.length > MAX_PATTERNS) store.items = store.items.slice(0, MAX_PATTERNS);
  writeAll(store);
  // also keep last-per-symbol key for quick restore
  try {
    localStorage.setItem(key(item.symbol, item.timeframe), JSON.stringify(item));
  } catch { /* ignore quota */ }
  return { ok: true, id, total: store.items.length };
}

export function listPatterns(filter = {}) {
  const store = readAll();
  let items = store.items;
  if (filter.symbol) {
    const s = String(filter.symbol).toUpperCase();
    items = items.filter(x => String(x.symbol).toUpperCase() === s);
  }
  if (filter.timeframe) {
    items = items.filter(x => x.timeframe === filter.timeframe);
  }
  return items;
}

export function getPattern(id) {
  return readAll().items.find(x => x.id === id) || null;
}

export function deletePattern(id) {
  const store = readAll();
  const next = store.items.filter(x => x.id !== id);
  store.items = next;
  writeAll(store);
  return next.length;
}

export function clearAllPatterns() {
  writeAll({ version: 1, items: [] });
  return true;
}

/**
 * Export full library as downloadable JSON string.
 */
export function exportPatternsJSON(filter = {}) {
  const items = listPatterns(filter);
  return JSON.stringify({
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    count: items.length,
    items
  }, null, 2);
}

/**
 * Import patterns from JSON string (merge by id, skip duplicates).
 */
export function importPatternsJSON(jsonText) {
  let data;
  try {
    data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  } catch {
    return { ok: false, error: 'فایل JSON نامعتبر است', added: 0 };
  }
  const incoming = Array.isArray(data) ? data : (data.items || []);
  if (!Array.isArray(incoming) || !incoming.length) {
    return { ok: false, error: 'هیچ الگویی در فایل نیست', added: 0 };
  }
  const store = readAll();
  const existing = new Set(store.items.map(x => x.id));
  let added = 0;
  for (const item of incoming) {
    if (!item || typeof item !== 'object') continue;
    const id = item.id || `P_imp_${Date.now().toString(36)}_${added}`;
    if (existing.has(id)) continue;
    store.items.unshift({ ...item, id, importedAt: new Date().toISOString() });
    existing.add(id);
    added++;
  }
  if (store.items.length > MAX_PATTERNS) store.items = store.items.slice(0, MAX_PATTERNS);
  writeAll(store);
  return { ok: true, added, total: store.items.length };
}

export function patternMemoryStats() {
  const items = readAll().items;
  return {
    total: items.length,
    bySymbol: items.reduce((acc, x) => {
      const s = x.symbol || '?';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {})
  };
}
