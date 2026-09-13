/**
 * Offline Market Analyst V6.05 — Fundamental Proxy Backend
 * Zero external npm deps (Node 18+ native fetch + http).
 * Token: process.env.EODHD_API_TOKEN only.
 */
import http from 'http';
import { URL } from 'url';

const PORT = Number(process.env.PORT) || 3847;
const TOKEN = process.env.EODHD_API_TOKEN || '';
const CACHE_TTL_MS = 45 * 60 * 1000;
const EODHD_BASE = 'https://eodhd.com/api';
const cache = new Map();

function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Content-Length': Buffer.byteLength(raw)
  });
  res.end(raw);
}

function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e.payload;
}
function cacheSet(key, payload) {
  cache.set(key, { ts: Date.now(), payload });
}

async function eodhdGet(path, params = {}) {
  if (!TOKEN) {
    const err = new Error('EODHD_API_TOKEN is not configured on the server');
    err.code = 'NO_TOKEN';
    throw err;
  }
  const qs = new URLSearchParams({ ...params, api_token: TOKEN, fmt: 'json' });
  const url = `${EODHD_BASE}${path}?${qs.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`EODHD HTTP ${res.status}: ${text.slice(0, 180)}`);
    err.code = 'EODHD_HTTP';
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchMacroSnapshot(symbol) {
  const cacheKey = `macro:USA:${String(symbol || '').toUpperCase()}`;
  const hit = cacheGet(cacheKey);
  if (hit) return { ...hit, _fromCache: true };

  const [inflation, realRate, events] = await Promise.all([
    eodhdGet('/macro-indicator/USA', { indicator: 'inflation_consumer_prices_annual' }).catch(() => null),
    eodhdGet('/macro-indicator/USA', { indicator: 'real_interest_rate' }).catch(() => null),
    eodhdGet('/economic-events', {
      from: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
      country: 'US',
      limit: 40
    }).catch(() => null)
  ]);

  const snapshot = {};

  const mapSeries = (arr, key) => {
    if (!Array.isArray(arr) || !arr.length) return;
    const sorted = [...arr].filter(x => x.Date && x.Value != null).sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
    if (!sorted.length) return;
    const last = sorted[sorted.length - 1];
    const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    snapshot[key] = {
      actual: Number(last.Value),
      previous: prev != null ? Number(prev.Value) : null,
      forecast: null,
      date: String(last.Date).slice(0, 10),
      change: prev != null ? Number(last.Value) - Number(prev.Value) : null,
      surprise: null,
      source: 'eodhd_macro'
    };
  };

  mapSeries(inflation, 'cpi');
  mapSeries(realRate, 'fed_funds');

  if (Array.isArray(events)) {
    const byType = (keywords) => {
      const matches = events.filter(e => {
        const name = String(e.event || e.type || e.Event || '').toLowerCase();
        return keywords.some(k => name.includes(k));
      });
      if (!matches.length) return null;
      matches.sort((a, b) => String(b.date || b.Date || '').localeCompare(String(a.date || a.Date || '')));
      const m = matches[0];
      const actual = m.actual != null ? Number(m.actual) : (m.Actual != null ? Number(m.Actual) : null);
      const forecast = m.estimate != null ? Number(m.estimate) : (m.Estimate != null ? Number(m.Estimate) : null);
      const previous = m.previous != null ? Number(m.previous) : (m.Previous != null ? Number(m.Previous) : null);
      if (actual == null && forecast == null && previous == null) return null;
      return {
        actual: Number.isFinite(actual) ? actual : null,
        forecast: Number.isFinite(forecast) ? forecast : null,
        previous: Number.isFinite(previous) ? previous : null,
        date: String(m.date || m.Date || '').slice(0, 10) || null,
        change: (Number.isFinite(actual) && Number.isFinite(previous)) ? actual - previous : null,
        surprise: (Number.isFinite(actual) && Number.isFinite(forecast)) ? actual - forecast : null,
        source: 'eodhd_events'
      };
    };
    const nfp = byType(['nonfarm', 'non-farm', 'payroll', 'nfp', 'employment change']);
    if (nfp) snapshot.nfp = nfp;
    const y10 = byType(['10-year', '10 year', '10y', 'treasury yield']);
    if (y10) snapshot.us10y = y10;
  }

  if (!Object.keys(snapshot).length) {
    const err = new Error('No usable fundamental data returned from EODHD');
    err.code = 'EMPTY_DATA';
    throw err;
  }

  const payload = {
    ok: true,
    symbol: String(symbol || '').toUpperCase() || null,
    snapshot,
    fetchedAt: new Date().toISOString(),
    sources: ['eodhd_macro', 'eodhd_events'],
    coverage: Object.keys(snapshot).length,
    _fromCache: false
  };
  cacheSet(cacheKey, payload);
  return payload;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept'
    });
    return res.end();
  }

  const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && u.pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      service: 'oma-fundamental-proxy',
      version: '6.05.0',
      tokenConfigured: Boolean(TOKEN),
      cacheEntries: cache.size
    });
  }

  if (req.method === 'GET' && u.pathname === '/api/fundamental') {
    const symbol = String(u.searchParams.get('symbol') || '').trim().toUpperCase();
    if (!symbol || symbol.length < 2) {
      return json(res, 400, { ok: false, error: 'پارامتر symbol الزامی است.', code: 'BAD_SYMBOL' });
    }
    if (!TOKEN) {
      return json(res, 503, {
        ok: false,
        error: 'سرور فاقد EODHD_API_TOKEN است. متغیر محیطی را تنظیم کنید.',
        code: 'NO_TOKEN'
      });
    }
    try {
      const data = await fetchMacroSnapshot(symbol);
      return json(res, 200, data);
    } catch (e) {
      const status = e.code === 'NO_TOKEN' ? 503
        : e.status === 401 || e.status === 403 ? 502
        : e.code === 'EMPTY_DATA' ? 422
        : 502;
      return json(res, status, {
        ok: false,
        error: e.message || 'خطا در دریافت داده فاندامنتال',
        code: e.code || 'EODHD_ERROR'
      });
    }
  }

  json(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OMA V6.05] Fundamental proxy http://0.0.0.0:${PORT}`);
  console.log(`[OMA V6.05] EODHD token configured: ${TOKEN ? 'yes' : 'NO — set EODHD_API_TOKEN'}`);
});
