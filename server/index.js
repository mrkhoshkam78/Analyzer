/**
 * Backend-only market data proxy (zero external deps).
 * API_NINJAS_KEY from environment only — never sent to clients.
 */
import http from 'http';
import { URL } from 'url';

const PORT = Number(process.env.PORT) || 8787;
const API_KEY = process.env.API_NINJAS_KEY || '';
const UPSTREAM = 'https://api.api-ninjas.com/v1/commodityprice?name=brent_crude_oil';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let lastValid = null;

function num(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeBrent(raw) {
  const price = num(raw.price);
  const updatedSec = num(raw.updated);
  const timestamp = updatedSec != null ? updatedSec * 1000 : Date.now();
  const previousClose = num(raw.previous_close ?? raw.previousClose ?? raw.close);
  const change = num(raw.change_24h ?? raw.change);
  const changePercent = num(raw.change_24h_percent ?? raw.changePercent);
  const high = num(raw.high_24h ?? raw.high);
  const low = num(raw.low_24h ?? raw.low);
  const open = num(raw.open);
  const volume = num(raw.volume);
  const currency = (raw.currency_unit || raw.currency || 'USD').toString().toUpperCase();
  let unit = (raw.unit || 'barrel').toString().toLowerCase();
  if (unit.includes('bbl')) unit = 'barrel';
  const dataAge = Date.now() - timestamp;
  return {
    symbol: 'BRENT',
    price,
    open,
    high,
    low,
    previousClose,
    change: change != null ? change : (price != null && previousClose != null ? price - previousClose : null),
    changePercent:
      changePercent != null
        ? changePercent
        : price != null && previousClose != null && previousClose !== 0
          ? ((price - previousClose) / previousClose) * 100
          : null,
    volume,
    timestamp,
    source: 'api-ninjas',
    exchange: raw.exchange || null,
    name: raw.name || 'Brent Crude Oil',
    dataAge,
    currency,
    unit,
    isStale: dataAge > MAX_AGE_MS,
    fetchedAt: Date.now()
  };
}

function validateQuote(q) {
  const issues = [];
  if (!q) return { ok: false, issues: ['empty'] };
  if (q.price == null || q.price <= 0) issues.push('invalid_price');
  if (q.timestamp == null || !Number.isFinite(q.timestamp) || q.timestamp <= 0) issues.push('invalid_timestamp');
  if (q.currency && q.currency !== 'USD') issues.push('unexpected_currency');
  // BRENT managed as USD/barrel — accept barrel / bbl / empty (API may omit)
  if (q.unit && !/barrel|bbl/i.test(String(q.unit))) issues.push('unexpected_unit');
  if (q.high != null && q.low != null && q.high < q.low) issues.push('high_lt_low');
  if (q.isStale) issues.push('stale_data');
  return { ok: issues.filter(i => i !== 'stale_data').length === 0, issues };
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function fetchUpstream() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(UPSTREAM, {
      headers: { 'X-Api-Key': API_KEY, Accept: 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timer);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep null */ }
    return { status: res.status, json, text };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type'
    });
    return res.end();
  }

  const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (u.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      hasApiKey: Boolean(API_KEY),
      lastValidAt: lastValid ? lastValid.fetchedAt : null
    });
  }

  if (u.pathname === '/api/debug/key-check') {
    return send(res, 200, { configured: Boolean(API_KEY), length: API_KEY ? API_KEY.length : 0 });
  }

  if (u.pathname === '/api/market/brent') {
    if (!API_KEY) {
      return send(res, 503, {
        ok: false,
        error: 'missing_api_key',
        message: 'کلید API تنظیم نشده است (API_NINJAS_KEY).',
        quote: lastValid,
        usingCache: Boolean(lastValid)
      });
    }
    try {
      const up = await fetchUpstream();
      if (up.status === 429) {
        return send(res, 429, {
          ok: false,
          error: 'rate_limit',
          message: 'محدودیت نرخ درخواست API. آخرین داده معتبر حفظ شد.',
          quote: lastValid,
          usingCache: Boolean(lastValid)
        });
      }
      if (up.status !== 200 || !up.json) {
        return send(res, 502, {
          ok: false,
          error: 'upstream_error',
          message: `خطای سرویس بالادست (${up.status}).`,
          detail: (up.text || '').slice(0, 200),
          quote: lastValid,
          usingCache: Boolean(lastValid)
        });
      }
      const quote = normalizeBrent(up.json);
      const v = validateQuote(quote);
      if (!v.ok) {
        return send(res, 502, {
          ok: false,
          error: 'invalid_payload',
          message: 'داده دریافتی نامعتبر است.',
          issues: v.issues,
          quote: lastValid,
          usingCache: Boolean(lastValid)
        });
      }
      lastValid = quote;
      return send(res, 200, { ok: true, quote, validation: v, usingCache: false });
    } catch (err) {
      const isTimeout = err && err.name === 'AbortError';
      return send(res, isTimeout ? 504 : 502, {
        ok: false,
        error: isTimeout ? 'timeout' : 'network_error',
        message: isTimeout ? 'زمان اتصال به API به پایان رسید.' : 'خطای شبکه در دریافت داده.',
        quote: lastValid,
        usingCache: Boolean(lastValid)
      });
    }
  }

  send(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`[oma-market-server] :${PORT} key=${API_KEY ? 'set' : 'MISSING'}`);
});
