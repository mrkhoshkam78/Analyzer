/**
 * UI Controller V5 — per-asset datasets, daily close entry, offline only.
 * Analysis formulas remain in logic/ (unchanged).
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

let worker = null;
let activeTab = 'paste';
let currentSymbol = null;

function getWorker() {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./logic/worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    console.warn('Worker fallback', e);
    worker = null;
  }
  return worker;
}

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

// ---------- Daily form ----------
function setupDailyDates() {
  const pairs = [
    { label: 'dateToday', edit: 'dateTodayEdit', off: 0 },
    { label: 'dateY1', edit: 'dateY1Edit', off: -1 },
    { label: 'dateY2', edit: 'dateY2Edit', off: -2 }
  ];
  for (const p of pairs) {
    const key = dayKeyOffset(p.off);
    const lab = $(p.label);
    const ed = $(p.edit);
    if (lab) lab.textContent = key || '—';
    if (ed && key) ed.value = key;
  }
}

function fillDailyFromManual(symbol) {
  $('priceToday').value = '';
  $('priceY1').value = '';
  $('priceY2').value = '';
  if (!symbol) return;
  const manual = loadManual(symbol);
  const byDay = new Map(manual.map(m => [m.day, m.close]));
  const map = [
    ['dateTodayEdit', 'priceToday'],
    ['dateY1Edit', 'priceY1'],
    ['dateY2Edit', 'priceY2']
  ];
  for (const [dId, pId] of map) {
    const day = $(dId)?.value;
    if (day && byDay.has(day)) $(pId).value = byDay.get(day);
  }
}

function renderManualList(symbol) {
  const box = $('manualList');
  if (!box) return;
  if (!symbol) { box.innerHTML = ''; return; }
  const manual = loadManual(symbol).slice().reverse().slice(0, 12);
  if (!manual.length) {
    box.innerHTML = '<p class="field-hint">هنوز قیمت دستی برای این دارایی ذخیره نشده است.</p>';
    return;
  }
  box.innerHTML =
    '<div class="manual-list-title">آخرین قیمت‌های ذخیره‌شده</div>' +
    manual.map(m =>
      `<div class="manual-item"><span>${m.day}</span><strong>${formatPrice(m.close, symbol)}</strong></div>`
    ).join('');
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
  if (card) card.hidden = false;
  setupDailyDates();
  fillDailyFromManual(symbol);
  const sum = getAssetSummary(symbol);
  const hint = $('assetDataHint');
  if (hint) {
    hint.textContent =
      `تاریخچه: ${sum.histCount.toLocaleString('fa-IR')} کندل · دستی: ${sum.manualCount.toLocaleString('fa-IR')} قیمت`;
  }
  renderManualList(symbol);
  const desc = $('dailyDesc');
  if (desc) {
    desc.textContent =
      `قیمت پایانی ${meta.nameFa} (${meta.unitFa}). فقط همین دارایی ذخیره و تحلیل می‌شود.`;
  }
}

function onSymbolChange() {
  const id = $('symbol').value;
  const meta = getSymbol(id);
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

function saveDailyPrices() {
  const sym = $('symbol').value;
  if (!sym || !getSymbol(sym)) {
    alert('ابتدا نماد را انتخاب کنید.');
    return;
  }
  const fields = [
    { dateId: 'dateTodayEdit', priceId: 'priceToday' },
    { dateId: 'dateY1Edit', priceId: 'priceY1' },
    { dateId: 'dateY2Edit', priceId: 'priceY2' }
  ];
  const entries = [];
  const errors = [];
  for (const f of fields) {
    const raw = ($(f.priceId).value || '').trim();
    if (!raw) continue;
    const close = Number(raw);
    if (!Number.isFinite(close) || close <= 0) {
      errors.push('قیمت نامعتبر (باید عدد بزرگ‌تر از صفر باشد).');
      continue;
    }
    let day = $(f.dateId).value;
    if (!day) day = dayKey(new Date());
    entries.push({ day, close });
  }
  if (errors.length) {
    alert(errors[0]);
    return;
  }
  if (!entries.length) {
    alert('حداقل یک قیمت وارد کنید.');
    return;
  }
  const res = upsertManualPrices(sym, entries);
  refreshAssetPanel(sym);
  setDataStatus(
    `${res.saved.toLocaleString('fa-IR')} قیمت برای ${sym} ذخیره شد (جمع: ${res.total.toLocaleString('fa-IR')}).`,
    'ok'
  );
}

// ---------- Table helpers (OHLCV optional import) ----------
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
    <td><input type="text" class="cell" data-k="date" value="${esc(r.date)}" placeholder="2024-01-02"></td>
    <td><input type="number" class="cell" data-k="o" step="any" value="${esc(r.o)}"></td>
    <td><input type="number" class="cell" data-k="h" step="any" value="${esc(r.h)}"></td>
    <td><input type="number" class="cell" data-k="l" step="any" value="${esc(r.l)}"></td>
    <td><input type="number" class="cell" data-k="c" step="any" value="${esc(r.c)}"></td>
    <td><input type="number" class="cell" data-k="v" step="any" value="${esc(r.v)}"></td>
    <td class="col-act"><button type="button" class="row-del" aria-label="حذف">×</button></td>`;
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
    const o = get('o'), h = get('h'), l = get('l'), c = get('c');
    if (!o && !h && !l && !c) return;
    lines.push([get('date'), o, h, l, c, get('v')].join(','));
  });
  return lines.join('\n');
}
function pasteIntoTable() {
  const raw = prompt('چند ردیف OHLCV را بچسبانید:');
  if (!raw?.trim()) return;
  let added = 0;
  for (const line of raw.trim().split(/\r?\n/)) {
    let cols = line.includes('\t') ? line.split('\t')
      : line.includes(';') ? line.split(';')
      : line.includes(',') ? line.split(',')
      : line.trim().split(/\s+/);
    cols = cols.map(x => x.trim());
    if (/date|open|high/i.test(cols.join(' '))) continue;
    if (cols.length < 5) continue;
    addTableRow({ date: cols[0], o: cols[1], h: cols[2], l: cols[3], c: cols[4], v: cols[5] || '' });
    added++;
  }
  setDataStatus(added ? `${added} ردیف اضافه شد.` : 'ردیفی اضافه نشد.', added ? 'ok' : 'warn');
}

function collectImportText() {
  if (activeTab === 'table') return tableToText();
  return ($('data').value || '').trim();
}

/** Import pasted/file OHLCV into historical of CURRENT symbol only */
async function importHistoricalIfAny(sym) {
  const text = collectImportText();
  if (!text || text.split(/\n/).filter(Boolean).length < 2) return { imported: 0 };
  const { parseOHLCV } = await import('./logic/analysis.js');
  const { candles, error, rejected } = parseOHLCV(text);
  if (error || !candles.length) return { imported: 0, error, rejected };
  // attach day keys
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
    alert('لطفاً یکی از سه نماد مجاز را انتخاب کنید.');
    return;
  }

  setProcessing(true, 'آماده‌سازی Dataset دارایی…');
  $('result').classList.remove('show');

  try {
    // Optional OHLCV import for this symbol only
    const imp = await importHistoricalIfAny(sym);
    if (imp.error && imp.imported === 0 && collectImportText().length > 20) {
      setProcessing(false);
      setDataStatus(imp.error, 'err');
      alert(imp.error);
      return;
    }

    // Lazy series for THIS symbol only
    const series = buildAnalysisSeries(sym);
    refreshAssetPanel(sym);

    if (!series.hasFullOHLC || series.candles.length < 30) {
      setProcessing(false);
      const msg =
        `برای تحلیل تکنیکال ${sym} حداقل ۳۰ کندل OHLCV کامل در تاریخچه لازم است (فعلی: ${series.histCount}). ` +
        'قیمت‌های روزانه فقط Close هستند و به‌تنهایی جایگزین تاریخچه نمی‌شوند.';
      setDataStatus(msg, 'warn');
      alert(msg);
      return;
    }

    const uiPrice = parseFloat($('current').value);
    const currentPrice = Number.isFinite(uiPrice) && uiPrice > 0
      ? uiPrice
      : series.currentPrice;

    // Run analysis on main thread with prepared candles (no mixing symbols)
    const { analyze } = await import('./logic/analysis.js');
    await new Promise(r => setTimeout(r, 0));
    const result = analyze(series.candles, {
      currentPrice,
      symbol: sym,
      timeframe: $('tf').value,
      recordPrediction: true
    });
    setProcessing(false);
    if (imp.imported) {
      setDataStatus(
        `تاریخچه ${sym}: ${imp.imported.toLocaleString('fa-IR')} کندل · دستی: ${series.manualCount.toLocaleString('fa-IR')}`,
        'ok'
      );
    } else {
      setDataStatus(
        `${sym}: ${series.histCount.toLocaleString('fa-IR')} کندل تاریخچه · ${series.manualCount.toLocaleString('fa-IR')} قیمت دستی`,
        'ok'
      );
    }
    showResult(result, sym);
  } catch (err) {
    setProcessing(false);
    setDataStatus(err.message || 'خطا', 'err');
    alert(err.message || 'خطا در تحلیل');
  }
}

const SIGNAL_FA = { BUY: 'خرید', HOLD: 'نگهداری', SELL: 'فروش' };
const TREND_FA = {
  'Strong Bullish': 'قوی صعودی', Bullish: 'صعودی', Neutral: 'خنثی',
  Bearish: 'نزولی', 'Strong Bearish': 'قوی نزولی'
};
const RISK_FA = { High: 'بالا', Medium: 'متوسط', Low: 'پایین' };
const SIGNAL_ICONS = {
  BUY: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  SELL: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`,
  HOLD: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12h8"/></svg>`
};

function showResult(r, symbolId) {
  if (!r || !r.ok) {
    alert(r?.error || 'تحلیل ناموفق بود.');
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
  trendEl.className = 'metric-value';
  if (/Bull/i.test(r.trend)) trendEl.classList.add('trend-bull');
  else if (/Bear/i.test(r.trend)) trendEl.classList.add('trend-bear');

  const riskEl = $('risk');
  riskEl.textContent = RISK_FA[r.riskLevel] || r.riskLevel;
  riskEl.className = 'metric-value';
  if (r.riskLevel === 'High') riskEl.classList.add('risk-high');
  else if (r.riskLevel === 'Low') riskEl.classList.add('risk-low');

  const fmt = (n) => formatPrice(n, symbolId);
  $('support').textContent = fmt(r.support);
  $('resistance').textContent = fmt(r.resistance);
  $('target').textContent = fmt(r.target);
  $('stop').textContent = fmt(r.stop);

  let reportExtra = r.report || '';
  if (r.confidence != null) {
    reportExtra += ' اطمینان مدل: ' + Math.round(r.confidence * 100).toLocaleString('fa-IR') + '٪.';
  }
  if (r.analysis?.fundamentalStatus === 'insufficient_data') {
    reportExtra += ' ' + (r.analysis.fundamentalMessage || '');
  }
  $('report').textContent = reportExtra;
  $('suggestionText').textContent = r.suggestion || 'شرایط برای پیشنهاد مشخص کافی نیست.';
  $('resultClock').textContent = formatNow().full;
  $('result').classList.add('show');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearAll() {
  // Clear form UI only — does NOT wipe other assets' storage
  $('current').value = '';
  $('data').value = '';
  $('priceToday').value = '';
  $('priceY1').value = '';
  $('priceY2').value = '';
  hideFileInfo();
  $('result').classList.remove('show');
  const csv = $('csv');
  if (csv) csv.value = '';
  const body = $('manualBody');
  if (body) {
    body.innerHTML = '';
    for (let i = 0; i < 5; i++) addTableRow();
  }
  setDataStatus('فرم پاک شد. داده‌های ذخیره‌شده دارایی‌ها دست‌نخورده ماندند.', 'ok');
  switchTab('paste');
  if (currentSymbol) refreshAssetPanel(currentSymbol);
}

function hideFileInfo() {
  $('fileName')?.classList.remove('show');
  if ($('fileNameText')) $('fileNameText').textContent = 'فایلی انتخاب نشده';
  if ($('fileMeta')) $('fileMeta').textContent = '';
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
  setupDailyDates();

  $('symbol').addEventListener('change', onSymbolChange);
  $('saveDailyBtn')?.addEventListener('click', saveDailyPrices);

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
    hideFileInfo();
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
    setDataStatus(`فایل خوانده شد. با «ثبت داده و تحلیل» روی دارایی انتخاب‌شده ذخیره می‌شود.`, 'ok');
  }

  $('analyzeBtn').addEventListener('click', runAnalysis);
  $('clearBtn').addEventListener('click', clearAll);

  // expose for tests
  window.__OMA_V5__ = { getCachedSymbols, dropSessionCache, buildAnalysisSeries, loadManual, loadHistorical };

  const sel = $('symbol');
  if (sel) {
    const allowed = new Set(SYMBOL_LIST);
    [...sel.options].forEach(opt => {
      if (opt.value && !allowed.has(opt.value)) opt.remove();
    });
  }
}

init();
