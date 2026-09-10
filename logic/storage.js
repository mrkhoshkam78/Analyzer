/**
 * Local persistent storage — versioned, offline-safe
 */
const PREFIX = 'oma_v2_';
const VERSION = 2;

function key(name) {
  return PREFIX + name;
}

export function loadJSON(name, fallback = null) {
  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    if (obj && obj._v === VERSION) return obj.data;
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(name, data) {
  try {
    localStorage.setItem(key(name), JSON.stringify({ _v: VERSION, ts: Date.now(), data }));
    return true;
  } catch {
    return false;
  }
}

export function remove(name) {
  try { localStorage.removeItem(key(name)); } catch {}
}

// Domain helpers
export function loadPredictions() {
  return loadJSON('predictions', []) || [];
}

export function savePredictions(list) {
  return saveJSON('predictions', list);
}

export function loadLearningMetrics() {
  return loadJSON('learning', {
    bySymbol: {},
    global: { total: 0, correct: 0, wrong: 0, neutral: 0, insufficient: 0 }
  });
}

export function saveLearningMetrics(m) {
  return saveJSON('learning', m);
}

export function loadMarketSnapshots() {
  return loadJSON('market_snapshots', {});
}

export function saveMarketSnapshot(symbol, snapshot) {
  const all = loadMarketSnapshots() || {};
  all[symbol] = { ...snapshot, savedAt: Date.now() };
  return saveJSON('market_snapshots', all);
}
