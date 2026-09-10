/**
 * Market Data layer — independent of Analysis Engine.
 * Frontend talks only to our backend proxy (never API Ninjas directly).
 */
import { loadJSON, saveJSON, saveMarketSnapshot, loadMarketSnapshots } from './storage.js';

const HISTORY_KEY = 'brent_quote_history';
const MAX_HISTORY = 200;
const DEFAULT_REFRESH_MS = 60_000;
const STALE_MS = 24 * 60 * 60 * 1000;

/** Central refresh controller (single timer) */
let refreshTimer = null;
let refreshListeners = new Set();

export function getBackendBase() {
  // Same origin by default; override with window.__OMA_API_BASE__
  if (typeof window !== 'undefined' && window.__OMA_API_BASE__) {
    return String(window.__OMA_API_BASE__).replace(/\/$/, '');
  }
  return '';
}

export async function fetchBrentQuote() {
  const base = getBackendBase();
  const url = `${base}/api/market/brent`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!body) {
    return {
      ok: false,
      error: 'parse_error',
      message: 'پاسخ سرور قابل خواندن نیست.',
      quote: null,
      usingCache: false
    };
  }

  if (body.ok && body.quote) {
    persistQuote(body.quote);
  } else if (body.quote && body.usingCache) {
    // keep cached quote visible
    persistQuote(body.quote, { fromCache: true });
  }

  return body;
}

function persistQuote(quote, meta = {}) {
  if (!quote || quote.symbol !== 'BRENT') return;
  saveMarketSnapshot('BRENT', {
    ...quote,
    connection: meta.fromCache ? 'cached' : 'live'
  });
  appendHistory(quote);
}

function appendHistory(quote) {
  const hist = loadJSON(HISTORY_KEY, []) || [];
  const last = hist[hist.length - 1];
  // Deduplicate identical timestamp+price
  if (last && last.timestamp === quote.timestamp && last.price === quote.price) {
    return;
  }
  hist.push({
    symbol: 'BRENT',
    price: quote.price,
    timestamp: quote.timestamp,
    fetchedAt: quote.fetchedAt || Date.now(),
    source: quote.source
  });
  while (hist.length > MAX_HISTORY) hist.shift();
  saveJSON(HISTORY_KEY, hist);
}

export function getBrentHistory() {
  return loadJSON(HISTORY_KEY, []) || [];
}

export function getLastBrentSnapshot() {
  const all = loadMarketSnapshots() || {};
  return all.BRENT || null;
}

export function isQuoteUsableForAnalysis(quote) {
  if (!quote || quote.price == null || quote.price <= 0) return false;
  if (quote.isStale) return false;
  if (quote.dataAge != null && quote.dataAge > STALE_MS) return false;
  return true;
}

/**
 * Single controlled refresh loop.
 */
export function startBrentRefresh(intervalMs = DEFAULT_REFRESH_MS, onUpdate) {
  stopBrentRefresh();
  if (typeof onUpdate === 'function') refreshListeners.add(onUpdate);

  const tick = async () => {
    try {
      const result = await fetchBrentQuote();
      for (const fn of refreshListeners) {
        try { fn(result); } catch (_) {}
      }
    } catch (err) {
      const fail = {
        ok: false,
        error: 'network_error',
        message: err && err.message ? err.message : 'خطای شبکه',
        quote: getLastBrentSnapshot(),
        usingCache: true
      };
      for (const fn of refreshListeners) {
        try { fn(fail); } catch (_) {}
      }
    }
  };

  tick();
  refreshTimer = setInterval(tick, intervalMs);
  return () => stopBrentRefresh();
}

export function stopBrentRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

export function subscribeBrent(fn) {
  refreshListeners.add(fn);
  return () => refreshListeners.delete(fn);
}

/** Provider adapter */
export function createBrentApiNinjasProvider() {
  return {
    type: 'brent_api_ninjas',
    symbol: 'BRENT',
    isRealtime: true,
    async fetchQuote() {
      return fetchBrentQuote();
    }
  };
}
