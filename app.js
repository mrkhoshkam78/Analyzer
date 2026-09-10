/**
 * Offline Market Analyst V4 – UI controller
 * Symbol search is the only network call. All analysis is local via Worker.
 * Presentation layer updated for redesign; analysis logic unchanged.
 */

import { CONFIG } from './analysis.js';

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let worker = null;
let searchTimer = null;
let acItems = [];
let acIndex = -1;
let selectedAsset = null; // { symbol, name, exchange, type }
const searchCache = new Map();
const CACHE_KEY = 'oma_v4_symbol_cache';
const CACHE_TTL = 1000 * 60 * 60 * 24;

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
      if (i++ > 80) break;
      data[k] = v;
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}

// ---------- Worker (unchanged logic) ----------
function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    console.warn('Module worker failed, falling back', e);
    worker = null;
  }
  return worker;
}

// ---------- Symbol Search (logic unchanged) ----------
async function fetchSymbols(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];

  if (searchCache.has(q)) return searchCache.get(q);

  const yahoo = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&listsCount=0`;
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

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function renderAutocomplete(items, opts = {}) {
  const box = $('ac');
  const input = $('symbol');
  acItems = items || [];
  acIndex = -1;

  if (opts.loading) {
    box.innerHTML = '<div class="ac-loading">Searching…</div>';
    box.classList.add('show');
    input.setAttribute('aria-expanded', 'true');
    return;
  }

  if (!acItems.length) {
    if (opts.empty) {
      box.innerHTML = '<div class="ac-empty">No symbols found. Try another query or check connection.</div>';
      box.classList.add('show');
      input.setAttribute('aria-expanded', 'true');
    } else {
      box.classList.remove('show');
      box.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
    }
    return;
  }

  box.innerHTML = acItems.map((it, i) =>
    `<div class="ac-item" role="option" id="ac-opt-${i}" data-idx="${i}" data-symbol="${escapeAttr(it.symbol)}" tabindex="-1">
      <div class="ac-row">
        <span class="ac-sym">${escapeHtml(it.symbol)}</span>
        <span class="ac-name">${escapeHtml(it.name)}</span>
      </div>
      <div class="ac-meta">${escapeHtml(it.exchange)}${it.type ? ' · ' + escapeHtml(it.type) : ''}</div>
    </div>`
  ).join('');
  box.classList.add('show');
  input.setAttribute('aria-expanded', 'true');

  box.querySelectorAll('.ac-item').forEach(el => {
    el.addEventListener('click', () => selectAsset(acItems[+el.dataset.idx]));
  });
}

function selectAsset(item) {
  if (!item) return;
  selectedAsset = item;
  $('symbol').value = item.symbol;
  $('chipSym').textContent = item.symbol;
  $('chipName').textContent = item.name || item.symbol;
  $('chipMeta').textContent = [item.exchange, item.type].filter(Boolean).join(' · ') || '—';
  $('assetChip').classList.add('show');
  renderAutocomplete([]);
  $('symbol').setAttribute('aria-expanded', 'false');
}

function clearAssetChip() {
  selectedAsset = null;
  $('assetChip').classList.remove('show');
  $('chipSym').textContent = '—';
  $('chipName').textContent = '—';
  $('chipMeta').textContent = '—';
}

function highlightAc(idx) {
  const nodes = $('ac').querySelectorAll('.ac-item');
  nodes.forEach((n, i) => n.classList.toggle('active', i === idx));
  if (idx >= 0 && nodes[idx]) {
    nodes[idx].scrollIntoView({ block: 'nearest' });
    $('symbol').setAttribute('aria-activedescendant', `ac-opt-${idx}`);
  } else {
    $('symbol').removeAttribute('aria-activedescendant');
  }
}

// ---------- File / Paste handling (presentation) ----------
function setProcessing(on, msg = 'Processing market data…') {
  const el = $('processing');
  if (on) {
    el.classList.add('show');
    el.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${escapeHtml(msg)}</span>`;
    $('analyzeBtn').disabled = true;
  } else {
    el.classList.remove('show');
    el.innerHTML = '';
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

function showFileInfo(name, sizeKb) {
  const box = $('fileName');
  $('fileNameText').textContent = name;
  $('fileMeta').textContent = sizeKb != null ? `${sizeKb} KB` : '';
  box.classList.add('show');
}

function hideFileInfo() {
  $('fileName').classList.remove('show');
  $('fileNameText').textContent = 'No file selected';
  $('fileMeta').textContent = '';
}

// ---------- Run analysis (logic unchanged) ----------
async function runAnalysis() {
  const text = ($('data').value || '').trim();
  if (!text) {
    alert('Please upload a CSV or paste OHLCV data before running analysis.');
    return;
  }

  setProcessing(true, 'Processing market data…');
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
        alert(e.data.message || 'Analysis could not be completed. Check that your CSV has valid OHLC columns and at least 30 candles.');
        return;
      }
      showResult(e.data.result);
    };
    w.addEventListener('message', onMsg);
    w.postMessage(payload);
  } else {
    try {
      const { parseOHLCV, analyze } = await import('./analysis.js');
      await new Promise(r => setTimeout(r, 0));
      const { candles, error } = parseOHLCV(text);
      if (error || !candles.length) {
        setProcessing(false);
        alert(error || 'No valid candles found. Ensure the file has Open, High, Low, Close columns.');
        return;
      }
      await new Promise(r => setTimeout(r, 0));
      const result = analyze(candles, { currentPrice: payload.currentPrice });
      setProcessing(false);
      showResult(result);
    } catch (err) {
      setProcessing(false);
      alert(err.message || 'Analysis failed. Please try again with a different file.');
    }
  }
}

function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

const SIGNAL_ICONS = {
  BUY: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  SELL: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`,
  HOLD: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12h8"/></svg>`
};

function showResult(r) {
  if (!r || !r.ok) {
    alert(r?.error || 'Analysis failed. Ensure at least 30 valid OHLC candles are present.');
    return;
  }

  const sig = r.signal;
  const panel = $('signalPanel');
  panel.className = 'signal-panel ' + sig;

  const signalEl = $('signal');
  signalEl.className = 'signal ' + sig;
  $('signalText').textContent = sig;
  $('signalIcon').innerHTML = SIGNAL_ICONS[sig] || SIGNAL_ICONS.HOLD;

  const sym = (selectedAsset && selectedAsset.symbol) || $('symbol').value.trim() || 'Asset';
  const tf = $('tf').value;
  $('scoreContext').textContent = `${sym} · ${tf}`;
  $('score').textContent = `Score ${r.score}/100`;
  $('bar').style.width = r.score + '%';
  const barWrap = $('scoreBar');
  if (barWrap) barWrap.setAttribute('aria-valuenow', String(r.score));

  const trendEl = $('trend');
  trendEl.textContent = r.trend;
  trendEl.className = 'metric-value';
  if (/bull/i.test(r.trend)) trendEl.classList.add('trend-bull');
  else if (/bear/i.test(r.trend)) trendEl.classList.add('trend-bear');

  const riskEl = $('risk');
  riskEl.textContent = r.riskLevel;
  riskEl.className = 'metric-value';
  if (/high/i.test(r.riskLevel)) riskEl.classList.add('risk-high');
  else if (/low/i.test(r.riskLevel)) riskEl.classList.add('risk-low');

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
  clearAssetChip();
  hideFileInfo();
  $('result').classList.remove('show');
  renderAutocomplete([]);
  const csv = $('csv');
  if (csv) csv.value = '';
  $('pasteArea').classList.remove('show');
  $('pasteToggle').setAttribute('aria-expanded', 'false');
}

// ---------- Theme ----------
function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('oma_theme', theme); } catch (_) {}
  const sun = document.querySelector('.icon-sun');
  const moon = document.querySelector('.icon-moon');
  if (sun && moon) {
    if (theme === 'dark') {
      sun.style.display = 'none';
      moon.style.display = 'block';
    } else {
      sun.style.display = 'block';
      moon.style.display = 'none';
    }
  }
}

function toggleTheme() {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

// ---------- Network status pill ----------
function updateNetStatus() {
  const el = $('netStatus');
  if (!el) return;
  if (navigator.onLine) {
    el.classList.remove('is-offline');
    el.querySelector('span:last-child').textContent = 'Online';
  } else {
    el.classList.add('is-offline');
    el.querySelector('span:last-child').textContent = 'Offline';
  }
}

// ---------- Init ----------
function init() {
  // Theme icons
  applyTheme(getTheme());

  $('themeBtn').addEventListener('click', toggleTheme);

  updateNetStatus();
  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);

  // Symbol search with debounce
  const symInput = $('symbol');
  symInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = symInput.value.trim();
    if (q.length < 1) {
      renderAutocomplete([]);
      return;
    }
    renderAutocomplete([], { loading: true });
    searchTimer = setTimeout(async () => {
      const items = await fetchSymbols(q);
      renderAutocomplete(items, { empty: true });
    }, 320);
  });

  // Keyboard navigation for autocomplete
  symInput.addEventListener('keydown', (e) => {
    const open = $('ac').classList.contains('show') && acItems.length;
    if (e.key === 'Escape') {
      renderAutocomplete([]);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acIndex = Math.min(acIndex + 1, acItems.length - 1);
      highlightAc(acIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acIndex = Math.max(acIndex - 1, 0);
      highlightAc(acIndex);
    } else if (e.key === 'Enter' && acIndex >= 0) {
      e.preventDefault();
      selectAsset(acItems[acIndex]);
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.symbol-wrap')) renderAutocomplete([]);
  });

  $('chipClear').addEventListener('click', () => {
    $('symbol').value = '';
    clearAssetChip();
    $('symbol').focus();
  });

  // Paste toggle
  $('pasteToggle').addEventListener('click', () => {
    const area = $('pasteArea');
    const open = area.classList.toggle('show');
    $('pasteToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // File upload
  const drop = $('drop');
  const csvInput = $('csv');

  drop.addEventListener('click', () => csvInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      csvInput.click();
    }
  });
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
    showFileInfo(file.name, (file.size / 1024).toFixed(1));
    setProcessing(true, 'Reading file…');
    try {
      const text = await readFileAsText(file);
      $('data').value = text;
      setProcessing(false);
    } catch (err) {
      setProcessing(false);
      alert(err.message || 'Could not read the selected file. Try another CSV.');
    }
  }

  $('analyzeBtn').addEventListener('click', runAnalysis);
  $('clearBtn').addEventListener('click', clearAll);
}

init();
