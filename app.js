/**
 * Offline Market Analyst V4 – UI controller
 * Symbol search is the only network call. All analysis is local via Worker.
 */

import { CONFIG } from './analysis.js';

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let worker = null;
let searchTimer = null;
const searchCache = new Map(); // query -> results[]
const CACHE_KEY = 'oma_v4_symbol_cache';
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24h

// Load persistent cache
try {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) {
    const obj = JSON.parse(raw);
    if (obj && obj.ts && Date.now() - obj.ts < CACHE_TTL && obj.data) {
      Object.entries(obj.data).forEach(([k, v]) => searchCache.set(k, v));
    }
  }
} catch (_) {}

function persistCache() {
  try {
    const data = {};
    let i = 0;
    for (const [k, v] of searchCache) {
      if (i++ > 80) break; // limit size
      data[k] = v;
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}

// ---------- Worker ----------
function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    console.warn('Module worker failed, falling back', e);
    // Fallback: main-thread analysis (still imported)
    worker = null;
  }
  return worker;
}

// ---------- Symbol Search (Yahoo Finance – search only) ----------
async function fetchSymbols(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];

  if (searchCache.has(q)) return searchCache.get(q);

  const yahoo = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&listsCount=0`;
  // Direct first; if CORS blocks, fall back to a public CORS proxy (search only)
  const urls = [
    yahoo,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahoo)}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const json = await res.json();
      const quotes = (json.quotes || []).filter(x => x.symbol);
      const results = quotes.map(item => ({
        symbol: item.symbol,
        name: item.longname || item.shortname || item.symbol,
        exchange: item.exchDisp || item.exchange || '',
        type: item.typeDisp || item.quoteType || ''
      }));
      searchCache.set(q, results);
      persistCache();
      return results;
    } catch (_) {
      /* try next */
    }
  }

  // Offline / all failed – return partial cache matches
  const cached = [];
  for (const [k, v] of searchCache) {
    if (k.includes(q) || q.includes(k)) cached.push(...v);
  }
  const seen = new Set();
  return cached.filter(r => {
    if (seen.has(r.symbol)) return false;
    seen.add(r.symbol);
    return true;
  }).slice(0, 8);
}

function renderAutocomplete(items) {
  const box = $('ac');
  if (!items.length) {
    box.classList.remove('show');
    box.innerHTML = '';
    return;
  }
  box.innerHTML = items.map((it, i) =>
    `<div class="ac-item" data-idx="${i}" data-symbol="${escapeAttr(it.symbol)}">
      <div><span class="sym">${escapeHtml(it.symbol)}</span> · <span class="name">${escapeHtml(it.name)}</span></div>
      <div class="meta">${escapeHtml(it.exchange)}${it.type ? ' · ' + escapeHtml(it.type) : ''}</div>
    </div>`
  ).join('');
  box.classList.add('show');

  box.querySelectorAll('.ac-item').forEach(el => {
    el.addEventListener('click', () => {
      $('symbol').value = el.dataset.symbol;
      box.classList.remove('show');
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

// ---------- File / Paste handling ----------
function setProcessing(on, msg = 'Processing…') {
  const el = $('processing');
  if (on) {
    el.classList.add('show');
    el.innerHTML = `<span class="spinner"></span>${msg}`;
    $('analyzeBtn').disabled = true;
  } else {
    el.classList.remove('show');
    $('analyzeBtn').disabled = false;
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Failed to read file'));
    r.readAsText(file);
  });
}

// ---------- Run analysis ----------
async function runAnalysis() {
  const text = ($('data').value || '').trim();
  if (!text) {
    alert('Please upload a CSV or paste OHLCV data.');
    return;
  }

  setProcessing(true, 'Parsing & analyzing…');
  $('result').classList.remove('show');

  const currentPrice = parseFloat($('current').value);
  const payload = {
    type: 'analyze',
    text,
    currentPrice: Number.isFinite(currentPrice) ? currentPrice : undefined
  };

  const w = getWorker();

  if (w) {
    const onMsg = (e) => {
      w.removeEventListener('message', onMsg);
      setProcessing(false);
      if (e.data.type === 'error') {
        alert(e.data.message || 'Analysis error');
        return;
      }
      showResult(e.data.result);
    };
    w.addEventListener('message', onMsg);
    w.postMessage(payload);
  } else {
    // Fallback main-thread (still non-blocking via setTimeout)
    try {
      const { parseOHLCV, analyze } = await import('./analysis.js');
      // yield to UI
      await new Promise(r => setTimeout(r, 0));
      const { candles, error } = parseOHLCV(text);
      if (error || !candles.length) {
        setProcessing(false);
        alert(error || 'No valid candles');
        return;
      }
      await new Promise(r => setTimeout(r, 0));
      const result = analyze(candles, { currentPrice: payload.currentPrice });
      setProcessing(false);
      showResult(result);
    } catch (err) {
      setProcessing(false);
      alert(err.message || 'Analysis failed');
    }
  }
}

function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function showResult(r) {
  if (!r || !r.ok) {
    alert(r?.error || 'Analysis failed');
    return;
  }

  const sig = r.signal;
  $('signal').textContent = sig;
  $('signal').className = 'signal ' + sig;

  const sym = $('symbol').value.trim() || 'Asset';
  const tf = $('tf').value;
  $('score').textContent = `${sym} · ${tf} · Score ${r.score}/100`;
  $('bar').style.width = r.score + '%';

  $('trend').textContent = r.trend;
  $('risk').textContent = r.riskLevel;
  $('support').textContent = fmt(r.support);
  $('resistance').textContent = fmt(r.resistance);
  $('target').textContent = fmt(r.target);
  $('stop').textContent = fmt(r.stop);

  $('report').textContent = r.report +
    ` (${r.candleCount} candles used. Indicators: Close-based except S/R from High/Low, ATR from True Range.)`;

  $('result').classList.add('show');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearAll() {
  $('symbol').value = '';
  $('current').value = '';
  $('data').value = '';
  $('fileName').textContent = 'No file selected';
  $('result').classList.remove('show');
  $('ac').classList.remove('show');
  const csv = $('csv');
  if (csv) csv.value = '';
}

// ---------- Init ----------
function init() {
  // Symbol search with debounce
  const symInput = $('symbol');
  symInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = symInput.value.trim();
    if (q.length < 1) {
      renderAutocomplete([]);
      return;
    }
    searchTimer = setTimeout(async () => {
      const items = await fetchSymbols(q);
      renderAutocomplete(items);
    }, 320);
  });

  symInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') renderAutocomplete([]);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.symbol-wrap')) renderAutocomplete([]);
  });

  // File upload
  const drop = $('drop');
  const csvInput = $('csv');

  drop.addEventListener('click', () => csvInput.click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) await handleFile(f);
  });

  csvInput.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) await handleFile(f);
  });

  async function handleFile(file) {
    $('fileName').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    setProcessing(true, 'Reading file…');
    try {
      // Read off main path; large files still async via FileReader
      const text = await readFileAsText(file);
      // Put raw text in textarea without heavy DOM ops
      $('data').value = text;
      setProcessing(false);
    } catch (err) {
      setProcessing(false);
      alert(err.message || 'Could not read file');
    }
  }

  $('analyzeBtn').addEventListener('click', runAnalysis);
  $('clearBtn').addEventListener('click', clearAll);
}

init();
