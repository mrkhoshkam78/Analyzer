/**
 * UI V5 — single price entry + maximalist UI controller
 * Data/Analysis architecture unchanged (datasets + analysis engine).
 */
import { getSymbol, formatPrice, SYMBOL_LIST } from './logic/symbols.js';
import {
  loadHistorical,
  loadManual,
  setHistorical,
  upsertManualPrices,
  buildAnalysisSeries,
  getAssetSummary,
  dayKeyOffset,
  dayKey,
  getCachedSymbols,
  dropSessionCache
} from './logic/datasets.js';

const $ = (id) => document.getElementById(id);

let activeTab = 'paste';
let currentSymbol = null;

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatNow() {
  const d = new Date();
  const date = d.toLocaleDateString('fa-IR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  });
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return { date, time, full: `${date} — ${time}` };
}

function tickClock() {
  const { date, time, full } = formatNow();
  if ($('clockDate')) $('clockDate').textContent = date;
  if ($('clockTime')) $('clockTime').textContent = time;
  const rc = $('resultClock');
  if (rc && $('result')?.classList.contains('show')) rc.textContent = full;
}

function toast(msg, kind = 'ok') {
  const el = $('toast');
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
  el.className = 'toast show is-' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 2800);
}

function setProcessing(on, msg = 'در حال پردازش…') {
  const el = $('processing');
  if (on) {
    el.classList.add('show');
    el.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${msg}</span>`;
    $('analyzeBtn').disabled = true;
  } else {
    el.classList.remove('show');
    el.innerHTML = '';
    $('analyzeBtn').disabled = false;
  }
}

function setDataStatus(msg, kind = '') {
  const el = $('dataStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'data-status' + (kind ? ' is-' + kind : '');
}

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll('.input-tab').forEach(btn => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  ['paste', 'table', 'file'].forEach(id => {
    const panel = $('panel' + id.charAt(0).toUpperCase() + id.slice(1));
    if (!panel) return;
    const on = id === name;
    panel.hidden = !on;
    panel.classList.toggle('active', on);
  });
}

function setupDefaultDate() {
  const el = $('priceDate');
  if (el && !el.value) el.value = dayKeyOffset(0);
}

function selectAsset(symbol) {
  const meta = getSymbol(symbol);
  document.querySelectorAll('.asset-btn').forEach(btn => {
    const on = btn.dataset.symbol === symbol;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const sel = $('symbol');
  if (sel) {
    sel.value = meta ? symbol : '';
    sel.dispatchEvent(new Event('change'));
  }
}

function onSymbolChange() {
  const id = $('symbol').value;
  const meta = getSymbol(id);
  document.querySelectorAll('.asset-btn').forEach(btn => {
    const on = btn.dataset.symbol === id;
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (!meta) {
    $('assetChip').classList.remove('show');
    refreshAssetPanel(null);
    return;
  }
  $('chipSym').textContent = meta.symbol;
  $('chipName').textContent = meta.nameFa;
  $('chipMeta').textContent = `${meta.typeFa} · ${meta.unitFa}`;
  $('assetChip').classList.add('show');
  refreshAssetPanel(id);
}

function refreshAssetPanel(symbol) {
  const card = $('dailyCard');
  const meta = getSymbol(symbol);
  if (!meta || !symbol) {
    if (card) card.hidden = true;
    currentSymbol = null;
    return;
  }
  currentSymbol = symbol;
  // Lazy-load ONLY this symbol
  loadHistorical(symbol);
  loadManual(symbol);
  if (card) {
    card.hidden = false;
    card.classList.remove('enter-3');
    void card.offsetWidth;
    card.classList.add('enter-3');
  }
  setupDefaultDate();
  const sum = getAssetSummary(symbol);
  const hint = $('assetDataHint');
  if (hint) {
    hint.textContent =
      `تاریخچه: ${sum.histCount.toLocaleString('fa-IR')} کندل · دستی: ${sum.manualCount.toLocaleString('fa-IR')} قیمت`;
  }
  renderManualList(symbol);
  const desc = $('dailyDesc');
  if (desc) {
    desc.textContent = `Close برای ${meta.nameFa} · ${meta.unitFa}`;
  }
  // clear price input for fresh entry
  if ($('priceValue')) $('priceValue').value = '';
}

function renderManualList(symbol) {
  const box = $('manualList');
  if (!box) return;
  if (!symbol) { box.innerHTML = ''; return; }
  const manual = loadManual(symbol).slice().reverse().slice(0, 15);
  if (!manual.length) {
    box.innerHTML = '<p class="card-desc">هنوز قیمت دستی برای این دارایی نیست.</p>';
    return;
  }
  box.innerHTML =
    '<div class="manual-list-title">تاریخچه قیمت‌های ثبت‌شده</div>' +
    manual.map(m =>
      `<div class="manual-item"><span>${m.day}</span><strong>${formatPrice(m.close, symbol)}</strong></div>`
    ).join('');
}

function saveDailyPrice(e) {
  if (e) e.preventDefault();
  const sym = $('symbol').value;
  if (!sym || !getSymbol(sym)) {
    toast('ابتدا یک دارایی را انتخاب کنید', 'err');
    return;
  }
  const day = ($('priceDate').value || '').trim();
  const raw = ($('priceValue').value || '').trim();
  if (!day) {
    toast('تاریخ را انتخاب کنید', 'err');
    return;
  }
  const close = Number(raw);
  if (!Number.isFinite(close) || close <= 0) {
    toast('قیمت باید عدد معتبر و بزرگ‌تر از صفر باشد', 'err');
    return;
  }
  const res = upsertManualPrices(sym, [{ day, close }]);
  refreshAssetPanel(sym);
  toast(`قیمت ${formatPrice(close, sym)} برای ${day} ثبت شد`, 'ok');
  setDataStatus(`${res.saved} رکورد · جمع دستی ${sym}: ${res.total}`, 'ok');
  if ($('priceValue')) {
    $('priceValue').value = '';
    $('priceValue').focus();
  }
}

/* OHLCV table helpers */
function emptyRow() {
  return { date: '', o: '', h: '', l: '', c: '', v: '' };
}
function esc(v) {
  if (v == null || v === '') return '';
  return String(v).replace(/"/g, '&quot;');
}
function addTableRow(data = null) {
  const tbody = $('manualBody');
  if (!tbody) return;
  const r = data || emptyRow();
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="cell" data-k="date" value="${esc(r.date)}"></td>
    <td><input type="number" class="cell" data-k="o" step="any" value="${esc(r.o)}"></td>
    <td><input type="number" class="cell" data-k="h" step="any" value="${esc(r.h)}"></td>
    <td><input type="number" class="cell" data-k="l" step="any" value="${esc(r.l)}"></td>
    <td><input type="number" class="cell" data-k="c" step="any" value="${esc(r.c)}"></td>
    <td><input type="number" class="cell" data-k="v" step="any" value="${esc(r.v)}"></td>
    <td><button type="button" class="row-del" aria-label="حذف">×</button></td>`;
  tr.querySelector('.row-del').addEventListener('click', () => {
    tr.remove();
    if (!$('manualBody').children.length) addTableRow();
  });
  tbody.appendChild(tr);
}
function tableToText() {
  const lines = ['Date,Open,High,Low,Close,Volume'];
  $('manualBody')?.querySelectorAll('tr').forEach(tr => {
    const get = k => tr.querySelector(`[data-k="${k}"]`)?.value.trim() || '';
    if (!get('o') && !get('c')) return;
    lines.push([get('date'), get('o'), get('h'), get('l'), get('c'), get('v')].join(','));
  });
  return lines.join('\n');
}
function pasteIntoTable() {
  const raw = prompt('چند ردیف OHLCV را بچسبانید:');
  if (!raw?.trim()) return;
  let added = 0;
  for (const line of raw.trim().split(/\r?\n/)) {
    let cols = line.includes('\t') ? line.split('\t')
      : line.includes(',') ? line.split(',')
      : line.trim().split(/\s+/);
    cols = cols.map(x => x.trim());
    if (/date|open|high/i.test(cols.join(' '))) continue;
    if (cols.length < 5) continue;
    addTableRow({ date: cols[0], o: cols[1], h: cols[2], l: cols[3], c: cols[4], v: cols[5] || '' });
    added++;
  }
  toast(added ? `${added} ردیف اضافه شد` : 'ردیفی اضافه نشد', added ? 'ok' : 'err');
}
function collectImportText() {
  if (activeTab === 'table') return tableToText();
  return ($('data').value || '').trim();
}

async function importHistoricalIfAny(sym) {
  const text = collectImportText();
  if (!text || text.split(/\n/).filter(Boolean).length < 2) return { imported: 0 };
  const { parseOHLCV } = await import('./logic/analysis.js');
  const { candles, error, rejected } = parseOHLCV(text);
  if (error || !candles.length) return { imported: 0, error, rejected };
  const withDay = candles.map(c => ({
    ...c,
    day: c.ts != null ? dayKey(c.ts) : null
  }));
  const n = setHistorical(sym, withDay);
  return { imported: n, rejected };
}

async function runAnalysis() {
  const sym = $('symbol').value;
  if (!sym || !getSymbol(sym)) {
    toast('لطفاً یک دارایی را انتخاب کنید', 'err');
    return;
  }
  setProcessing(true, 'آماده‌سازی Dataset…');
  $('result').classList.remove('show');
  try {
    const imp = await importHistoricalIfAny(sym);
    if (imp.error && imp.imported === 0 && collectImportText().length > 20) {
      setProcessing(false);
      setDataStatus(imp.error, 'err');
      toast(imp.error, 'err');
      return;
    }
    const series = buildAnalysisSeries(sym);
    refreshAssetPanel(sym);
    if (!series.hasFullOHLC || series.candles.length < 30) {
      setProcessing(false);
      const msg = `برای ${sym} حداقل ۳۰ کندل OHLCV در تاریخچه لازم است (فعلی: ${series.histCount}).`;
      setDataStatus(msg, 'warn');
      toast(msg, 'err');
      return;
    }
    const uiPrice = parseFloat($('current').value);
    const currentPrice = Number.isFinite(uiPrice) && uiPrice > 0 ? uiPrice : series.currentPrice;
    const { analyze } = await import('./logic/analysis.js');
    await new Promise(r => setTimeout(r, 0));
    const result = analyze(series.candles, {
      currentPrice, symbol: sym, timeframe: $('tf').value, recordPrediction: true
    });
    setProcessing(false);
    setDataStatus(
      `${sym}: ${series.histCount} تاریخچه · ${series.manualCount} دستی` +
      (imp.imported ? ` · import ${imp.imported}` : ''),
      'ok'
    );
    showResult(result, sym);
  } catch (err) {
    setProcessing(false);
    toast(err.message || 'خطا در تحلیل', 'err');
  }
}

const SIGNAL_FA = { BUY: 'خرید', HOLD: 'نگهداری', SELL: 'فروش' };
const TREND_FA = {
  'Strong Bullish': 'قوی صعودی', Bullish: 'صعودی', Neutral: 'خنثی',
  Bearish: 'نزولی', 'Strong Bearish': 'قوی نزولی'
};
const RISK_FA = { High: 'بالا', Medium: 'متوسط', Low: 'پایین' };
const SIGNAL_ICONS = {
  BUY: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  SELL: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`,
  HOLD: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 12h8"/></svg>`
};

function showResult(r, symbolId) {
  if (!r || !r.ok) {
    toast(r?.error || 'تحلیل ناموفق بود', 'err');
    return;
  }
  const sig = r.signal;
  $('signalPanel').className = 'signal-panel ' + sig;
  $('signal').className = 'signal ' + sig;
  $('signalText').textContent = SIGNAL_FA[sig] || sig;
  $('signalIcon').innerHTML = SIGNAL_ICONS[sig] || SIGNAL_ICONS.HOLD;
  const meta = getSymbol(symbolId);
  $('scoreContext').textContent = `${meta ? meta.symbol : symbolId} · ${$('tf').value}`;
  $('score').textContent = `امتیاز ${r.score.toLocaleString('fa-IR')} از ۱۰۰`;
  $('bar').style.width = r.score + '%';
  $('scoreBar')?.setAttribute('aria-valuenow', String(r.score));

  const trendEl = $('trend');
  trendEl.textContent = TREND_FA[r.trend] || r.trend;
  trendEl.className = 'metric-value' + (/Bull/i.test(r.trend) ? ' trend-bull' : /Bear/i.test(r.trend) ? ' trend-bear' : '');

  const riskEl = $('risk');
  riskEl.textContent = RISK_FA[r.riskLevel] || r.riskLevel;
  riskEl.className = 'metric-value' + (r.riskLevel === 'High' ? ' risk-high' : r.riskLevel === 'Low' ? ' risk-low' : '');

  const fmt = (n) => formatPrice(n, symbolId);
  $('support').textContent = fmt(r.support);
  $('resistance').textContent = fmt(r.resistance);
  $('target').textContent = fmt(r.target);
  $('stop').textContent = fmt(r.stop);

  let reportExtra = r.report || '';
  if (r.confidence != null) {
    reportExtra += ' اطمینان مدل: ' + Math.round(r.confidence * 100).toLocaleString('fa-IR') + '٪.';
  }
  $('report').textContent = reportExtra;
  $('suggestionText').textContent = r.suggestion || '—';
  $('resultClock').textContent = formatNow().full;
  $('result').classList.add('show');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearAll() {
  $('current').value = '';
  $('data').value = '';
  if ($('priceValue')) $('priceValue').value = '';
  setupDefaultDate();
  $('result').classList.remove('show');
  const csv = $('csv');
  if (csv) csv.value = '';
  $('fileName')?.classList.remove('show');
  const body = $('manualBody');
  if (body) {
    body.innerHTML = '';
    for (let i = 0; i < 5; i++) addTableRow();
  }
  setDataStatus('فرم پاک شد؛ داده‌های ذخیره‌شده دارایی‌ها حفظ شدند.', 'ok');
  switchTab('paste');
  if (currentSymbol) refreshAssetPanel(currentSymbol);
}

function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('oma_theme', theme); } catch (_) {}
  const sun = document.querySelector('.icon-sun');
  const moon = document.querySelector('.icon-moon');
  if (sun && moon) {
    sun.style.display = theme === 'dark' ? 'none' : 'block';
    moon.style.display = theme === 'dark' ? 'block' : 'none';
  }
}

function init() {
  applyTheme(getTheme());
  $('themeBtn').addEventListener('click', () => applyTheme(getTheme() === 'dark' ? 'light' : 'dark'));
  tickClock();
  setInterval(tickClock, 1000);
  setupDefaultDate();

  $('symbol').addEventListener('change', onSymbolChange);
  document.querySelectorAll('.asset-btn').forEach(btn => {
    btn.addEventListener('click', () => selectAsset(btn.dataset.symbol));
  });

  $('priceForm')?.addEventListener('submit', saveDailyPrice);
  $('saveDailyBtn')?.addEventListener('click', (e) => {
    if (e.target.closest('form')) return;
    saveDailyPrice(e);
  });

  document.querySelectorAll('.input-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  for (let i = 0; i < 5; i++) addTableRow();
  $('addRowBtn')?.addEventListener('click', () => addTableRow());
  $('pasteRowsBtn')?.addEventListener('click', pasteIntoTable);

  const drop = $('drop');
  const csvInput = $('csv');
  if (drop && csvInput) {
    drop.addEventListener('click', () => csvInput.click());
    drop.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); csvInput.click(); }
    });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', async e => {
      e.preventDefault();
      drop.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) await handleFile(f);
    });
    csvInput.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (f) await handleFile(f);
    });
  }

  async function handleFile(file) {
    $('fileNameText').textContent = file.name;
    $('fileMeta').textContent = `${(file.size / 1024).toFixed(1)} کیلوبایت`;
    $('fileName').classList.add('show');
    const text = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('خواندن فایل ناموفق'));
      r.readAsText(file);
    });
    $('data').value = text;
    switchTab('paste');
    toast('فایل خوانده شد', 'ok');
  }

  $('analyzeBtn').addEventListener('click', runAnalysis);
  $('clearBtn').addEventListener('click', clearAll);

  window.__OMA_V5__ = { getCachedSymbols, dropSessionCache, buildAnalysisSeries, loadManual, loadHistorical };
}

init();
