/**
 * Offline Market Analyst V6.05 — Fundamental Proxy Backend + Static Server
 * Zero external npm deps (Node 18+ native fetch + http + fs).
 * Token: process.env.EODHD_API_TOKEN only.
 *
 * Works both when Root Directory = repo root OR Root Directory = server/
 */
import http from 'http';
import { URL } from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3847;
const TOKEN = process.env.EODHD_API_TOKEN || '';
const CACHE_TTL_MS = 45 * 60 * 1000;
const EODHD_BASE = 'https://eodhd.com/api';
const cache = new Map();

// Static root: prefer parent if index.html lives there (Render Root Directory = server/)
const parentDir = path.resolve(__dirname, '..');
const STATIC_ROOT = fs.existsSync(path.join(__dirname, 'index.html'))
  ? __dirname
  : (fs.existsSync(path.join(parentDir, 'index.html')) ? parentDir : __dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function getMimeType(filepath) {
  const ext = path.extname(filepath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

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

function serveFile(res, filepath) {
  try {
    const content = fs.readFileSync(filepath);
    const mimeType = getMimeType(filepath);
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': content.length,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': filepath.endsWith('.html') ? 'no-cache' : 'public, max-age=300'
    });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
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

async function eodhdGet(apiPath, params = {}) {
  if (!TOKEN) {
    const err = new Error('EODHD_API_TOKEN is not configured on the server');
    err.code = 'NO_TOKEN';
    throw err;
  }
  const qs = new URLSearchParams({ ...params, api_token: TOKEN, fmt: 'json' });
  const url = `${EODHD_BASE}${apiPath}?${qs.toString()}`;
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

/** Safe wrapper — returns { data, error } instead of throwing */
async function eodhdSafe(apiPath, params = {}) {
  try {
    const data = await eodhdGet(apiPath, params);
    return { data, error: null };
  } catch (e) {
    return {
      data: null,
      error: {
        message: e.message || String(e),
        code: e.code || 'EODHD_ERROR',
        status: e.status || null
      }
    };
  }
}

function mapSeries(arr, key) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const sorted = [...arr]
    .filter(x => (x.Date || x.date) && (x.Value != null || x.value != null))
    .sort((a, b) => String(a.Date || a.date).localeCompare(String(b.Date || b.date)));
  if (!sorted.length) return null;
  const last = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const lastVal = Number(last.Value ?? last.value);
  const prevVal = prev != null ? Number(prev.Value ?? prev.value) : null;
  if (!Number.isFinite(lastVal)) return null;
  return {
    actual: lastVal,
    previous: Number.isFinite(prevVal) ? prevVal : null,
    forecast: null,
    date: String(last.Date || last.date).slice(0, 10),
    change: Number.isFinite(prevVal) ? lastVal - prevVal : null,
    surprise: null,
    source: 'eodhd_macro'
  };
}

function pickEvent(events, keywords) {
  if (!Array.isArray(events) || !events.length) return null;
  const matches = events.filter(e => {
    const name = String(e.type || e.event || e.Event || e.name || '').toLowerCase();
    return keywords.some(k => name.includes(k));
  });
  if (!matches.length) return null;
  matches.sort((a, b) =>
    String(b.date || b.Date || '').localeCompare(String(a.date || a.Date || ''))
  );
  const m = matches[0];
  const actual = m.actual != null ? Number(m.actual) : (m.Actual != null ? Number(m.Actual) : null);
  const forecast = m.estimate != null ? Number(m.estimate)
    : (m.Estimate != null ? Number(m.Estimate)
      : (m.forecast != null ? Number(m.forecast) : null));
  const previous = m.previous != null ? Number(m.previous) : (m.Previous != null ? Number(m.Previous) : null);
  if (actual == null && forecast == null && previous == null) return null;
  return {
    actual: Number.isFinite(actual) ? actual : null,
    forecast: Number.isFinite(forecast) ? forecast : null,
    previous: Number.isFinite(previous) ? previous : null,
    date: String(m.date || m.Date || '').slice(0, 10) || null,
    change: (Number.isFinite(actual) && Number.isFinite(previous)) ? actual - previous : null,
    surprise: (Number.isFinite(actual) && Number.isFinite(forecast)) ? actual - forecast : null,
    source: 'eodhd_events',
    eventType: String(m.type || m.event || '')
  };
}

async function fetchMacroSnapshot(symbol) {
  const cacheKey = `macro:USA:${String(symbol || '').toUpperCase()}`;
  const hit = cacheGet(cacheKey);
  if (hit) return { ...hit, _fromCache: true };

  const from90 = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const from30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

  // Parallel fetches — more sources for resilience
  const [
    inflationRes,
    realRateRes,
    unempRes,
    eventsRes,
    yieldRes
  ] = await Promise.all([
    eodhdSafe('/macro-indicator/USA', { indicator: 'inflation_consumer_prices_annual' }),
    eodhdSafe('/macro-indicator/USA', { indicator: 'real_interest_rate' }),
    eodhdSafe('/macro-indicator/USA', { indicator: 'unemployment_total_percent' }),
    eodhdSafe('/economic-events', {
      from: from90,
      to: today,
      country: 'US',
      limit: 100
    }),
    // US Treasury 10Y yield (often available on more plans)
    eodhdSafe('/ust/yield-rates', { from: from30 })
  ]);

  const snapshot = {};
  const diagnostics = {
    inflation: inflationRes.error || (Array.isArray(inflationRes.data) ? `ok:${inflationRes.data.length}` : 'empty'),
    realRate: realRateRes.error || (Array.isArray(realRateRes.data) ? `ok:${realRateRes.data.length}` : 'empty'),
    unemployment: unempRes.error || (Array.isArray(unempRes.data) ? `ok:${unempRes.data.length}` : 'empty'),
    events: eventsRes.error || (Array.isArray(eventsRes.data) ? `ok:${eventsRes.data.length}` : 'empty'),
    yields: yieldRes.error || (Array.isArray(yieldRes.data) ? `ok:${yieldRes.data.length}` : (yieldRes.data ? 'ok:obj' : 'empty'))
  };

  const cpi = mapSeries(inflationRes.data, 'cpi');
  if (cpi) snapshot.cpi = cpi;

  const fed = mapSeries(realRateRes.data, 'fed_funds');
  if (fed) snapshot.fed_funds = fed;

  const unemp = mapSeries(unempRes.data, 'unemployment');
  if (unemp) snapshot.unemployment = unemp;

  if (Array.isArray(eventsRes.data)) {
    const nfp = pickEvent(eventsRes.data, [
      'nonfarm', 'non-farm', 'non farm', 'payroll', 'nfp',
      'employment change', 'nonfarm payrolls'
    ]);
    if (nfp) snapshot.nfp = nfp;

    const y10evt = pickEvent(eventsRes.data, [
      '10-year', '10 year', '10y', 'treasury yield', '10-year note'
    ]);
    if (y10evt) snapshot.us10y = y10evt;

    const cpiEvt = pickEvent(eventsRes.data, [
      'cpi', 'consumer price', 'inflation rate'
    ]);
    if (cpiEvt && !snapshot.cpi) snapshot.cpi = { ...cpiEvt, source: 'eodhd_events' };

    const fedEvt = pickEvent(eventsRes.data, [
      'fed funds', 'federal funds', 'interest rate decision', 'fed interest rate'
    ]);
    if (fedEvt && !snapshot.fed_funds) snapshot.fed_funds = { ...fedEvt, source: 'eodhd_events' };

    const gdp = pickEvent(eventsRes.data, ['gdp growth', 'gdp annual', 'gross domestic']);
    if (gdp) snapshot.gdp = gdp;

    const pmi = pickEvent(eventsRes.data, ['ism manufacturing', 'manufacturing pmi', 'pmi']);
    if (pmi) snapshot.pmi = pmi;
  }

  // Treasury yield rates fallback for us10y
  if (!snapshot.us10y && yieldRes.data) {
    const rows = Array.isArray(yieldRes.data) ? yieldRes.data : [];
    // Common shapes: { date, yield10y } or { Date, '10Y' } etc.
    const sorted = [...rows].filter(r => r).sort((a, b) =>
      String(b.date || b.Date || '').localeCompare(String(a.date || a.Date || ''))
    );
    if (sorted.length) {
      const last = sorted[0];
      const val = Number(
        last.yield10y ?? last['10Y'] ?? last['10y'] ?? last.y10 ?? last.value ?? last.Value
      );
      if (Number.isFinite(val)) {
        snapshot.us10y = {
          actual: val,
          previous: null,
          forecast: null,
          date: String(last.date || last.Date || '').slice(0, 10) || null,
          change: null,
          surprise: null,
          source: 'eodhd_ust_yield'
        };
      }
    }
  }

  if (!Object.keys(snapshot).length) {
    // Build a helpful error so the UI/logs show the real reason
    const forbidden = Object.values(diagnostics).some(
      d => d && typeof d === 'object' && (d.status === 403 || d.status === 401)
    );
    const msg = forbidden
      ? 'پلن EODHD شما به Macro Indicators / Economic Events دسترسی ندارد (HTTP 403). پلن را ارتقا دهید یا endpointهای پشتیبانی‌شده را فعال کنید.'
      : `هیچ داده فاندامنتال قابل‌استفاده از EODHD برنگشت. diagnostics=${JSON.stringify(diagnostics)}`;
    const err = new Error(msg);
    err.code = forbidden ? 'PLAN_FORBIDDEN' : 'EMPTY_DATA';
    err.diagnostics = diagnostics;
    throw err;
  }

  const payload = {
    ok: true,
    symbol: String(symbol || '').toUpperCase() || null,
    snapshot,
    fetchedAt: new Date().toISOString(),
    sources: ['eodhd_macro', 'eodhd_events', 'eodhd_ust'],
    coverage: Object.keys(snapshot).length,
    diagnostics,
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
  const pathname = u.pathname;

  // API Routes
  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      service: 'oma-fundamental-proxy',
      version: '6.05.0',
      tokenConfigured: Boolean(TOKEN),
      cacheEntries: cache.size,
      staticRoot: STATIC_ROOT
    });
  }

  if (req.method === 'GET' && pathname === '/api/fundamental') {
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
        : e.code === 'PLAN_FORBIDDEN' ? 403
        : e.status === 401 || e.status === 403 ? 502
        : e.code === 'EMPTY_DATA' ? 422
        : 502;
      return json(res, status, {
        ok: false,
        error: e.message || 'خطا در دریافت داده فاندامنتال',
        code: e.code || 'EODHD_ERROR',
        diagnostics: e.diagnostics || undefined
      });
    }
  }

  // Static File Routes
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  rel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
  let filepath = path.join(STATIC_ROOT, rel);

  if (!filepath.startsWith(STATIC_ROOT)) {
    return json(res, 403, { ok: false, error: 'Forbidden' });
  }

  try {
    if (fs.existsSync(filepath) && fs.statSync(filepath).isDirectory()) {
      filepath = path.join(filepath, 'index.html');
    } else if (!path.extname(filepath) && !fs.existsSync(filepath)) {
      const withIndex = path.join(filepath, 'index.html');
      if (fs.existsSync(withIndex)) filepath = withIndex;
    }
  } catch { /* ignore */ }

  if (fs.existsSync(filepath) && fs.statSync(filepath).isFile()) {
    return serveFile(res, filepath);
  }

  if (!path.extname(pathname) || pathname.endsWith('/')) {
    const indexPath = path.join(STATIC_ROOT, 'index.html');
    if (fs.existsSync(indexPath)) {
      return serveFile(res, indexPath);
    }
  }

  return json(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OMA V6.05] Server running at http://0.0.0.0:${PORT}`);
  console.log(`[OMA V6.05] Static root: ${STATIC_ROOT}`);
  console.log(`[OMA V6.05] EODHD token configured: ${TOKEN ? 'yes' : 'NO — set EODHD_API_TOKEN'}`);
});
