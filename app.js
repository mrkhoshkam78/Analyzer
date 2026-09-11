/**
 * UI Controller V5.05
 */
import { getSymbol, formatPrice, getAllSymbols, registerCustomAsset } from './logic/symbols.js';
import {
  loadHistorical, loadManual, setHistorical, upsertManualPrices,
  buildAnalysisSeries, getAssetSummary, dayKeyOffset, dayKey,
  getCachedSymbols, dropSessionCache, TIMEFRAMES, getTfMeta, timeBucketKey,
  getDataDayIndex
} from './logic/datasets.js';
import {
  FUND_VARS, FUND_VAR_IDS, runFundamental, getFundamentalData,
  upsertFundamentalVar, clearFundamentalVar, buildSnapshotFromStore,
  fundamentalSummaryFa
} from './logic/fundamental.js';
import {
  runAutoDebugger, getLastReport, getDebugHistory, getStatusEmoji,
  injectTestFaults, AUTO_DEBUGGER_VERSION, getDebugMemory, getRegressionMemory,
  emitRealtimeEvent, getCorrectionLog, getRealtimeState, onRealtimeEvent
} from './logic/autoDebugger.js';

const $ = (id) => document.getElementById(id);
let activeTab = 'paste';
let currentSymbol = null;
let currentTf = '1D';

function pad(n) { return String(n).padStart(2, '0'); }

function formatNow() {
  const d = new Date();
  const jalali = d.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const greg = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return { jalali, greg, time, full: `${jalali} · ${greg} · ${time}` };
}

function tickClock() {
  const { jalali, greg, time, full } = formatNow();
  if ($('clockJalali')) $('clockJalali').textContent = jalali;
  if ($('clockGregorian')) $('clockGregorian').textContent = greg;
  if ($('clockTime')) $('clockTime').textContent = time;
  if ($('resultClock') && $('result') && !$('result').hidden) $('resultClock').textContent = full;
}

function toast(msg, kind = 'ok') {
  const el = $('toast');
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
  el.className = 'toast show is-' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { el.hidden = true; }, 250); }, 2800);
}

function setHeaderData(text) {
  if ($('headerDataStatus')) $('headerDataStatus').textContent = text;
}
function setProcessing(on, msg = 'در حال پردازش…') {
  const el = $('processing');
  if (!el) return;
  if (on) {
    el.hidden = false;
    el.innerHTML = `<span class="spinner"></span><span>${msg}</span>`;
    $('analyzeBtn').disabled = true;
    setHeaderData('پردازش…');
  } else {
    el.hidden = true;
    el.innerHTML = '';
    $('analyzeBtn').disabled = false;
  }
}
function setDataStatus(msg, kind = '') {
  const el = $('dataStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'status-line' + (kind ? ' is-' + kind : '');
}

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab').forEach(btn => {
    const on = btn.dataset.tab === name;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  ['paste', 'table', 'file'].forEach(id => {
    const panel = $('panel' + id[0].toUpperCase() + id.slice(1));
    if (!panel) return;
    panel.hidden = id !== name;
    panel.classList.toggle('active', id === name);
  });
}

function renderAssetPicker() {
  const box = $('assetPicker');
  const sel = $('symbol');
  if (!box || !sel) return;
  const assets = getAllSymbols();
  box.innerHTML = '';
  sel.innerHTML = '<option value="">—</option>';
  for (const a of assets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'asset-btn';
    btn.dataset.symbol = a.symbol;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', a.symbol === currentSymbol ? 'true' : 'false');
    btn.innerHTML = `<span class="asset-btn-code">${a.symbol}</span>
      <span class="asset-btn-name">${a.nameFa}</span>
      <span class="asset-btn-unit">${a.typeFa || a.category || ''} · ${a.unitFa || a.unit}</span>`;
    btn.addEventListener('click', () => selectAsset(a.symbol));
    box.appendChild(btn);
    const opt = document.createElement('option');
    opt.value = a.symbol;
    opt.textContent = a.symbol;
    sel.appendChild(opt);
  }
  if (currentSymbol) sel.value = currentSymbol;
}

function selectAsset(symbol) {
  const meta = getSymbol(symbol);
  if (!meta) return;
  currentSymbol = symbol;
  $('symbol').value = symbol;
  document.querySelectorAll('.asset-btn').forEach(b => {
    b.setAttribute('aria-selected', b.dataset.symbol === symbol ? 'true' : 'false');
  });
  onSymbolChange();
}

function updateSmartDateTimeUI() {
  const meta = getTfMeta(currentTf);
  const hour = $('fieldHour');
  const minute = $('fieldMinute');
  if (hour) hour.hidden = !(meta.kind === 'hour' || meta.kind === 'minute');
  if (minute) minute.hidden = meta.kind !== 'minute';
  if (!$('priceDate').value) $('priceDate').value = dayKeyOffset(0);
}

function onSymbolChange() {
  const id = $('symbol').value;
  const meta = getSymbol(id);
  if (!meta) {
    if ($('assetChip')) $('assetChip').hidden = true;
    if ($('dailyCard')) $('dailyCard').hidden = true;
    currentSymbol = null;
    if ($('headerAsset')) $('headerAsset').textContent = '—';
    setHeaderData('آماده');
    return;
  }
  currentSymbol = id;
  currentTf = $('tf').value || '1D';
  $('chipSym').textContent = meta.symbol;
  $('chipName').textContent = meta.nameFa;
  $('chipMeta').textContent = `${meta.typeFa} · ${meta.unitFa} · ${currentTf}`;
  if ($('assetChip')) $('assetChip').hidden = false;
  if ($('headerAsset')) $('headerAsset').textContent = meta.symbol;
  refreshAssetPanel(id);
}

function refreshAssetPanel(symbol) {
  const card = $('dailyCard');
  const meta = getSymbol(symbol);
  if (!meta) {
    if (card) card.hidden = true;
    return;
  }
  currentTf = $('tf').value || '1D';
  loadHistorical(symbol, currentTf);
  loadManual(symbol, currentTf);
  refreshDayIndex();
  if ($('smartCal') && !$('smartCal').hidden) renderSmartCal();
  if (card) card.hidden = false;
  if ($('fundFormBox')) renderFundPanel(symbol);
  updateSmartDateTimeUI();
  const sum = getAssetSummary(symbol, currentTf);
  if ($('assetDataHint')) {
    $('assetDataHint').textContent =
      `${symbol} · ${currentTf} · تاریخچه ${sum.histCount.toLocaleString('fa-IR')} · دستی ${sum.manualCount.toLocaleString('fa-IR')}`;
  }
  setHeaderData(`${symbol}/${currentTf}`);
  renderManualList(symbol);
  if ($('dailyDesc')) {
    $('dailyDesc').textContent = `قیمت باز و بسته برای ${meta.nameFa} · بازه ${currentTf}`;
  }
  if ($('priceOpen')) $('priceOpen').value = '';
  if ($('priceClose')) $('priceClose').value = '';
}

function renderManualList(symbol) {
  const box = $('manualList');
  if (!box) return;
  const manual = loadManual(symbol, currentTf).slice().reverse().slice(0, 20);
  if (!manual.length) {
    box.innerHTML = '<p class="card-desc">هنوز رکورد دستی برای این بازه نیست.</p>';
    return;
  }
  box.innerHTML = '<div class="manual-list-title">رکوردهای دستی (باز / بسته)</div>' +
    manual.map(m => `<div class="manual-item"><span>${m.bucket}</span><strong>${formatPrice(m.open, symbol)} → ${formatPrice(m.close, symbol)}</strong></div>`).join('');
}

function buildDateTimeFromForm() {
  const date = $('priceDate').value;
  if (!date) return null;
  const meta = getTfMeta(currentTf);
  let h = 12, m = 0;
  if (meta.kind === 'hour' || meta.kind === 'minute') {
    h = Number($('priceHour').value);
    if (!Number.isFinite(h) || h < 0 || h > 23) h = 0;
  }
  if (meta.kind === 'minute') {
    m = Number($('priceMinute').value);
    if (!Number.isFinite(m) || m < 0 || m > 59) m = 0;
  }
  const d = new Date(`${date}T${pad(h)}:${pad(m)}:00`);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function saveDailyPrice(e) {
  if (e) e.preventDefault();
  const sym = currentSymbol || $('symbol').value;
  if (!sym || !getSymbol(sym)) {
    toast('ابتدا دارایی را انتخاب کنید', 'err');
    return;
  }
  currentTf = $('tf').value || '1D';
  const open = Number($('priceOpen').value);
  const close = Number($('priceClose').value);
  if (!Number.isFinite(open) || open <= 0 || !Number.isFinite(close) || close <= 0) {
    toast('قیمت باز و بسته باید عدد معتبر بزرگ‌تر از صفر باشند', 'err');
    return;
  }
  const dt = buildDateTimeFromForm();
  if (!dt) {
    toast('تاریخ/زمان نامعتبر است', 'err');
    return;
  }
  const res = upsertManualPrices(sym, [{
    datetime: dt.toISOString(),
    open,
    close,
    ts: dt.getTime()
  }], currentTf);
  refreshAssetPanel(sym);
  refreshDayIndex();
  if ($('smartCal') && !$('smartCal').hidden) renderSmartCal();
  toast(`ثبت شد: ${sym} ${timeBucketKey(dt, currentTf)}`, 'ok');
  setDataStatus(`دستی ${sym}/${currentTf}: ${res.total} رکورد · وارد Analysis سری می‌شود`, 'ok');
  // Optional auto-refresh analysis if enough data
  const series = buildAnalysisSeries(sym, currentTf);
  if (series.candles.length >= 30) {
    runAnalysis(true);
  }
}

function addTableRow(data = null) {
  const tbody = $('manualBody');
  if (!tbody) return;
  const r = data || { date: '', o: '', h: '', l: '', c: '', v: '' };
  const tr = document.createElement('tr');
  const esc = v => (v == null ? '' : String(v).replace(/"/g, '&quot;'));
  tr.innerHTML = `<td><input class="cell" data-k="date" value="${esc(r.date)}"></td>
    <td><input class="cell" type="number" step="any" data-k="o" value="${esc(r.o)}"></td>
    <td><input class="cell" type="number" step="any" data-k="h" value="${esc(r.h)}"></td>
    <td><input class="cell" type="number" step="any" data-k="l" value="${esc(r.l)}"></td>
    <td><input class="cell" type="number" step="any" data-k="c" value="${esc(r.c)}"></td>
    <td><input class="cell" type="number" step="any" data-k="v" value="${esc(r.v)}"></td>
    <td><button type="button" class="row-del">×</button></td>`;
  tr.querySelector('.row-del').onclick = () => { tr.remove(); if (!tbody.children.length) addTableRow(); };
  tbody.appendChild(tr);
}
function tableToText() {
  const lines = ['Date,Open,High,Low,Close,Volume'];
  $('manualBody')?.querySelectorAll('tr').forEach(tr => {
    const g = k => tr.querySelector(`[data-k="${k}"]`)?.value.trim() || '';
    if (!g('o') && !g('c')) return;
    lines.push([g('date'), g('o'), g('h'), g('l'), g('c'), g('v')].join(','));
  });
  return lines.join('\n');
}
function collectImportText() {
  return activeTab === 'table' ? tableToText() : ($('data').value || '').trim();
}

async function importHistoricalIfAny(sym, tf) {
  const text = collectImportText();
  if (!text || text.split(/\n/).filter(Boolean).length < 2) return { imported: 0 };
  const { parseOHLCV } = await import('./logic/analysis.js');
  const { candles, error } = parseOHLCV(text);
  if (error || !candles.length) return { imported: 0, error };
  const withMeta = candles.map(c => ({
    ...c,
    day: c.ts != null ? dayKey(c.ts) : null,
    bucket: c.ts != null ? timeBucketKey(c.ts, tf) : null
  }));
  return { imported: setHistorical(sym, withMeta, tf) };
}

async function runAnalysis(silent = false) {
  const sym = currentSymbol || $('symbol').value;
  if (!sym || !getSymbol(sym)) {
    if (!silent) toast('دارایی را انتخاب کنید', 'err');
    return;
  }
  currentTf = $('tf').value || '1D';
  setProcessing(true, 'ساخت Analysis Series…');
  $('result').hidden = true;
  try {
    const imp = await importHistoricalIfAny(sym, currentTf);
    if (imp.error && collectImportText().length > 20) {
      setProcessing(false);
      toast(imp.error, 'err');
      return;
    }
    const series = buildAnalysisSeries(sym, currentTf);
    refreshAssetPanel(sym);
    if (!series.hasFullOHLC || series.candles.length < 30) {
      setProcessing(false);
      const msg = `${sym}/${currentTf}: حداقل ۳۰ کندل لازم است (فعلی ${series.mergedCount}).`;
      setDataStatus(msg, 'warn');
      if (!silent) toast(msg, 'err');
      return;
    }
    const uiPrice = parseFloat($('current').value);
    const currentPrice = Number.isFinite(uiPrice) && uiPrice > 0 ? uiPrice : series.currentPrice;
    const { analyze } = await import('./logic/analysis.js');
    const fundSnap = buildSnapshotFromStore(sym);
    const result = analyze(series.candles, {
      currentPrice, symbol: sym, timeframe: currentTf, recordPrediction: true,
      fundamentalSnapshot: Object.keys(fundSnap).length ? fundSnap : null
    });
    setProcessing(false);
    setHeaderData(`${sym}/${currentTf} · ${series.mergedCount} کندل`);
    setDataStatus(
      `سری ${series.mergedCount} · تاریخچه ${series.histCount} · دستی ${series.manualCount} · قیمت باز/بسته در موتور تحلیل`,
      'ok'
    );
    showResult(result, sym);
    // Real-Time Monitor: forecast generated
    try {
      const rt = emitRealtimeEvent('forecast_generated', {
        candles: series.candles,
        decision: result,
        currentPrice,
        symbol: sym
      });
      if (rt.blocked) {
        toast('🔴 خروجی تاییدنشده — Auto Debugger مسدود کرد', 'err');
      } else if (rt.status === 'WARNING' && rt.correction?.action === 'PROPOSE') {
        toast('🟡 پیشنهاد اصلاح: ' + (rt.correction.message || rt.message), 'err');
      }
    } catch (e) { console.warn('RT monitor', e); }
    // Non-blocking quick Auto Debugger after successful analysis
    quickDebuggerAfterAnalysis(series.candles, sym, currentPrice);
  } catch (err) {
    setProcessing(false);
    toast(err.message || 'خطا', 'err');
  }
}

const SIGNAL_FA = { BUY: 'خرید', HOLD: 'نگهداری', SELL: 'فروش' };
const TREND_FA = { 'Strong Bullish': 'قوی صعودی', Bullish: 'صعودی', Neutral: 'خنثی', Bearish: 'نزولی', 'Strong Bearish': 'قوی نزولی' };
const RISK_FA = { High: 'بالا', Medium: 'متوسط', Low: 'پایین' };
const ICONS = {
  BUY: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  SELL: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`,
  HOLD: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 12h8"/></svg>`
};

function showResult(r, symbolId) {
  if (!r?.ok) { toast(r?.error || 'تحلیل ناموفق', 'err'); return; }
  const sig = r.signal;
  $('signalPanel').className = 'signal-hero ' + sig;
  $('signal').className = 'signal-value ' + sig;
  $('signalText').textContent = SIGNAL_FA[sig] || sig;
  $('signalIcon').innerHTML = ICONS[sig] || ICONS.HOLD;
  $('scoreContext').textContent = `${symbolId} · ${currentTf}`;
  $('score').textContent = `امتیاز ${r.score.toLocaleString('fa-IR')}`;
  $('bar').style.width = r.score + '%';
  const trendEl = $('trend');
  trendEl.textContent = TREND_FA[r.trend] || r.trend;
  trendEl.className = 'metric-v' + (/Bull/.test(r.trend) ? ' trend-bull' : /Bear/.test(r.trend) ? ' trend-bear' : '');
  const riskEl = $('risk');
  riskEl.textContent = RISK_FA[r.riskLevel] || r.riskLevel;
  riskEl.className = 'metric-v' + (r.riskLevel === 'High' ? ' risk-high' : r.riskLevel === 'Low' ? ' risk-low' : '');
  const fmt = n => formatPrice(n, symbolId);
  $('support').textContent = fmt(r.support);
  $('resistance').textContent = fmt(r.resistance);
  $('target').textContent = fmt(r.target);
  $('stop').textContent = fmt(r.stop);
  let report = r.report || '';
  if (r.confidence != null) report += ` اطمینان: ${Math.round(r.confidence * 100).toLocaleString('fa-IR')}٪.`;
  // Surface adaptive MACD / Fibonacci from analysis factors or indicators
  const factors = r.analysis?.factors || r.factors || [];
  const macdF = factors.find(f => f.key === 'macd');
  const fibF = factors.find(f => f.key === 'fibonacci');
  if (macdF) report += ' ' + macdF.text + '.';
  if (fibF) report += ' ' + fibF.text + '.';
  if (r.macdPeriods) {
    report += ` MACD(${r.macdPeriods.fast}/${r.macdPeriods.slow}/${r.macdPeriods.signal}).`;
  }
  // Layer scores
  const techSc = r.analysis?.technicalScore;
  const fundSc = r.analysis?.fundamentalScore;
  const combSc = r.analysis?.combinedScore ?? r.score;
  if (techSc != null) report += ` تکنیکال: ${techSc}.`;
  if (fundSc != null) report += ` فاندامنتال: ${fundSc}.`;
  if (r.fundamentalApplied) report += ' ترکیب اعمال شد.';
  else report += ' فاندامنتال در ترکیب لحاظ نشد.';
  $('report').textContent = report;
  $('suggestionText').textContent = r.suggestion || '—';

  // Optional dedicated score rows if elements exist
  if ($('techScoreVal')) $('techScoreVal').textContent = techSc != null ? techSc : '—';
  if ($('fundScoreVal')) $('fundScoreVal').textContent = fundSc != null ? fundSc : '—';
  if ($('combScoreVal')) $('combScoreVal').textContent = combSc != null ? combSc : '—';
  if ($('confVal')) $('confVal').textContent = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '—';

  // Fundamental factors list
  const fundBox = $('fundFactorsBox');
  if (fundBox) {
    const ff = r.analysis?.fundamentalFactors || [];
    if (ff.length) {
      fundBox.innerHTML = ff.map(f => {
        const cls = f.dir === 'bull' ? 'bull' : f.dir === 'bear' ? 'bear' : 'neu';
        return `<div class="fund-factor ${cls}"><span>${f.nameFa || f.key}</span><span class="mono">${f.contribution > 0 ? '+' : ''}${f.contribution}</span></div>`;
      }).join('');
      fundBox.hidden = false;
    } else {
      fundBox.innerHTML = '<p class="card-desc">داده فاندامنتال ثبت نشده</p>';
      fundBox.hidden = false;
    }
  }

  $('resultClock').textContent = formatNow().full;
  $('result').hidden = false;
  if ($('scoreLayers')) $('scoreLayers').hidden = false;
  renderFundPanel(symbolId);
}

function clearAll() {
  $('current').value = '';
  $('data').value = '';
  $('priceOpen').value = '';
  $('priceClose').value = '';
  $('result').hidden = true;
  if ($('csv')) $('csv').value = '';
  const body = $('manualBody');
  if (body) { body.innerHTML = ''; for (let i = 0; i < 4; i++) addTableRow(); }
  setDataStatus('فرم پاک شد؛ Dataset ذخیره‌شده حفظ شد.', 'ok');
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


/* —— Smart Data Calendar —— */
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-11
let dayIndexCache = null; // { day: count } for current asset+tf

function refreshDayIndex() {
  if (!currentSymbol) {
    dayIndexCache = Object.create(null);
    return dayIndexCache;
  }
  dayIndexCache = getDataDayIndex(currentSymbol, currentTf || '1D') || Object.create(null);
  return dayIndexCache;
}

function renderSmartCal() {
  const grid = $('calGrid');
  const label = $('calMonthLabel');
  if (!grid || !label) return;
  const idx = dayIndexCache || Object.create(null);
  const first = new Date(calYear, calMonth, 1);
  const startPad = (first.getDay() + 6) % 7; // Monday=0 … adapt for Sat-start Persian-ish: use Sat=0
  // Week starts Saturday for fa UI
  const jsDay = first.getDay(); // 0 Sun
  const pad = (jsDay + 1) % 7; // Sat=0
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const selected = ($('priceDate')?.value || '');
  const today = dayKeyOffset(0);

  const monthNames = ['ژانویه','فوریه','مارس','آوریل','مه','ژوئن','ژوئیه','اوت','سپتامبر','اکتبر','نوامبر','دسامبر'];
  label.textContent = `${monthNames[calMonth]} ${calYear}`;

  const parts = [];
  for (let i = 0; i < pad; i++) {
    parts.push('<button type="button" class="cal-day is-other" disabled></button>');
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = idx[key] || 0;
    const classes = ['cal-day'];
    if (key === today) classes.push('is-today');
    if (key === selected) classes.push('is-selected');
    if (count > 0) classes.push('has-data');
    const title = count > 0 ? `داده موجود (${count})` : 'بدون داده';
    const pulse = count > 0 ? '<span class="cal-pulse" aria-hidden="true"></span>' : '';
    parts.push(
      `<button type="button" class="${classes.join(' ')}" data-day="${key}" title="${title}" aria-label="${key}${count ? ' — داده موجود' : ''}">${d}${pulse}</button>`
    );
  }
  grid.innerHTML = parts.join('');
  grid.querySelectorAll('.cal-day[data-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = btn.getAttribute('data-day');
      if ($('priceDate')) $('priceDate').value = day;
      renderSmartCal();
    });
  });
}

function openSmartCal(force) {
  const panel = $('smartCal');
  const toggle = $('calToggle');
  if (!panel || !toggle) return;
  let open;
  if (force === true) open = true;
  else if (force === false) open = false;
  else open = panel.hidden; // toggle: if currently hidden → open
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    refreshDayIndex();
    const sel = $('priceDate')?.value;
    if (sel && /^\d{4}-\d{2}-\d{2}$/.test(sel)) {
      calYear = +sel.slice(0, 4);
      calMonth = +sel.slice(5, 7) - 1;
    }
    renderSmartCal();
  }
}


/* —— Fundamental Analysis UI —— */
function renderFundPanel(symbolId) {
  const sym = symbolId || currentSymbol;
  const box = $('fundFormBox');
  if (!box) return;
  if (!sym) {
    box.innerHTML = '<p class="card-desc">ابتدا یک نماد انتخاب کنید.</p>';
    return;
  }
  const data = getFundamentalData(sym);
  const fund = runFundamental(sym);
  let html = `<div class="fund-head"><strong>${sym}</strong> · ${fundamentalSummaryFa(fund)}</div>`;
  html += '<div class="fund-vars">';
  for (const v of FUND_VARS) {
    const rec = data[v.id] || {};
    html += `
      <div class="fund-var-card" data-var="${v.id}">
        <div class="fund-var-title">${v.nameFa} <span class="muted">(${v.nameEn})</span></div>
        <div class="fund-var-grid">
          <label>واقعی <input type="number" step="any" class="input mono fund-in" data-f="actual" value="${rec.actual ?? ''}"></label>
          <label>پیش‌بینی <input type="number" step="any" class="input mono fund-in" data-f="forecast" value="${rec.forecast ?? ''}"></label>
          <label>قبلی <input type="number" step="any" class="input mono fund-in" data-f="previous" value="${rec.previous ?? ''}"></label>
          <label>تاریخ <input type="date" class="input fund-in" data-f="date" value="${rec.date ?? ''}"></label>
        </div>
        <div class="fund-meta mono">
          تغییر: ${rec.change != null ? rec.change : '—'} · غافلگیری: ${rec.surprise != null ? rec.surprise : '—'}
        </div>
        <div class="fund-var-actions">
          <button type="button" class="btn btn-sm btn-primary fund-save" data-var="${v.id}">ذخیره</button>
          <button type="button" class="btn btn-sm btn-ghost fund-clear" data-var="${v.id}">پاک</button>
        </div>
      </div>`;
  }
  html += '</div>';
  if (fund.ok) {
    html += `<div class="fund-score-box">امتیاز بنیادی: <strong>${fund.score}</strong> · پوشش: ${Math.round(fund.coverage*100)}٪ · ${fund.outlook}</div>`;
    html += '<div class="fund-factors-live">';
    for (const f of fund.factors) {
      const cls = f.dir === 'bull' ? 'bull' : f.dir === 'bear' ? 'bear' : 'neu';
      html += `<div class="fund-factor ${cls}"><span>${f.nameFa}</span><span>وزن ${Math.round(f.weight*100)}٪ · اثر ${f.contribution > 0 ? '+' : ''}${f.contribution}</span></div>`;
    }
    html += '</div>';
  } else {
    html += `<p class="status-line is-warn">${fund.message || 'داده ناکافی'}</p>`;
  }
  box.innerHTML = html;

  box.querySelectorAll('.fund-save').forEach(btn => {
    btn.onclick = () => {
      const varId = btn.dataset.var;
      const card = btn.closest('.fund-var-card');
      const payload = {};
      card.querySelectorAll('.fund-in').forEach(inp => {
        payload[inp.dataset.f] = inp.value;
      });
      const res = upsertFundamentalVar(sym, varId, payload);
      if (res.ok) {
        toast('داده فاندامنتال ذخیره شد', 'ok');
        renderFundPanel(sym);
      } else {
        toast(res.error || 'خطا', 'err');
      }
    };
  });
  box.querySelectorAll('.fund-clear').forEach(btn => {
    btn.onclick = () => {
      clearFundamentalVar(sym, btn.dataset.var);
      toast('پاک شد', 'ok');
      renderFundPanel(sym);
    };
  });
}

function switchView(view) {
  // Dedicated panels that replace main flow content
  const dedicated = ['fundamental', 'backtest', 'debugger'];
  document.querySelectorAll('.view-panel').forEach(p => { p.hidden = true; });
  document.querySelectorAll('.side-link').forEach(a => a.classList.remove('active'));

  const link = document.querySelector(`.side-link[data-view="${view}"]`);
  if (link) link.classList.add('active');

  // Hide/show main analysis cards (everything in main that is not a view-panel)
  const mainCards = document.querySelectorAll('.main > .card:not(.view-panel), .main > section:not(.view-panel)');
  if (dedicated.includes(view)) {
    mainCards.forEach(c => { c.dataset._prevHidden = c.hidden ? '1' : '0'; c.hidden = true; });
    if ($('result')) $('result').hidden = true;
    if ($('scoreLayers')) $('scoreLayers').hidden = true;
    const panel = document.getElementById('view-' + view);
    if (panel) panel.hidden = false;
    if (view === 'fundamental' && currentSymbol) renderFundPanel(currentSymbol);
    if (view === 'backtest') {
      // keep status clear
      if ($('btStatus')) $('btStatus').textContent = currentSymbol
        ? `نماد فعال: ${currentSymbol} — داده قیمت را قبلاً وارد کرده باشید.`
        : 'ابتدا نماد و داده قیمت را انتخاب/وارد کنید.';
    }
    if (view === 'debugger') {
      renderDebuggerPanel();
    }
  } else {
    // Restore main cards
    mainCards.forEach(c => {
      if (c.id === 'result' || c.id === 'dailyCard') return; // managed elsewhere
      c.hidden = false;
    });
    if (currentSymbol && $('dailyCard')) $('dailyCard').hidden = false;
    // dedicated stay hidden
  }
  // close mobile sidebar
  if (typeof window.__closeSidebar === 'function') window.__closeSidebar();
  else {
    $('sidebar')?.classList.remove('is-open');
    document.body.classList.remove('sidebar-open');
    const ov = $('sidebarOverlay');
    if (ov) { ov.hidden = true; ov.classList.remove('is-visible'); }
  }
}


async function runBacktestUI() {
  const status = $('btStatus');
  const metrics = $('btMetrics');
  const samples = $('btSamples');
  if (!currentSymbol) {
    toast('ابتدا نماد را انتخاب کنید', 'err');
    return;
  }
  if (status) status.textContent = 'در حال اجرای بک‌تست…';
  if (metrics) { metrics.hidden = true; metrics.innerHTML = ''; }
  if (samples) { samples.hidden = true; samples.innerHTML = ''; }

  try {
    const series = buildAnalysisSeries(currentSymbol, currentTf);
    if (!series || !series.candles || series.candles.length < 40) {
      const msg = `داده کافی نیست (${series?.candles?.length || 0} کندل). حداقل ~40 لازم است.`;
      if (status) status.textContent = msg;
      toast(msg, 'err');
      return;
    }
    const { runBacktest } = await import('./logic/backtest.js');
    const horizon = Number($('btHorizon')?.value || 5);
    const step = Number($('btStep')?.value || 5);
    const mode = $('btMode')?.value || 'combined';
    const result = runBacktest(series.candles, {
      symbol: currentSymbol,
      horizon,
      step,
      mode,
      timeframe: currentTf
    });
    if (!result.ok) {
      if (status) status.textContent = result.error || 'بک‌تست ناموفق';
      toast(result.error || 'خطا', 'err');
      return;
    }
    if (status) {
      status.textContent = `بک‌تست کامل · ${result.n} پیش‌بینی · افق ${result.horizon} · مدل ${result.mode}` +
        (result.fundUsed ? ' · بنیادی اعمال شد' : ' · فقط تکنیکال');
    }
    if (metrics) {
      const aCls = result.accuracy >= 55 ? 'good' : result.accuracy < 45 ? 'bad' : '';
      metrics.innerHTML = `
        <div class="bt-metric"><div class="k">دقت</div><div class="v ${aCls}">${result.accuracy}%</div></div>
        <div class="bt-metric"><div class="k">دقت جهتی</div><div class="v">${result.directionalAccuracy}%</div></div>
        <div class="bt-metric"><div class="k">صحت</div><div class="v">${result.precision}%</div></div>
        <div class="bt-metric"><div class="k">بازیابی</div><div class="v">${result.recall}%</div></div>
        <div class="bt-metric"><div class="k">F1</div><div class="v">${result.f1}%</div></div>
        <div class="bt-metric"><div class="k">سیگنال غلط</div><div class="v">${result.falseSignalRate}%</div></div>
        <div class="bt-metric"><div class="k">نرخ برد</div><div class="v">${result.winRate}%</div></div>
        <div class="bt-metric"><div class="k">میانگین خطا</div><div class="v">${result.avgErrorPct}%</div></div>
        <div class="bt-metric"><div class="k">نسبت سود/زیان</div><div class="v">${result.avgRiskReward ?? '—'}</div></div>
        <div class="bt-metric"><div class="k">تعداد نمونه</div><div class="v">${result.n}</div></div>
      `;
      metrics.hidden = false;
    }
    if (samples && result.samples?.length) {
      let rows = result.samples.map(p => {
        const cls = p.result === 'correct' ? 'ok' : p.result === 'wrong' ? 'bad' : '';
        return `<tr class="${cls}">
          <td>${p.result}</td>
          <td>${p.predictionDate}</td>
          <td class="mono">${Number(p.entryPrice).toFixed(4)}</td>
          <td>${p.predictedDirection}</td>
          <td class="mono">${p.combinedScore}</td>
          <td class="mono">${(p.confidence*100).toFixed(0)}%</td>
          <td class="mono">${Number(p.actualFuturePrice).toFixed(4)}</td>
          <td>${p.actualDirection}</td>
          <td class="mono">${p.actualReturnPct}%</td>
          <td class="mono">${p.mfe}% / ${p.mae}%</td>
        </tr>`;
      }).join('');
      samples.innerHTML = `<table>
        <thead><tr>
          <th>نتیجه</th><th>تاریخ</th><th>ورود</th><th>جهت پیش‌بینی</th><th>امتیاز</th><th>اطمینان</th>
          <th>قیمت آینده</th><th>جهت واقعی</th><th>بازده</th><th>بهترین/بدترین</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="card-desc" style="margin-top:0.5rem">نمونه از ${result.n} پیش‌بینی · دقت واقعی: ${result.accuracy}٪ (بدون حذف موارد ناموفق)</p>`;
      samples.hidden = false;
    }
    toast(`بک‌تست: دقت ${result.accuracy}٪`, result.accuracy >= 50 ? 'ok' : 'err');
  } catch (err) {
    console.error(err);
    if (status) status.textContent = 'خطا: ' + (err.message || err);
    toast('خطای بک‌تست', 'err');
  }
}



/* ── Auto Debugger UI ── */
function renderDebuggerPanel() {
  const last = getLastReport();
  if (last) applyDebuggerReport(last);
  else {
    if ($('adStatusIcon')) $('adStatusIcon').textContent = '⚪';
    if ($('adStatusText')) $('adStatusText').textContent = 'هنوز اسکنی اجرا نشده — بررسی سریع یا عمیق را بزنید';
    if ($('adStatusPill')) $('adStatusPill').textContent = 'آماده';
    if ($('adMetrics')) $('adMetrics').hidden = true;
    if ($('adReport')) { $('adReport').hidden = true; $('adReport').innerHTML = ''; }
  }
}

function applyDebuggerReport(report) {
  if (!report) return;
  const emoji = getStatusEmoji(report.status);
  if ($('adStatusIcon')) $('adStatusIcon').textContent = emoji;
  const statusFa = { HEALTHY: 'سیستم سالم', WARNING: 'هشدارها یافت شد', CRITICAL: 'خطای بحرانی' }[report.status] || report.status;
  if ($('adStatusText')) $('adStatusText').textContent = statusFa;
  if ($('adStatusPill')) {
    $('adStatusPill').textContent = statusFa;
    $('adStatusPill').className = 'status-pill is-' + (report.status === 'HEALTHY' ? 'ok' : report.status === 'CRITICAL' ? 'err' : 'warn');
  }
  if ($('adMetrics')) {
    $('adMetrics').hidden = false;
    if ($('adTests')) $('adTests').textContent = report.testsRun;
    if ($('adPassed')) $('adPassed').textContent = report.passed;
    if ($('adFailed')) $('adFailed').textContent = report.failed;
    if ($('adWarnings')) $('adWarnings').textContent = report.warnings;
    if ($('adDuration')) $('adDuration').textContent = report.durationMs + ' ms';
    if ($('adMode')) $('adMode').textContent = report.mode === 'deep' ? 'عمیق' : 'سریع';
  }
  const rep = $('adReport');
  if (rep) {
    rep.hidden = false;
    const items = [];
    if (report.healthScore != null) {
      items.push(`<div class="ad-bug is-INFO">🩺 System Health Score: <strong>${report.healthScore}/100</strong></div>`);
    }
    if (report.fixes && report.fixes.length) {
      const okN = report.fixes.filter(f => f.result === 'ok' || (typeof f.result === 'string' && String(f.result).includes('marked'))).length;
      items.push(`<div class="ad-bug is-INFO">🔧 اصلاحات: ${report.fixes.length} اقدام · موفق ${okN}</div>`);
      for (const f of report.fixes.slice(0, 6)) {
        items.push(`<div class="ad-bug is-INFO">🔧 ${f.action}: ${f.result}</div>`);
      }
    }
    if (report.fixProposals && report.fixProposals.length) {
      items.push(`<div class="ad-bug is-MEDIUM">🟡 ${report.fixProposals.length} مورد نیازمند بررسی دستی (فرمول/Forecast تغییر نمی‌کند)</div>`);
    }
    if (report.predictionAudit && report.predictionAudit.ok !== false) {
      const a = report.predictionAudit;
      const trustIcon = { TRUSTED: '🟢', CAUTION: '🟡', REJECT: '🔴' }[a.trustStatus] || '⚪';
      items.push(`<div class="ad-bug is-INFO">${trustIcon} Prediction Audit · Trust: <strong>${a.trustStatus || '—'}</strong>` +
        (a.auditScore != null ? ` · Audit Score: ${a.auditScore}/100` : '') +
        (a.declaredConfidence != null ? `\nConfidence اعلام‌شده: ${Math.round(a.declaredConfidence)}%` : '') +
        (a.defendedConfidence != null ? ` · قابل دفاع: ${Math.round(a.defendedConfidence)}%` : '') +
        `</div>`);
    }
    if (report.calibration && report.calibration.status !== 'SKIPPED' && !report.calibration.skipped) {
      const c = report.calibration;
      items.push(`<div class="ad-bug is-INFO">📐 Calibration: <strong>${c.overall || c.status}</strong>` +
        (c.sampleCount != null ? ` · نمونه‌ها: ${c.sampleCount}` : '') +
        (c.message ? `\n${c.message}` : '') + `</div>`);
    }
    if (report.realtime) {
      const rt = report.realtime;
      const st = rt.state || {};
      items.push(`<div class="ad-bug is-INFO">⚡ Real-Time · Corrections: ${st.correctionsAccepted || 0} · Rollbacks: ${st.correctionsRolledBack || 0} · Blocked: ${st.blockedOutputs || 0} · Loops: ${st.loopsDetected || 0}</div>`);
      for (const c of (rt.recentCorrections || []).slice(0, 3)) {
        items.push(`<div class="ad-bug is-INFO">⚡ ${c.action || c.level} · ${c.message || c.correctionId || ''}</div>`);
      }
    }
    if (report.anomalySummary && report.anomalySummary.count > 0) {
      items.push(`<div class="ad-bug is-MEDIUM">🕵️ Anomalies: ${report.anomalySummary.count} · max score ${report.anomalySummary.maxAnomalyScore || '—'}/100</div>`);
      for (const an of (report.anomalies || []).slice(0, 5)) {
        items.push(`<div class="ad-bug is-${an.severity || 'LOW'}">🕵️ ${an.type} · ${an.classification || ''} · score ${an.anomalyScore}\n${an.observedPattern || ''} — ${an.possibleCause || ''}</div>`);
      }
    }
    if (report.repeatedBugs > 0) {
      items.push(`<div class="ad-bug is-MEDIUM">🧠 Debug Memory: ${report.repeatedBugs} الگوی تکراری از خطاهای قبلی</div>`);
    }
    for (const b of (report.bugs || [])) {
      let extra = '';
      if (b.rootCauseChain?.rootCause) extra += `\nRoot Cause: ${b.rootCauseChain.rootCause}`;
      if (b.occurrenceCount > 1) extra += `\nتکرار: ${b.occurrenceCount} بار`;
      items.push(`<div class="ad-bug is-${b.severity}">${escapeHtml(userMsgFromBug(b) + extra)}</div>`);
    }
    for (const w of (report.warningItems || []).slice(0, 8)) {
      items.push(`<div class="ad-bug is-${w.severity || 'INFO'}">${escapeHtml(userMsgFromBug(w))}</div>`);
    }
    if (!(report.bugs || []).length && !(report.warningItems || []).length) {
      items.push(`<div class="ad-bug is-INFO">🟢 هیچ خطایی یافت نشد. محاسبات و اینورینت‌ها در محدوده مجاز هستند.</div>`);
    }
    if (report.historicalSummary) {
      const s = report.historicalSummary;
      items.push(`<div class="ad-bug is-INFO">تست تاریخی: صحیح ${s.correct} · غلط ${s.wrong} · خنثی ${s.neutral}` +
        (s.dirAcc != null ? ` · دقت جهتی ${s.dirAcc.toFixed(1)}%` : '') + `</div>`);
    }
    rep.innerHTML = items.join('');
  }
  const adv = $('adAdvanced');
  const body = $('adAdvancedBody');
  if (adv && body) {
    adv.hidden = false;
    const slim = {
      version: report.version,
      appVersion: report.appVersion,
      status: report.status,
      healthScore: report.healthScore,
      sections: report.sections,
      snapshot: report.snapshot,
      predictionAudit: report.predictionAudit,
      calibration: report.calibration,
      anomalySummary: report.anomalySummary,
      bugs: (report.bugs || []).map(b => ({
        id: b.id, cat: b.category, sev: b.severity, mod: b.module,
        exp: b.expected, act: b.actual, occ: b.occurrenceCount,
        root: b.rootCauseChain?.rootCause
      })),
      durationMs: report.durationMs
    };
    body.textContent = JSON.stringify(slim, null, 2);
  }
}

function userMsgFromBug(b) {
  const sevIcon = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵', INFO: 'ℹ️' }[b.severity] || '⚠️';
  let msg = `${sevIcon} ${b.category}`;
  if (b.module) msg += ` · ${b.module}`;
  if (b.expected != null && b.actual != null) {
    msg += `\nمقدار مورد انتظار: ${b.expected}\nمقدار سیستم: ${b.actual}`;
    if (b.difference != null) msg += `\nاختلاف: ${b.difference}`;
  }
  if (b.possibleRootCause) msg += `\nعلت احتمالی: ${b.possibleRootCause}`;
  return msg;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function getCandlesForDebugger() {
  if (!currentSymbol) return [];
  try {
    const series = buildAnalysisSeries(currentSymbol, currentTf);
    return series?.candles || series?.ohlcv || [];
  } catch {
    return [];
  }
}

async function runDebuggerUI(mode) {
  const btnQ = $('adQuickBtn');
  const btnD = $('adDeepBtn');
  if (btnQ) btnQ.disabled = true;
  if (btnD) btnD.disabled = true;
  if ($('adStatusText')) $('adStatusText').textContent = mode === 'deep' ? 'در حال بررسی عمیق…' : 'در حال بررسی سریع…';
  if ($('adStatusIcon')) $('adStatusIcon').textContent = '⏳';
  try {
    const candles = await getCandlesForDebugger();
    let currentPrice = null;
    const el = $('current');
    if (el && el.value) {
      const v = Number(el.value);
      if (Number.isFinite(v) && v > 0) currentPrice = v;
    }
    let fundSnap = null;
    try {
      if (currentSymbol) fundSnap = buildSnapshotFromStore(currentSymbol);
    } catch { /* optional */ }

    const report = await runAutoDebugger({
      mode,
      candles,
      symbol: currentSymbol,
      currentPrice,
      fundamentalSnapshot: fundSnap,
      timeframe: currentTf
    });
    applyDebuggerReport(report);
    const emoji = getStatusEmoji(report.status);
    toast(`${emoji} Auto Debugger: ${report.status} · ${report.failed} خطا · ${report.warnings} هشدار`, report.status === 'HEALTHY' ? 'ok' : 'err');
  } catch (e) {
    console.error(e);
    toast('خطا در اجرای Auto Debugger: ' + (e.message || e), 'err');
    if ($('adStatusText')) $('adStatusText').textContent = 'خطای اجرا';
    if ($('adStatusIcon')) $('adStatusIcon').textContent = '🔴';
  } finally {
    if (btnQ) btnQ.disabled = false;
    if (btnD) btnD.disabled = false;
  }
}


async function runDebuggerFix() {
  const btn = $('adFixBtn');
  if (btn) btn.disabled = true;
  if ($('adStatusText')) $('adStatusText').textContent = 'در حال رفع امن خطاها…';
  if ($('adStatusIcon')) $('adStatusIcon').textContent = '🔧';
  try {
    const candles = await getCandlesForDebugger();
    let currentPrice = null;
    const el = $('current');
    if (el && el.value) {
      const v = Number(el.value);
      if (Number.isFinite(v) && v > 0) currentPrice = v;
    }
    let fundSnap = null;
    try {
      if (currentSymbol) fundSnap = buildSnapshotFromStore(currentSymbol);
    } catch { /* optional */ }

    // Deep scan + safe auto-fix (user-initiated)
    const report = await runAutoDebugger({
      mode: 'deep',
      candles,
      symbol: currentSymbol,
      currentPrice,
      fundamentalSnapshot: fundSnap,
      timeframe: currentTf,
      safeAutoFix: true
    });
    applyDebuggerReport(report);

    const fixed = (report.fixes || []).filter(f => f.result === 'ok' || (typeof f.result === 'string' && f.result.startsWith('marked')));
    const proposals = report.fixProposals || [];
    const rolled = (report.fixes || []).filter(f => String(f.action).includes('rollback') || String(f.result).includes('roll'));

    let msg = '';
    if (fixed.length) msg += `✅ ${fixed.length} اصلاح امن اعمال شد. `;
    if (rolled.length) msg += `↩️ ${rolled.length} مورد Rollback شد. `;
    if (proposals.length) msg += `🟡 ${proposals.length} مورد نیاز به بررسی دستی دارد. `;
    if (!fixed.length && !proposals.length) msg += report.failed === 0
      ? 'خطای قابل‌رفع یافت نشد — سیستم سالم است.'
      : 'خطاهای باقی‌مانده فقط با بررسی دستی قابل رفع هستند (فرمول/Forecast).';

    toast(msg.trim(), report.failed && !fixed.length ? 'err' : 'ok');

    // Show proposals in report panel
    if (proposals.length && $('adReport')) {
      const extra = proposals.map(pr =>
        `<div class="ad-bug is-MEDIUM">🟡 پیشنهاد اصلاح (نیاز تأیید شما)\\n${pr.category || ''} · ${pr.module || ''}\\n${pr.suggestion || pr.message || ''}</div>`
      ).join('');
      $('adReport').innerHTML = ($('adReport').innerHTML || '') + extra;
    }
  } catch (e) {
    console.error(e);
    toast('خطا در رفع خودکار: ' + (e.message || e), 'err');
    if ($('adStatusText')) $('adStatusText').textContent = 'خطای رفع';
    if ($('adStatusIcon')) $('adStatusIcon').textContent = '🔴';
  } finally {
    if (btn) btn.disabled = false;
  }
}

function showDebuggerHistory() {
  const panel = $('adHistoryPanel');
  if (!panel) return;
  const hist = getDebugHistory();
  panel.hidden = false;
  if (!hist.length) {
    panel.innerHTML = '<div class="ad-hist-row muted">تاریخچه‌ای ثبت نشده است.</div>';
    return;
  }
  panel.innerHTML = hist.slice(0, 15).map(h => {
    const d = new Date(h.scanDate);
    const ds = d.toLocaleString('fa-IR');
    const em = getStatusEmoji(h.status);
    return `<div class="ad-hist-row">${em} <span class="mono">${ds}</span> · ${h.mode} · موفق ${h.passed} · خطا ${h.failed} · هشدار ${h.warnings}</div>`;
  }).join('');
}

/** Quick background check after successful analysis (non-blocking) */
async function quickDebuggerAfterAnalysis(candles, symbol, currentPrice) {
  try {
    const report = await runAutoDebugger({
      mode: 'quick',
      candles: candles || [],
      symbol,
      currentPrice,
      timeframe: currentTf
    });
    if (report.status === 'CRITICAL') {
      toast('🔴 Auto Debugger: خطای بحرانی در محاسبات تشخیص داده شد — بخش Auto Debugger را ببینید', 'err');
    } else if (report.status === 'WARNING' && report.failed > 0) {
      toast('🟡 Auto Debugger: هشدار در صحت محاسبات', 'err');
    }
  } catch (e) {
    console.warn('Auto Debugger quick scan failed', e);
  }
}

function init() {
  applyTheme(getTheme());
  $('themeBtn').onclick = () => applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
  tickClock();
  setInterval(tickClock, 1000);
  renderAssetPicker();
  updateSmartDateTimeUI();

  $('symbol').addEventListener('change', onSymbolChange);
  $('tf').addEventListener('change', () => {
    currentTf = $('tf').value;
    updateSmartDateTimeUI();
    if (currentSymbol) refreshAssetPanel(currentSymbol);
  });
  $('priceForm').addEventListener('submit', saveDailyPrice);
  $('analyzeBtn').onclick = () => runAnalysis(false);
  $('clearBtn').onclick = clearAll;

  document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  for (let i = 0; i < 4; i++) addTableRow();
  $('addRowBtn')?.addEventListener('click', () => addTableRow());
  $('pasteRowsBtn')?.addEventListener('click', () => {
    const raw = prompt('OHLCV:');
    if (!raw) return;
    raw.trim().split(/\n/).forEach(line => {
      const cols = line.includes(',') ? line.split(',') : line.trim().split(/\s+/);
      if (cols.length >= 5 && !/date|open/i.test(cols[0])) {
        addTableRow({ date: cols[0], o: cols[1], h: cols[2], l: cols[3], c: cols[4], v: cols[5] || '' });
      }
    });
  });

  const drop = $('drop'), csv = $('csv');
  if (drop && csv) {
    drop.onclick = () => csv.click();
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('dragover'); };
    drop.ondragleave = () => drop.classList.remove('dragover');
    drop.ondrop = async e => {
      e.preventDefault(); drop.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) {
        $('data').value = await f.text();
        if ($('fileName')) { $('fileName').hidden = false; $('fileNameText').textContent = f.name; }
        switchTab('paste');
        toast('فایل خوانده شد', 'ok');
      }
    };
    csv.onchange = async () => {
      const f = csv.files[0];
      if (f) { $('data').value = await f.text(); switchTab('paste'); }
    };
  }

  const ohlcvToggle = $('ohlcvToggle');
  const ohlcvBody = $('ohlcvBody');
  if (ohlcvToggle && ohlcvBody) {
    ohlcvToggle.addEventListener('click', () => {
      const open = ohlcvToggle.getAttribute('aria-expanded') === 'true';
      ohlcvToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      ohlcvBody.hidden = open;
    });
  }

    // Smart calendar
  $('calToggle')?.addEventListener('click', () => openSmartCal());
  $('calPrev')?.addEventListener('click', () => {
    calMonth -= 1;
    if (calMonth < 0) { calMonth = 11; calYear -= 1; }
    refreshDayIndex();
    renderSmartCal();
  });
  $('calNext')?.addEventListener('click', () => {
    calMonth += 1;
    if (calMonth > 11) { calMonth = 0; calYear += 1; }
    refreshDayIndex();
    renderSmartCal();
  });
  $('priceDate')?.addEventListener('change', () => {
    if ($('smartCal') && !$('smartCal').hidden) renderSmartCal();
  });

  $('addAssetBtn').onclick = () => $('addAssetDialog').showModal();
  $('addAssetForm').onsubmit = (e) => {
    const submitter = e.submitter;
    if (submitter && submitter.value === 'cancel') return;
    e.preventDefault();
    const res = registerCustomAsset({
      symbol: $('newSym').value,
      nameFa: $('newName').value || $('newSym').value,
      category: $('newCat').value
    });
    if (!res.ok) { toast(res.error, 'err'); return; }
    $('addAssetDialog').close();
    renderAssetPicker();
    selectAsset(res.asset.symbol);
    toast(`دارایی ${res.asset.symbol} افزوده شد`, 'ok');
  };

  
  // Auto Debugger buttons
  if ($('adQuickBtn')) $('adQuickBtn').onclick = () => runDebuggerUI('quick');
  if ($('adDeepBtn')) $('adDeepBtn').onclick = () => runDebuggerUI('deep');
  if ($('adFixBtn')) $('adFixBtn').onclick = () => runDebuggerFix();
  if ($('adHistoryBtn')) $('adHistoryBtn').onclick = () => showDebuggerHistory();

// Sidebar open / close (mobile drawer)
  function openSidebar() {
    const sb = $('sidebar');
    const ov = $('sidebarOverlay');
    if (sb) sb.classList.add('is-open');
    document.body.classList.add('sidebar-open');
    if (ov) {
      ov.hidden = false;
      ov.classList.add('is-visible');
      ov.setAttribute('aria-hidden', 'false');
    }
  }
  function closeSidebar() {
    const sb = $('sidebar');
    const ov = $('sidebarOverlay');
    if (sb) sb.classList.remove('is-open');
    document.body.classList.remove('sidebar-open');
    if (ov) {
      ov.classList.remove('is-visible');
      ov.hidden = true;
      ov.setAttribute('aria-hidden', 'true');
    }
  }
  window.__closeSidebar = closeSidebar;
  window.__openSidebar = openSidebar;

  document.querySelectorAll('.side-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchView(a.dataset.view || 'dashboard');
      closeSidebar();
    });
  });
  const sbToggle = $('sidebarToggle');
  if (sbToggle) {
    sbToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSidebar();
    });
  }
  const menuOpen = $('menuOpenBtn');
  if (menuOpen) {
    menuOpen.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSidebar();
    });
  }
  const overlay = $('sidebarOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      closeSidebar();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });

  // Backtest run
  $('btRunBtn')?.addEventListener('click', runBacktestUI);


  window.__OMA_V5__ = { getCachedSymbols, buildAnalysisSeries, loadManual, loadHistorical, getDataDayIndex };
}

init();
