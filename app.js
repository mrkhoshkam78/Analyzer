/**
 * UI Controller V10.0.2 · Obsidian Editorial
 * Fundamental is an optional input to Prediction (toggle), not a standalone view.
 */
import { getSymbol, formatPrice, getAllSymbols, registerCustomAsset, removeCustomAsset } from './logic/symbols.js';
import {
  loadHistorical, loadManual, setHistorical, upsertManualPrices,
  buildAnalysisSeries, getAssetSummary, dayKeyOffset, dayKey,
  getCachedSymbols, dropSessionCache, TIMEFRAMES, getTfMeta, timeBucketKey,
  getDataDayIndex,
  getDataDayBias
} from './logic/datasets.js';
import {
  runAutoDebugger, getLastReport, getDebugHistory, getStatusEmoji,
  injectTestFaults, AUTO_DEBUGGER_VERSION, getDebugMemory, getRegressionMemory,
  emitRealtimeEvent, getCorrectionLog, getRealtimeState, onRealtimeEvent
} from './logic/autoDebugger.js';

const $ = (id) => document.getElementById(id);
let activeTab = 'paste';
let currentSymbol = null;
let currentTf = '1D';

/** Backend proxy base (Fundamental only). Override via window.__OMA_API_BASE__ if needed. */
const API_BASE = (typeof window !== 'undefined' && window.__OMA_API_BASE__) || 'http://127.0.0.1:3847';
const FUND_CACHE_KEY = 'oma_v6_fund_cache';
const FUND_CACHE_TTL_MS = 40 * 60 * 1000;

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
    const wrap = document.createElement('div');
    wrap.className = 'asset-btn-wrap';
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
    wrap.appendChild(btn);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'asset-del-btn' + (a.builtin ? ' is-builtin' : '');
    del.title = a.builtin ? 'نماد پیش‌فرض — قابل حذف نیست' : 'حذف نماد';
    del.setAttribute('aria-label', `حذف نماد ${a.symbol}`);
    del.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>`;
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (a.builtin) {
        toast('نمادهای پیش‌فرض (XAUUSD / BRENT / …) قابل حذف نیستند', 'err');
        return;
      }
      confirmRemoveAsset(a.symbol, a.nameFa);
    });
    wrap.appendChild(del);
    box.appendChild(wrap);
    const opt = document.createElement('option');
    opt.value = a.symbol;
    opt.textContent = a.symbol;
    sel.appendChild(opt);
  }
  if (currentSymbol) sel.value = currentSymbol;
}

function confirmRemoveAsset(symbol, nameFa) {
  const label = nameFa ? `${symbol} (${nameFa})` : symbol;
  const ok = window.confirm(`آیا از حذف نماد «${label}» مطمئن هستید؟\n\nدادهٔ دستی این نماد در همین مرورگر پاک نمی‌شود، اما نماد از فهرست حذف می‌شود.`);
  if (!ok) return;
  const res = removeCustomAsset(symbol);
  if (!res.ok) {
    toast(res.error || 'حذف ناموفق', 'err');
    return;
  }
  if (currentSymbol === symbol) {
    currentSymbol = null;
    if ($('symbol')) $('symbol').value = '';
    if ($('assetChip')) $('assetChip').hidden = true;
    if ($('dailyCard')) $('dailyCard').hidden = true;
    updateHeaderAssetLabel();
    setHeaderData('آماده');
  }
  renderAssetPicker();
  toast(`نماد ${symbol} حذف شد`, 'ok');
}

function selectAsset(symbol) {
  try { window.currentSymbol = symbol; } catch (_) {}
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

function updateHeaderAssetLabel() {
  const el = $('headerAsset');
  if (!el) return;
  if (!currentSymbol) {
    el.textContent = '—';
    return;
  }
  const tf = currentTf || ($('tf')?.value) || '1D';
  el.textContent = `${currentSymbol}/${tf}`;
}

function onSymbolChange() {
  const id = $('symbol').value;
  const meta = getSymbol(id);
  if (!meta) {
    if ($('assetChip')) $('assetChip').hidden = true;
    if ($('dailyCard')) $('dailyCard').hidden = true;
    currentSymbol = null;
    updateHeaderAssetLabel();
    setHeaderData('آماده');
    return;
  }
  currentSymbol = id;
  try { window.currentSymbol = id; } catch (_) {}
  currentTf = $('tf').value || '1D';
  $('chipSym').textContent = meta.symbol;
  $('chipName').textContent = meta.nameFa;
  $('chipMeta').textContent = `${meta.typeFa} · ${meta.unitFa} · ${currentTf}`;
  if ($('assetChip')) $('assetChip').hidden = false;
  updateHeaderAssetLabel();
  refreshAssetPanel(id);
  try { refreshFundEditableList(); } catch (_) {}
}

async function refreshAssetPanel(symbol) {
  const card = $('dailyCard');
  const meta = getSymbol(symbol);
  if (!meta) {
    if (card) card.hidden = true;
    return;
  }
  currentTf = $('tf').value || '1D';
  loadHistorical(symbol, currentTf);
  loadManual(symbol, currentTf);
  // Load exact project CSVs for 1D / 4H / 1H (never mix TFs)
  try {
    const { ensureAllProjectTimeframes, ensureProjectData } = await import('./logic/datasets.js');
    await ensureAllProjectTimeframes(symbol);
    await ensureProjectData(symbol, currentTf);
  } catch (_) {}
  refreshDayIndex();
  if ($('smartCal') && !$('smartCal').hidden) renderSmartCal();
  if (card) card.hidden = false;
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
  try {
    if (window.__lastAnalysisResult && window.__lastAnalysisResult.ok)
      renderForecastChart(symbol, window.__lastAnalysisResult);
    else
      renderForecastChart(symbol, null);
  } catch (_) {}
}

function fillPriceFormFromRecord(rec) {
  if (!rec) return;
  const day = rec.day || (rec.bucket ? String(rec.bucket).slice(0, 10) : '');
  if (day && $('priceDate')) $('priceDate').value = day;
  if (isFinite(Number(rec.open)) && $('priceOpen')) $('priceOpen').value = rec.open;
  if (isFinite(Number(rec.close)) && $('priceClose')) $('priceClose').value = rec.close;
  // hour/minute from ts if present
  if (rec.ts && Number.isFinite(rec.ts)) {
    const d = new Date(rec.ts);
    if ($('priceHour') && !$('fieldHour')?.hidden) $('priceHour').value = d.getHours();
    if ($('priceMinute') && !$('fieldMinute')?.hidden) $('priceMinute').value = d.getMinutes();
  }
  $('priceOpen')?.focus();
}

function renderManualList(symbol) {
  const box = $('manualList');
  if (!box) return;
  const manual = loadManual(symbol, currentTf).slice().reverse().slice(0, 20);
  if (!manual.length) {
    box.innerHTML = '<p class="card-desc">هنوز رکورد دستی برای این بازه نیست.</p>';
    return;
  }
  box.innerHTML = '<div class="manual-list-title">رکوردهای دستی (باز / بسته) — کلیک برای ویرایش</div>' +
    manual.map((m, i) => {
      const day = m.day || (m.bucket ? String(m.bucket).slice(0, 10) : '');
      const dir = (isFinite(m.open) && isFinite(m.close))
        ? (m.close > m.open ? 'up' : m.close < m.open ? 'down' : 'flat')
        : 'flat';
      return `<div class="manual-item manual-item-edit" data-idx="${i}" data-day="${day}" data-open="${m.open}" data-close="${m.close}" data-ts="${m.ts || ''}" role="button" tabindex="0">
        <div class="manual-item-main">
          <span class="manual-item-day mono">${m.bucket || day}</span>
          <strong class="manual-item-px">${formatPrice(m.open, symbol)} → ${formatPrice(m.close, symbol)}</strong>
          <span class="manual-dir is-${dir}" aria-hidden="true"></span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm manual-edit-btn">ویرایش</button>
      </div>`;
    }).join('');
  box.querySelectorAll('.manual-item-edit').forEach(el => {
    const load = () => {
      fillPriceFormFromRecord({
        day: el.getAttribute('data-day'),
        bucket: el.getAttribute('data-day'),
        open: Number(el.getAttribute('data-open')),
        close: Number(el.getAttribute('data-close')),
        ts: el.getAttribute('data-ts') ? Number(el.getAttribute('data-ts')) : null
      });
      if ($('smartCal') && !$('smartCal').hidden) renderSmartCal();
      toast('آماده ویرایش — پس از تغییر، ذخیره قیمت را بزنید', 'ok');
    };
    el.addEventListener('click', (e) => {
      if (e.target.closest('.manual-edit-btn') || e.currentTarget === el) load();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); load(); }
    });
  });
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
  // Prefer form date as day so calendar pulse matches selected day (avoid UTC shift)
  const formDay = ($('priceDate')?.value || '').slice(0, 10);
  const tfMeta = getTfMeta(currentTf);
  const res = upsertManualPrices(sym, [{
    datetime: formDay
      ? `${formDay}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`
      : dt.toISOString(),
    day: formDay || undefined,
    bucket: formDay && (tfMeta?.kind === 'day' || tfMeta?.kind === 'week') ? formDay : undefined,
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
  // v8.0.3: only file/textarea path remains
  return ($('data')?.value || '').trim();
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

function isFundToggleOn() {
  return Boolean($('fundToggle')?.checked);
}

function setFundHint() {
  const hint = $('fundToggleHint');
  if (!hint) return;
  hint.textContent = isFundToggleOn() ? 'با تحلیل فاندامنتال' : 'بدون تحلیل فاندامنتال';
}

function setFundFetchStatus(text, cls) {
  const el = $('fundFetchStatus');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'fund-fetch-status muted';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = 'fund-fetch-status ' + (cls || 'muted');
}

/**
 * Fetch fundamental snapshot from secure backend proxy.
 * Returns { ok, snapshot, fetchedAt, fromCache, error, code }
 * Never invents data. When toggle OFF this is not called.
 */
async function fetchFundamentalSnapshot(symbol) {
  // Offline-only: never call external/backend fundamental API (no EODHD dependency).
  // Local store is preferred via buildSnapshotFromStore in runAnalysis.
  try {
    const raw = sessionStorage.getItem(FUND_CACHE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && obj.symbol === symbol && obj.ts && (Date.now() - obj.ts) < FUND_CACHE_TTL_MS && obj.snapshot) {
        return {
          ok: true,
          snapshot: obj.snapshot,
          fetchedAt: obj.fetchedAt || new Date(obj.ts).toISOString(),
          fromCache: true,
          coverage: obj.coverage || 'offline'
        };
      }
    }
  } catch { /* ignore */ }
  return {
    ok: false,
    error: 'داده بنیادی دستی خالی است. مقادیر را در صفحه تحلیل بنیادی وارد کنید.',
    code: 'OFFLINE_EMPTY'
  };
}

async function runAnalysis(silent = false) {
  const sym = currentSymbol || $('symbol').value;
  if (!sym || !getSymbol(sym)) {
    if (!silent) toast('دارایی را انتخاب کنید', 'err');
    return;
  }
  currentTf = $('tf').value || '1D';
  setProcessing(true, 'ساخت Analysis Series…');
  setFundFetchStatus('');
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

    // Optional Fundamental — offline store first (no external API required)
    let fundSnap = null;
    let fundMeta = { used: false, mode: 'tech_only' };
    if (isFundToggleOn()) {
      setProcessing(true, 'بارگذاری فاندامنتال آفلاین…');
      setFundFetchStatus('خواندن داده دستی فاندامنتال…', 'is-loading');
      try {
        const fmod = await import('./logic/fundamental.js');
        const offline = fmod.buildSnapshotFromStore(sym);
        const hasOffline = offline && Object.keys(offline).length > 0;
        if (hasOffline) {
          fundSnap = offline;
          fundMeta = {
            used: true,
            mode: 'with_fundamental',
            fromCache: true,
            fetchedAt: new Date().toISOString(),
            coverage: 'offline',
            source: 'local_store'
          };
          setFundFetchStatus('فاندامنتال از دادهٔ دستی محلی', 'is-ok');
        } else {
          // Offline-only: no EODHD / backend dependency
          setFundFetchStatus('داده بنیادی دستی خالی است — فقط تکنیکال ادامه یافت', 'is-warn');
          if (!silent) toast('برای ترکیب بنیادی، در صفحه «تحلیل بنیادی» مقادیر را وارد کنید', 'err');
        }
      } catch (e) {
        setFundFetchStatus('خطا در بارگذاری فاندامنتال آفلاین', 'is-err');
      }
      setProcessing(true, 'تحلیل ترکیبی…');
    }

    // Multi-TF map: primary + siblings already in store.
    // When analyzing 1D, also fetch 4H so MTF can use daily bias + 4H structure (no fabrication).
    const seriesMap = { [currentTf]: series.candles };
    try {
      const { loadHistorical, TIMEFRAMES, ensureAllProjectTimeframes, ensureProjectData } = await import('./logic/datasets.js');
      // Always bind each TF to its own CSV (1D↔1d, 4H↔4h, 1H↔1h)
      try { await ensureAllProjectTimeframes(sym); } catch (_) { /* optional */ }
      try { await ensureProjectData(sym, currentTf); } catch (_) {}
      for (const tf of TIMEFRAMES) {
        if (tf.id === currentTf) continue;
        if (tf.id === '1D' || tf.id === '4H' || tf.id === '1H') {
          try { await ensureProjectData(sym, tf.id); } catch (_) {}
        }
        const hist = loadHistorical(sym, tf.id);
        if (hist && hist.length >= 20) seriesMap[tf.id] = hist;
      }
    } catch (_) { /* offline / missing */ }

    const { analyze } = await import('./logic/analysis.js');
    const fset = getFundAdvancedSettings();
    const result = analyze(series.candles, {
      currentPrice, symbol: sym, timeframe: currentTf, recordPrediction: true,
      fundamentalSnapshot: fundSnap,
      seriesMap,
      fundWeightMult: fset.weightMult,
      fundMinCoverage: fset.minCoverage,
      fundSensitivity: fset.sensitivity
    });
    result._fundMeta = fundMeta;
    setProcessing(false);
    setHeaderData(`${sym}/${currentTf} · ${series.mergedCount} کندل`);
    setDataStatus(
      `سری ${series.mergedCount} · تاریخچه ${series.histCount} · دستی ${series.manualCount}` +
      (fundMeta.used ? ' · فاندامنتال فعال' : ' · فقط تکنیکال'),
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
  window.__lastAnalysisResult = r;
  // Keep MPB panel in sync if currently visible
  if ($('view-mpb') && !$('view-mpb').hidden) renderMPBPanel(r);
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
  // Layer scores + mode badge
  const techSc = r.analysis?.technicalScore;
  const fundSc = r.analysis?.fundamentalScore;
  const combSc = r.analysis?.combinedScore ?? r.score;
  const fundMeta = r._fundMeta || {};
  if (techSc != null) report += ` تکنیکال: ${techSc}.`;
  if (fundSc != null) report += ` فاندامنتال: ${fundSc}.`;
  if (r.fundamentalApplied) report += ' ترکیب اعمال شد.';
  else report += ' فاندامنتال در ترکیب لحاظ نشد.';
  if (fundMeta.mode === 'with_fundamental') report += ' [Prediction با Fundamental]';
  else report += ' [Prediction بدون Fundamental]';
  $('report').textContent = report;
  $('suggestionText').textContent = r.suggestion || '—';

  if ($('techScoreVal')) $('techScoreVal').textContent = techSc != null ? techSc : '—';
  if ($('fundScoreVal')) $('fundScoreVal').textContent = fundSc != null ? fundSc : '—';
  if ($('combScoreVal')) $('combScoreVal').textContent = combSc != null ? combSc : '—';
  if ($('confVal')) $('confVal').textContent = r.confidence != null ? Math.round(r.confidence * 100) + '%' : '—';

  // Ensemble / Context / Entry / MTF panel (V7.0.1)
  const ensBox = $('ensembleBox');
  if (ensBox) {
    const regime = r.regime || r.analysis?.regime || '—';
    const regimeConf = r.regimeConfidence ?? r.analysis?.regimeConfidence;
    const agreement = r.strategyAgreement ?? r.analysis?.strategyAgreement;
    const agreementLabel = r.analysis?.agreementLabel || '';
    const active = r.activeStrategies || r.analysis?.activeStrategies || [];
    const strats = r.strategies || r.analysis?.strategies || [];
    const supporting = r.analysis?.supportingFactors || [];
    const conflicting = r.analysis?.conflictingFactors || [];
    const dq = r.dataQuality ?? r.analysis?.dataQuality;
    const histRel = r.analysis?.historicalReliability;
    const rr = r.rr ?? r.prediction?.rr;
    const riskSc = r.riskScore ?? r.analysis?.riskScore;
    const ctx = r.context || {};
    const session = ctx.session?.session || '—';
    const eventSt = ctx.event?.state || 'UNKNOWN';
    const eventRisk = ctx.event?.eventRisk;
    const economies = (ctx.economy?.economies || ctx.relevantEconomies || []).join(', ') || '—';
    const currencies = (ctx.economy?.currencies || []).join(', ') || '—';
    const mtf = r.mtf || {};
    const entry = r.entry || r.prediction || {};

    const REGIME_FA = {
      'Trending Bullish': 'روند صعودی', 'Trending Bearish': 'روند نزولی',
      Range: 'رنج', 'High Volatility': 'نوسان بالا', 'Low Volatility': 'نوسان پایین',
      Breakout: 'بریک‌اوت', Unclear: 'نامشخص'
    };
    const EVENT_FA = {
      NORMAL: 'عادی', PRE_EVENT: 'قبل از رویداد', IMMINENT_EVENT: 'رویداد قریب‌الوقوع',
      EVENT_REACTION: 'واکنش به رویداد', POST_EVENT: 'پس از رویداد', UNKNOWN: 'نامشخص'
    };

    let html = '<div class="ens-section"><div class="ens-sec-title">Context بازار</div><div class="ens-grid">';
    html += `<div class="ens-item"><span class="ens-label">سشن</span><span class="ens-val">${session}</span></div>`;
    html += `<div class="ens-item"><span class="ens-label">رژیم</span><span class="ens-val">${REGIME_FA[regime] || regime}</span></div>`;
    html += `<div class="ens-item"><span class="ens-label">وضعیت رویداد</span><span class="ens-val">${EVENT_FA[eventSt] || eventSt}</span></div>`;
    if (eventRisk != null) html += `<div class="ens-item"><span class="ens-label">ریسک رویداد</span><span class="ens-val mono">${Math.round(eventRisk * 100)}%</span></div>`;
    html += `<div class="ens-item"><span class="ens-label">اقتصادهای مرتبط</span><span class="ens-val">${economies}</span></div>`;
    html += `<div class="ens-item"><span class="ens-label">ارزها</span><span class="ens-val">${currencies}</span></div>`;
    if (riskSc != null) html += `<div class="ens-item"><span class="ens-label">ریسک اسکور</span><span class="ens-val mono">${riskSc}</span></div>`;
    if (dq != null) html += `<div class="ens-item"><span class="ens-label">کیفیت داده</span><span class="ens-val mono">${Math.round(dq * 100)}%</span></div>`;
    html += '</div></div>';

    // MTF
    html += '<div class="ens-section"><div class="ens-sec-title">Multi-Timeframe</div>';
    if (mtf.ok) {
      html += `<div class="ens-grid">`;
      html += `<div class="ens-item"><span class="ens-label">توافق MTF</span><span class="ens-val">${mtf.agreementLabel || '—'} (${mtf.agreement != null ? Math.round(mtf.agreement*100)+'%' : '—'})</span></div>`;
      html += `<div class="ens-item"><span class="ens-label">روند بالاتر</span><span class="ens-val">${mtf.higherTrend || '—'} (${mtf.higherTf || ''})</span></div>`;
      html += `<div class="ens-item"><span class="ens-label">تایم‌فریم‌های موجود</span><span class="ens-val">${(mtf.availableTfs||[]).join(', ') || '—'}</span></div>`;
      if (mtf.htfLtfConflict) html += `<div class="ens-item"><span class="ens-label">تعارض HTF/LTF</span><span class="ens-val bear">بله</span></div>`;
      html += `</div>`;
      if (mtf.summary) html += `<div class="ens-active muted">${mtf.summary}</div>`;
    } else {
      html += `<div class="ens-active muted">داده چندتایم‌فریمی کافی نیست — فقط تایم‌فریم جاری</div>`;
    }
    html += '</div>';

    // Entry V9.01
    html += '<div class="ens-section"><div class="ens-sec-title">نقطه ورود / Entry Engine v9.01</div>';
    if (entry && (entry.entryType || entry.preferredEntry != null || entry.direction === 'No Trade')) {
      const wait = entry.waitForEntry;
      const noTrade = entry.direction === 'No Trade' || entry.entryType === 'No Trade' || entry.entryType === 'No Valid Entry';
      const dirCls = noTrade ? 'neu' : (entry.direction === 'Long' ? 'bull' : entry.direction === 'Short' ? 'bear' : 'neu');
      const statusLabel = noTrade ? 'بدون معامله' : (wait ? 'صبر برای ورود' : 'آماده اجرا');
      const statusCls = noTrade ? 'entry-status-no' : (wait ? 'entry-status-wait' : 'entry-status-go');

      html += `<div class="ens-section entry-v10"><div class="ens-sec-title">نقطه ورود <span class="entry-ver">v10</span></div>`;
      html += `<div class="entry-status-bar ${statusCls}">${statusLabel}</div>`;
      html += '<div class="ens-grid entry-primary">';
      html += `<div class="ens-item"><span class="ens-label">جهت</span><span class="ens-val ${dirCls}">${entry.direction || '—'}</span></div>`;
      html += `<div class="ens-item"><span class="ens-label">سناریو</span><span class="ens-val">${entry.entryType || '—'}</span></div>`;
      if (entry.preferredEntry != null) html += `<div class="ens-item ens-highlight"><span class="ens-label">ورود</span><span class="ens-val mono">${entry.preferredEntry}</span></div>`;
      if (entry.entryZone) html += `<div class="ens-item"><span class="ens-label">ناحیه</span><span class="ens-val mono">${entry.entryZone.low} – ${entry.entryZone.high}</span></div>`;
      if (entry.stop != null) html += `<div class="ens-item"><span class="ens-label">حد ضرر</span><span class="ens-val mono">${entry.stop}</span></div>`;
      if (entry.target1 != null) html += `<div class="ens-item"><span class="ens-label">هدف ۱</span><span class="ens-val mono">${entry.target1}</span></div>`;
      if (entry.target2 != null) html += `<div class="ens-item"><span class="ens-label">هدف ۲</span><span class="ens-val mono">${entry.target2}</span></div>`;
      html += '</div>';

      // Metrics row (compact)
      html += '<div class="ens-grid entry-metrics">';
      if (entry.netRR != null) html += `<div class="ens-item"><span class="ens-label">R:R خالص</span><span class="ens-val mono">${entry.netRR}</span></div>`;
      else if (entry.rr != null) html += `<div class="ens-item"><span class="ens-label">R:R</span><span class="ens-val mono">${entry.rr}</span></div>`;
      if (entry.evR != null) html += `<div class="ens-item"><span class="ens-label">EV</span><span class="ens-val mono">${entry.evR}R</span></div>`;
      if (entry.winP != null) html += `<div class="ens-item"><span class="ens-label">P(مدل)</span><span class="ens-val mono">${Math.round(entry.winP * 100)}%</span></div>`;
      if (entry.modelConfidence != null) html += `<div class="ens-item"><span class="ens-label">اطمینان</span><span class="ens-val mono">${Math.round(entry.modelConfidence * 100)}%</span></div>`;
      if (entry.confluence != null) html += `<div class="ens-item"><span class="ens-label">هم‌گرایی</span><span class="ens-val mono">${Math.round(entry.confluence * 100)}%</span></div>`;
      html += '</div>';

      if (entry.activation) html += `<div class="ens-active entry-activation"><span class="ens-label">شرط:</span> ${entry.activation}</div>`;
      if (entry.reason) html += `<div class="ens-active">${entry.reason}</div>`;
      if (entry.confirmation?.length) {
        html += `<div class="entry-tags">${entry.confirmation.slice(0, 4).map(c => `<span class="entry-tag">${c}</span>`).join('')}</div>`;
      }
      if (entry.invalidation != null || entry.softInvalidation != null) {
        html += '<div class="ens-grid entry-inv">';
        if (entry.softInvalidation != null) html += `<div class="ens-item"><span class="ens-label">هشدار نرم</span><span class="ens-val mono">${entry.softInvalidation}</span></div>`;
        if (entry.invalidation != null) html += `<div class="ens-item"><span class="ens-label">ابطال</span><span class="ens-val mono">${entry.invalidation}</span></div>`;
        html += '</div>';
      }
      if (entry.scenarios?.length && !noTrade) {
        html += '<details class="entry-scenarios"><summary>مقایسه سناریوها</summary><div class="strat-table"><table><thead><tr><th>سناریو</th><th>ورود</th><th>R:R</th><th>EV</th><th>امتیاز</th></tr></thead><tbody>';
        for (const s of entry.scenarios) {
          const sel = s.id === entry.selectedScenario ? ' class="row-selected"' : '';
          html += `<tr${sel}><td>${s.name || s.id}</td><td class="mono">${s.entry ?? '—'}</td><td class="mono">${s.netRR ?? s.rr ?? '—'}</td><td class="mono">${s.evR ?? '—'}</td><td class="mono">${s.score ?? '—'}</td></tr>`;
        }
        html += '</tbody></table></div></details>';
      }
      if (entry.rejectedScenarios?.length) {
        html += `<details class="entry-rejected"><summary>ردشده (${entry.rejectedScenarios.length})</summary><div class="ens-active muted">${entry.rejectedScenarios.map(r => `${r.name || r.id}: ${r.reason}`).join(' · ')}</div></details>`;
      }
      if (entry.position?.note) {
        html += `<div class="ens-active muted">حجم: ${entry.position.note}${entry.position.units != null ? ` · ≈${entry.position.units}` : ''}</div>`;
      }
      if (entry.limitations?.length) {
        html += `<details class="entry-limits"><summary>محدودیت‌های مدل</summary><ul class="entry-limit-list">${entry.limitations.map(l => `<li>${l}</li>`).join('')}</ul></details>`;
      }
      html += '</div>';
    } else {
      html += `<div class="ens-active muted">Setup ورود تعریف نشده</div>`;
    }
    html += '</div>';

    // Strategies
    html += '<div class="ens-section"><div class="ens-sec-title">استراتژی‌ها / Ensemble</div><div class="ens-grid">';
    if (agreement != null) html += `<div class="ens-item"><span class="ens-label">توافق استراتژی</span><span class="ens-val">${agreementLabel || ''} ${Math.round(agreement * 100)}%</span></div>`;
    if (regimeConf != null) html += `<div class="ens-item"><span class="ens-label">اطمینان رژیم</span><span class="ens-val mono">${Math.round(regimeConf * 100)}%</span></div>`;
    if (rr != null) html += `<div class="ens-item"><span class="ens-label">R:R نهایی</span><span class="ens-val mono">${rr}</span></div>`;
    if (histRel && histRel.rate != null) html += `<div class="ens-item"><span class="ens-label">قابلیت اطمینان تاریخی</span><span class="ens-val mono">${Math.round(histRel.rate * 100)}% (${histRel.samples})</span></div>`;
    html += '</div>';
    if (active.length) html += `<div class="ens-active"><span class="ens-label">فعال:</span> ${active.join(' · ')}</div>`;
    if (strats.length) {
      html += '<div class="strat-table"><table><thead><tr><th>استراتژی</th><th>سیگنال</th><th>امتیاز</th><th>اطمینان</th></tr></thead><tbody>';
      for (const s of strats) {
        if (!s.active && s.id === 'fundamental') continue;
        const sigCls = s.signal === 'BUY' ? 'bull' : s.signal === 'SELL' ? 'bear' : 'neu';
        html += `<tr><td>${s.name || s.id}</td><td class="${sigCls}">${SIGNAL_FA[s.signal] || s.signal}</td><td class="mono">${s.score}</td><td class="mono">${s.confidence != null ? Math.round(s.confidence * 100) + '%' : '—'}</td></tr>`;
      }
      html += '</tbody></table></div>';
    }
    if (supporting.length || conflicting.length) {
      html += '<div class="ens-factors">';
      if (supporting.length) html += `<div class="ens-sup"><strong>موافق:</strong> ${supporting.map(s => s.name || s.id).join('، ')}</div>`;
      if (conflicting.length) html += `<div class="ens-conf"><strong>مخالف:</strong> ${conflicting.map(s => s.name || s.id).join('، ')}</div>`;
      html += '</div>';
    }
    html += '</div>';

    ensBox.innerHTML = html;
    ensBox.hidden = false;
  }

  // Fundamental factors (only when applied)
  const fundBox = $('fundFactorsBox');
  if (fundBox) {
    const ff = r.analysis?.fundamentalFactors || [];
    if (r.fundamentalApplied && ff.length) {
      fundBox.innerHTML = ff.map(f => {
        const cls = f.dir === 'bull' ? 'bull' : f.dir === 'bear' ? 'bear' : 'neu';
        return `<div class="fund-factor ${cls}"><span>${f.nameFa || f.key}</span><span class="mono">${f.contribution > 0 ? '+' : ''}${f.contribution}</span></div>`;
      }).join('');
      fundBox.hidden = false;
    } else {
      fundBox.innerHTML = '';
      fundBox.hidden = true;
    }
  }

  // Mode badge on title
  const titleEl = $('result-title');
  if (titleEl) {
    const badge = fundMeta.mode === 'with_fundamental'
      ? '<span class="mode-badge is-fund">با فاندامنتال</span>'
      : '<span class="mode-badge is-tech">بدون فاندامنتال</span>';
    titleEl.innerHTML = `پیش‌بینی و سیگنال ${badge}`;
  }

  $('resultClock').textContent = formatNow().full;
  $('result').hidden = false;
  if ($('scoreLayers')) $('scoreLayers').hidden = false;
  try { renderForecastChart(symbolId, r); } catch (e) { console.warn('chart', e); }
}

function clearAll() {
  if ($('current')) $('current').value = '';
  if ($('data')) $('data').value = '';
  if ($('priceOpen')) $('priceOpen').value = '';
  if ($('priceClose')) $('priceClose').value = '';
  if ($('result')) $('result').hidden = true;
  if ($('csv')) $('csv').value = '';
  if ($('fileName')) $('fileName').hidden = true;
  setDataStatus('فرم پاک شد؛ Dataset ذخیره‌شده حفظ شد.', 'ok');
  if (currentSymbol) refreshAssetPanel(currentSymbol);
}

function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('oma_theme', t); } catch (_) {}
  const sun = document.querySelector('#themeBtn .icon-sun') || document.querySelector('.icon-sun');
  const moon = document.querySelector('#themeBtn .icon-moon') || document.querySelector('.icon-moon');
  if (sun && moon) {
    sun.style.display = t === 'dark' ? '' : 'none';
    moon.style.display = t === 'dark' ? 'none' : '';
  }
}


/* —— Smart Data Calendar —— */
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-11
let dayIndexCache = null; // { day: count }
let dayBiasCache = null; // { day: 1|-1|0 }

function refreshDayIndex() {
  if (!currentSymbol) {
    dayIndexCache = Object.create(null);
    dayBiasCache = Object.create(null);
    return dayIndexCache;
  }
  dayIndexCache = getDataDayIndex(currentSymbol, currentTf || '1D') || Object.create(null);
  try {
    dayBiasCache = getDataDayBias(currentSymbol, currentTf || '1D') || Object.create(null);
  } catch (_) {
    dayBiasCache = Object.create(null);
  }
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
  const bias = dayBiasCache || Object.create(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = idx[key] || 0;
    const dir = bias[key]; // 1 up, -1 down, 0 flat
    const classes = ['cal-day'];
    if (key === today) classes.push('is-today');
    if (key === selected) classes.push('is-selected');
    if (count > 0) {
      if (dir === 1) classes.push('is-up');
      else if (dir === -1) classes.push('is-down');
      else classes.push('is-flat');
    }
    const title = count
      ? (dir === 1 ? 'صعودی' : dir === -1 ? 'نزولی' : 'خنثی') + ` · ${count} رکورد`
      : 'بدون داده';
    const pulse = count > 0
      ? `<span class="cal-pulse ${dir === 1 ? 'pulse-up' : dir === -1 ? 'pulse-down' : 'pulse-flat'}" aria-hidden="true"></span>`
      : '';
    parts.push(
      `<button type="button" class="${classes.join(' ')}" data-day="${key}" title="${title}" aria-label="${key}${count ? ' — ' + title : ''}">${d}${pulse}</button>`
    );
  }
  grid.innerHTML = parts.join('');
  grid.querySelectorAll('.cal-day[data-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = btn.getAttribute('data-day');
      if ($('priceDate')) $('priceDate').value = day;
      // اگر رکورد دستی/تاریخی برای این روز هست، فرم را برای ویرایش پر کن
      try {
        const manuals = loadManual(currentSymbol, currentTf || '1D');
        const hit = manuals.find(m => {
          const d = m.day || (m.bucket ? String(m.bucket).slice(0, 10) : '');
          return d === day;
        });
        if (hit) {
          fillPriceFormFromRecord(hit);
        } else {
          // از تاریخچه اگر O/C موجود باشد
          const hist = loadHistorical(currentSymbol, currentTf || '1D');
          const h = hist.find(c => {
            const d = c.day || (c.ts != null ? dayKey(c.ts) : (c.bucket ? String(c.bucket).slice(0, 10) : null));
            return d === day;
          });
          if (h) {
            const o = h.o ?? h.open;
            const c = h.c ?? h.close;
            if (o != null && c != null) {
              fillPriceFormFromRecord({ day, open: o, close: c, ts: h.ts });
            } else if ($('priceOpen')) {
              $('priceOpen').value = '';
              $('priceClose').value = '';
            }
          } else if ($('priceOpen')) {
            $('priceOpen').value = '';
            $('priceClose').value = '';
          }
        }
      } catch (_) {}
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


function switchView(view) {
  // Dedicated panels that replace main flow content
  const dedicated = ['backtest', 'debugger', 'mpb', 'fundamental', 'settings'];
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
    if (view === 'backtest') {
      if ($('btStatus')) $('btStatus').textContent = currentSymbol
        ? `نماد فعال: ${currentSymbol} / ${currentTf || '1D'} — از دادهٔ پروژه (تاریخچه + دستی) استفاده می‌شود.`
        : 'ابتدا نماد را انتخاب و داده قیمت (پروژه یا دستی) را بارگذاری کنید.';
    }
    if (view === 'debugger') {
      renderDebuggerPanel();
    }
    if (view === 'mpb') {
      (async () => {
        try {
          if (currentSymbol) {
            const { ensureProjectData } = await import('./logic/datasets.js');
            await ensureProjectData(currentSymbol, currentTf || '1D');
            if ((currentTf || '1D') === '1D') {
              try { await ensureProjectData(currentSymbol, '4H'); } catch (_) {}
              try { await ensureProjectData(currentSymbol, '1H'); } catch (_) {}
            }
          }
        } catch (_) {}
        renderMPBPanel(window.__lastAnalysisResult || null);
        refreshMPBLibrary();
      })();
    }
    if (view === 'fundamental') {
      try { wireFundForm(); } catch (_) {}
      syncFundPageFromToggle();
    }
    if (view === 'settings') {
      syncSettingsUI();
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

function syncSettingsUI() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const skin = document.documentElement.getAttribute('data-skin') || localStorage.getItem('oma_skin') || 'terminal-glass';
  const lang = document.documentElement.getAttribute('lang') || 'fa';
  const dark = $('setThemeDark');
  const light = $('setThemeLight');
  if (dark) dark.checked = theme === 'dark';
  if (light) light.checked = theme === 'light';
  const fa = $('setLangFa');
  const en = $('setLangEn');
  if (fa) fa.checked = lang !== 'en';
  if (en) en.checked = lang === 'en';
  // پوسته را از data-skin / localStorage بخوان — هرگز اجبار به Terminal Glass نکن
  document.querySelectorAll('input[name="setSkin"]').forEach(r => {
    r.checked = (r.value === skin);
  });
  const names = { 'terminal-glass': 'Terminal Glass', 'vector-soft': 'Vector Soft — Obsidian Editorial', 'zen-calm': 'Zen Calm' };
  if ($('skinNameLabel')) $('skinNameLabel').textContent = names[skin] || skin;
  if ($('footerSkinLabel')) $('footerSkinLabel').textContent = `پوسته ${names[skin] || skin} · داده محلی`;
}

function applyLang(lang) {
  const l = lang === 'en' ? 'en' : 'fa';
  document.documentElement.setAttribute('lang', l);
  document.documentElement.setAttribute('dir', l === 'en' ? 'ltr' : 'rtl');
  try { localStorage.setItem('oma_lang', l); } catch (_) {}
  // همبرگر و سایدبار با جهت زبان هم‌تراز می‌شوند (CSS منطقی)
  document.body.classList.toggle('is-ltr', l === 'en');
  document.body.classList.toggle('is-rtl', l !== 'en');
}

function applySkin(skin) {
  const s = (skin === 'vector-soft' || skin === 'zen-calm') ? skin : 'terminal-glass';
  document.documentElement.setAttribute('data-skin', s);
  // ensure theme+skin combo attributes stay in sync for CSS selectors
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('oma_skin', s); } catch (_) {}
  const names = { 'terminal-glass': 'Terminal Glass', 'vector-soft': 'Vector Soft — Obsidian Editorial', 'zen-calm': 'Zen Calm' };
  if ($('skinNameLabel')) $('skinNameLabel').textContent = names[s] || s;
  if ($('footerSkinLabel')) $('footerSkinLabel').textContent = `پوسته ${names[s] || s} · داده محلی`;
  // force repaint so CSS variables apply immediately
  document.body && void document.body.offsetHeight;
}


async function runBacktestUI() {
  const status = $('btStatus');
  const metrics = $('btMetrics');
  const samples = $('btSamples');
  if (!currentSymbol) {
    toast('ابتدا نماد را انتخاب کنید', 'err');
    return;
  }
  if (status) status.textContent = 'در حال آماده‌سازی داده پروژه و اجرای بک‌تست…';
  if (metrics) { metrics.hidden = true; metrics.innerHTML = ''; }
  if (samples) { samples.hidden = true; samples.innerHTML = ''; }

  try {
    try {
      const { ensureProjectData } = await import('./logic/datasets.js');
      const proj = await ensureProjectData(currentSymbol, currentTf);
      if (proj?.ok && proj.source && proj.source !== 'store') {
        if (status) status.textContent = `داده پروژه بارگذاری شد (${proj.count} کندل از ${proj.source}) — در حال بک‌تست…`;
      }
    } catch (_) {}
    const series = buildAnalysisSeries(currentSymbol, currentTf);
    if (!series || !series.candles || series.candles.length < 40) {
      const msg = `داده کافی نیست (${series?.candles?.length || 0} کندل). حداقل ~40 لازم است. از بخش «بارگذاری قیمت‌ها» یا فایل‌های data/ استفاده کنید.`;
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
      const pc = result.perClass || {};
      const upF1 = pc.up?.f1 ?? '—';
      const dnF1 = pc.down?.f1 ?? '—';
      const neuF1 = pc.neutral?.f1 ?? '—';
      metrics.innerHTML = `
        <div class="bt-metric"><div class="k">دقت ۳کلاسه</div><div class="v ${aCls}">${result.accuracy}%</div></div>
        <div class="bt-metric"><div class="k">دقت جهتی</div><div class="v">${result.directionalAccuracy}%</div></div>
        <div class="bt-metric"><div class="k">F1 خرید</div><div class="v">${upF1}%</div></div>
        <div class="bt-metric"><div class="k">F1 فروش</div><div class="v">${dnF1}%</div></div>
        <div class="bt-metric"><div class="k">F1 نگهداری</div><div class="v">${neuF1}%</div></div>
        <div class="bt-metric"><div class="k">نرخ برد</div><div class="v">${result.winRate}%</div></div>
        <div class="bt-metric"><div class="k">Target Hit</div><div class="v">${result.targetHitRate ?? '—'}%</div></div>
        <div class="bt-metric"><div class="k">Stop Hit</div><div class="v">${result.stopHitRate ?? '—'}%</div></div>
        <div class="bt-metric"><div class="k">Profit Factor</div><div class="v">${result.profitFactor ?? '—'}</div></div>
        <div class="bt-metric"><div class="k">Avg R:R</div><div class="v">${result.avgRiskReward ?? '—'}</div></div>
        <div class="bt-metric"><div class="k">Avg Return</div><div class="v">${result.avgReturnPct ?? '—'}%</div></div>
        <div class="bt-metric"><div class="k">Max DD</div><div class="v">${result.maxDrawdown ?? '—'}</div></div>
        <div class="bt-metric"><div class="k">MFE / MAE</div><div class="v">${result.avgMfe ?? '—'} / ${result.avgMae ?? '—'}</div></div>
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



/* ── Market Pattern Brain UI ── */
function downloadTextFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadMergedCsv() {
  const sym = currentSymbol || $('symbol')?.value;
  if (!sym) { toast('ابتدا نماد را انتخاب کنید', 'err'); return; }
  try {
    const { exportMergedCSV, promoteManualIntoHistorical } = await import('./logic/datasets.js');
    // Persist manual into historical so next upload/session keeps them
    promoteManualIntoHistorical(sym, currentTf || '1D', false);
    const out = exportMergedCSV(sym, currentTf || '1D');
    if (!out.count) { toast('داده‌ای برای دانلود نیست', 'err'); return; }
    downloadTextFile(out.filename, out.csv, 'text/csv');
    toast(`CSV ذخیره شد · ${out.count} ردیف (دستی: ${out.manualCount})`, 'ok');
    setDataStatus(`CSV به‌روز: ${out.count} ردیف · تاریخچه+دستی`, 'ok');
  } catch (err) {
    toast(err?.message || 'خطا در ساخت CSV', 'err');
  }
}

async function downloadPatternLibrary() {
  try {
    const { exportPatternsJSON } = await import('./logic/mpb/memory.js');
    const json = exportPatternsJSON();
    const name = `mpb_patterns_${new Date().toISOString().slice(0, 10)}.json`;
    downloadTextFile(name, json, 'application/json');
    toast('حافظه الگوها دانلود شد', 'ok');
  } catch (err) {
    toast(err?.message || 'خطا در دانلود الگوها', 'err');
  }
}

async function importPatternLibraryFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const { importPatternsJSON } = await import('./logic/mpb/memory.js');
    const res = importPatternsJSON(text);
    if (!res.ok) { toast(res.error || 'بارگذاری ناموفق', 'err'); return; }
    toast(`${res.added} الگو اضافه شد · مجموع ${res.total}`, 'ok');
    refreshMPBLibrary();
  } catch (err) {
    toast(err?.message || 'خطا در خواندن فایل', 'err');
  }
}

async function refreshMPBLibrary() {
  const box = $('mpbLibraryList');
  const statsEl = $('mpbMemoryStats');
  try {
    const { listPatterns, patternMemoryStats, deletePattern } = await import('./logic/mpb/memory.js');
    const items = listPatterns();
    const stats = patternMemoryStats();
    if (statsEl) statsEl.textContent = `ذخیره‌شده: ${stats.total} الگو`;
    if (!box) return;
    if (!items.length) {
      box.innerHTML = '<p class="muted">هنوز الگویی ذخیره نشده. پس از «اجرای تحلیل» الگوها اینجا می‌مانند.</p>';
      return;
    }
    box.innerHTML = items.slice(0, 30).map(it => `
      <div class="mpb-lib-item" data-id="${it.id}">
        <div>
          <strong>${it.patternLabel || it.patternId || 'الگو'}</strong>
          <span class="muted"> · ${it.symbol}/${it.timeframe}</span>
          <div class="mono muted">${(it.savedAt || '').replace('T', ' ').slice(0, 19)} · اطمینان ${it.confidence ?? '—'}٪</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm mpb-del" data-id="${it.id}">حذف</button>
      </div>
    `).join('');
    box.querySelectorAll('.mpb-del').forEach(btn => {
      btn.onclick = async () => {
        const { deletePattern } = await import('./logic/mpb/memory.js');
        deletePattern(btn.dataset.id);
        refreshMPBLibrary();
        toast('الگو حذف شد', 'ok');
      };
    });
  } catch {
    if (statsEl) statsEl.textContent = 'حافظه در دسترس نیست';
    if (box) box.innerHTML = '';
  }
}

function syncFundPageFromToggle() {
  const main = $('fundToggle');
  const page = $('fundTogglePage');
  if (page && main) page.checked = !!main.checked;
  const hint = $('fundPageHint');
  if (hint) hint.textContent = (page && page.checked) ? 'روشن — در اجرای تحلیل لحاظ می‌شود' : 'خاموش — فقط تحلیل قیمت';
  const st = $('fundPageStatus');
  if (st) st.textContent = (page && page.checked)
    ? 'تحلیل بنیادی فعال است — داده از ورودی دستی آفلاین خوانده می‌شود.'
    : 'تحلیل بنیادی خاموش است.';
}

function renderMPBPanel(result) {
  const mpb = result?.mpb;
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text ?? '—'; };
  const badge = $('mpbStatusBadge');
  const FA_REGIME = {
    BullTrend: 'روند صعودی', BearTrend: 'روند نزولی', Sideways: 'خنثی / رنج',
    HighVol: 'نوسان بالا', LowVol: 'نوسان پایین', Compression: 'فشردگی',
    Expansion: 'گسترش نوسان', Breakout: 'شکست سطح', Reversal: 'بازگشت',
    Accumulation: 'جمع‌آوری', Distribution: 'توزیع', Unclear: 'نامشخص'
  };

  if (!mpb) {
    set('mpbRegime', '—');
    set('mpbPattern', 'ابتدا تحلیل را اجرا کنید');
    set('mpbConfidence', '—');
    set('mpbDataQ', '—');
    if ($('mpbSuggestion')) $('mpbSuggestion').textContent = 'پس از اجرای تحلیل، پیشنهاد ساده اینجا نمایش داده می‌شود.';
    if (badge) { badge.textContent = 'بدون داده'; badge.className = 'badge is-bad'; }
    ['mpbEvidence', 'mpbContradictions', 'mpbMatchesBody', 'mpbTrace'].forEach(id => {
      const el = $(id); if (el) el.innerHTML = '';
    });
    if ($('mpbOutcomes')) $('mpbOutcomes').innerHTML = '<span class="muted">هنوز تحلیلی اجرا نشده است.</span>';
    if ($('mpbScenarios')) $('mpbScenarios').innerHTML = '';
    if ($('mpbMeta')) $('mpbMeta').textContent = '';
    if ($('mpbConfBreak')) $('mpbConfBreak').innerHTML = '';
    if ($('mpbDna')) $('mpbDna').textContent = '';
    refreshMPBLibrary();
    return;
  }

  const st = mpb.status || 'OK';
  const stFa = st === 'OK' ? 'آماده' : st === 'INSUFFICIENT_EVIDENCE' ? 'شواهد ناکافی' : st;
  if (badge) {
    badge.textContent = stFa;
    badge.className = 'badge ' + (st === 'OK' ? 'is-ok' : st === 'INSUFFICIENT_EVIDENCE' ? 'is-bad' : 'is-low');
  }

  const reg = mpb.regime?.primary || '—';
  set('mpbRegime', FA_REGIME[reg] || reg);
  set('mpbRegimeConf', mpb.regime?.confidence != null
    ? `اطمینان از وضعیت: ${Math.round(mpb.regime.confidence * 100)}٪` : '');
  const ap = mpb.activePatterns?.[0];
  set('mpbPattern', ap?.label || ap?.id || '—');
  set('mpbSim', ap?.similarity != null ? `شباهت: ${(ap.similarity * 100).toFixed(1)}٪` : '');
  set('mpbConfidence', mpb.confidence?.overall != null ? mpb.confidence.overall + '٪' : '—');
  const confMap = { High: 'بالا', Moderate: 'متوسط', Low: 'پایین', 'Very Low': 'خیلی پایین' };
  set('mpbConfLabel', confMap[mpb.confidence?.label] || mpb.confidence?.label || mpb.confidence?.note || '');
  // پیشنهاد ساده برای کاربر عمومی بر اساس الگو و رژیم
  if ($('mpbSuggestion')) {
    let suggest = '';
    if (st === 'INSUFFICIENT_EVIDENCE') {
      suggest = 'داده یا نمونه‌های تاریخی کافی نیست. CSV بیشتری بارگذاری کنید یا بازه زمانی دیگری امتحان کنید.';
    } else {
      const conf = mpb.confidence?.overall ?? 0;
      const regKey = mpb.regime?.primary || '';
      const pat = ap?.label || ap?.id || 'الگوی نامشخص';
      if (regKey === 'BullTrend' && conf >= 55) {
        suggest = `الگوی «${pat}» در روند صعودی دیده می‌شود. نمونه‌های مشابه تاریخی بیشتر رشد داشته‌اند — با احتیاط و حد ضرر مدیریت کنید.`;
      } else if (regKey === 'BearTrend' && conf >= 55) {
        suggest = `الگوی «${pat}» در روند نزولی است. در گذشته اغلب فشار فروش ادامه داشته — از ورود عجولانه بپرهیزید.`;
      } else if (regKey === 'Sideways' || regKey === 'Compression') {
        suggest = `بازار در حالت رنج/فشردگی («${pat}») است. صبر برای شکست واضح سطح معمولاً منطقی‌تر از معامله زودهنگام است.`;
      } else if (conf < 40) {
        suggest = `اطمینان پایین است. الگوی «${pat}» را فقط به‌عنوان هشدار در نظر بگیرید، نه سیگنال قطعی.`;
      } else {
        suggest = `الگوی فعال: «${pat}». جزئیات شواهد و نمونه‌های تاریخی را در بخش‌های پایین ببینید و با مدیریت ریسک تصمیم بگیرید.`;
      }
    }
    $('mpbSuggestion').textContent = suggest;
  }
  set('mpbDataQ', mpb.dataQuality?.score != null ? mpb.dataQuality.score + ' از ۱۰۰' : '—');
  set('mpbDataIssues', (mpb.dataQuality?.issues || []).slice(0, 3).join(' · ') || '');

  const evUl = $('mpbEvidence');
  if (evUl) {
    const list = mpb.evidence || [];
    evUl.innerHTML = list.length
      ? list.map(e => `<li>✓ ${e.text || e} <span class="muted">(${e.source || ''})</span></li>`).join('')
      : '<li class="muted">—</li>';
  }
  const ctUl = $('mpbContradictions');
  if (ctUl) {
    const list = mpb.contradictions || [];
    ctUl.innerHTML = list.length
      ? list.map(c => `<li>⚠ ${c.text || c} <span class="muted">(${c.source || ''})</span></li>`).join('')
      : '<li class="muted">تناقض مهمی ثبت نشد</li>';
  }

  const outEl = $('mpbOutcomes');
  if (outEl) {
    const o = mpb.outcomes || {};
    const parts = [];
    for (const h of (mpb.horizons || [5, 10, 20])) {
      const s = o[String(h)] || o[h];
      if (!s) continue;
      if (s.status === 'INSUFFICIENT_EVIDENCE') {
        parts.push(`<div><strong>${h} دوره بعد:</strong> شواهد ناکافی (تعداد نمونه=${s.sampleSize || 0})</div>`);
      } else {
        parts.push(
          `<div><strong>${h} دوره بعد:</strong> نمونه ${s.sampleSize} · رشد ${(s.winRate * 100).toFixed(0)}٪ · ` +
          `میانه بازده ${(s.medianReturn * 100).toFixed(2)}٪ · بیشترین سود ${(s.meanMFE * 100).toFixed(2)}٪ · بیشترین ضرر ${(s.meanMAE * 100).toFixed(2)}٪</div>`
        );
      }
    }
    outEl.innerHTML = parts.length ? parts.join('') : '<span class="muted">نتیجه تاریخی در دسترس نیست</span>';
  }

  const tbody = $('mpbMatchesBody');
  if (tbody) {
    const matches = mpb.historicalMatches || [];
    tbody.innerHTML = matches.length
      ? matches.map(m => {
          const r5 = m.outcomes?.['5'] || m.outcomes?.[5];
          const r10 = m.outcomes?.['10'] || m.outcomes?.[10];
          const fmtR = (o) => o && o.return != null ? (o.return * 100).toFixed(2) + '٪' : '—';
          return `<tr><td class="mono">${m.date || m.index}</td><td>${(m.similarity * 100).toFixed(1)}٪</td><td>${fmtR(r5)}</td><td>${fmtR(r10)}</td></tr>`;
        }).join('')
      : '<tr><td colspan="4" class="muted">نمونه مشابهی پیدا نشد</td></tr>';
  }

  const scEl = $('mpbScenarios');
  if (scEl) {
    const nameFa = { bullish: 'سناریوی صعودی', bearish: 'سناریوی نزولی', neutral: 'سناریوی خنثی', insufficient: 'شواهد ناکافی' };
    const sc = mpb.scenarios || [];
    scEl.innerHTML = sc.map(s => `
      <div class="mpb-scenario">
        <strong>${nameFa[s.id] || s.name}</strong>
        ${s.probabilityHint != null ? `تقریبی≈${(s.probabilityHint * 100).toFixed(0)}٪ · ` : ''}
        شرط: ${s.trigger || '—'}
        ${s.note ? `<div class="muted">${s.note === 'INSUFFICIENT_EVIDENCE' ? 'شواهد ناکافی' : s.note}</div>` : ''}
      </div>
    `).join('') || '<span class="muted">—</span>';
  }

  if ($('mpbMeta')) {
    const meta = mpb.metaPatterns;
    $('mpbMeta').innerHTML = meta
      ? `<strong>توالی الگو:</strong> ${meta.label || '—'} <span class="muted">(${meta.status === 'DETECTED' ? 'شناسایی‌شده' : meta.status === 'PARTIAL' ? 'ناقص' : 'بدون توالی'})</span>`
      : '';
  }

  const cb = $('mpbConfBreak');
  if (cb && mpb.confidence?.components) {
    const labels = {
      dataQuality: 'کیفیت داده',
      regimeAlignment: 'هم‌راستایی وضعیت',
      patternSimilarity: 'شباهت الگو',
      historicalReliability: 'پایداری تاریخی',
      evidenceStrength: 'قدرت شواهد',
      sampleAdequacy: 'کفایت نمونه',
      contradictionPenalty: 'جریمه تناقض'
    };
    const c = mpb.confidence.components;
    cb.innerHTML = '<div class="mpb-conf-bar">' +
      Object.entries(c).map(([k, v]) =>
        `<span class="mpb-conf-chip">${labels[k] || k}: ${v}٪</span>`
      ).join('') + '</div>';
  }

  const tr = $('mpbTrace');
  if (tr) {
    const lines = mpb.reasoningTrace || [];
    tr.innerHTML = lines.map(l => `<li>${l}</li>`).join('') || '<li class="muted">—</li>';
  }

  if ($('mpbDna')) {
    const dna = ap?.dna || mpb.activePatterns?.[0]?.dna || null;
    $('mpbDna').textContent = dna ? JSON.stringify(dna, null, 2) : (mpb.status || '—');
  }

  if (mpb.patternMemory?.totalInLibrary != null && $('mpbMemoryStats')) {
    $('mpbMemoryStats').textContent = `ذخیره‌شده: ${mpb.patternMemory.totalInLibrary} الگو`;
  }
  refreshMPBLibrary();
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
    // Debugger uses technical path only; Fundamental is optional via Prediction toggle
    const report = await runAutoDebugger({
      mode,
      candles,
      symbol: currentSymbol,
      currentPrice,
      fundamentalSnapshot: null,
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
    const report = await runAutoDebugger({
      mode: 'deep',
      candles,
      symbol: currentSymbol,
      currentPrice,
      fundamentalSnapshot: null,
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
  // restore skin/theme/lang first so UI never flashes wrong skin
  try {
    const sk = localStorage.getItem('oma_skin') || 'terminal-glass';
    applySkin(sk);
    applyLang(localStorage.getItem('oma_lang') || 'fa');
  } catch (_) {
    applySkin('terminal-glass');
    applyLang('fa');
  }
  // desktop default: sidebar open so layout reserves column
  if (window.matchMedia('(min-width: 901px)').matches) {
    document.body.classList.remove('sidebar-collapsed');
    $('sidebar')?.classList.add('is-open');
  }
  applyTheme(getTheme());
  $('themeBtn') && ($('themeBtn').onclick = () => applyTheme(getTheme() === 'dark' ? 'light' : 'dark'));
  tickClock();
  setInterval(tickClock, 1000);
  renderAssetPicker();
  updateSmartDateTimeUI();

  $('symbol').addEventListener('change', onSymbolChange);
  $('tf').addEventListener('change', async () => {
    currentTf = $('tf').value || '1D';
    updateHeaderAssetLabel();
    updateSmartDateTimeUI();
    if (currentSymbol) {
      try {
        const { ensureProjectData } = await import('./logic/datasets.js');
        await ensureProjectData(currentSymbol, currentTf);
      } catch (_) {}
      refreshAssetPanel(currentSymbol);
    }
  });
  $('priceForm').addEventListener('submit', saveDailyPrice);
  $('downloadCsvBtn')?.addEventListener('click', downloadMergedCsv);
  $('mpbDownloadPatternsBtn')?.addEventListener('click', downloadPatternLibrary);
  $('mpbImportPatternsBtn')?.addEventListener('click', () => $('mpbImportFile')?.click());
  $('mpbImportFile')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importPatternLibraryFile(f);
    e.target.value = '';
  });
  $('fundTogglePage')?.addEventListener('change', () => {
    const main = $('fundToggle');
    if (main) main.checked = !!$('fundTogglePage').checked;
    // persist preference
    try { localStorage.setItem('oma_fund_toggle', main && main.checked ? '1' : '0'); } catch (_) {}
    syncFundPageFromToggle();
  });
  // restore fund preference
  try {
    const pref = localStorage.getItem('oma_fund_toggle');
    if (pref === '1' && $('fundToggle')) $('fundToggle').checked = true;
  } catch (_) {}
  // Pre-wire offline fundamental form so variable list is ready
  try { wireFundForm(); } catch (_) {}

  $('analyzeBtn') && ($('analyzeBtn').onclick = () => runAnalysis(false));
  $('clearBtn') && ($('clearBtn').onclick = clearAll);

  // Fundamental toggle (optional input to Prediction)
  const fundToggle = $('fundToggle');
  if (fundToggle) {
    fundToggle.addEventListener('change', () => {
      setFundHint();
      if (!fundToggle.checked) setFundFetchStatus('');
    });
    setFundHint();
  }

  // tabs/paste/table removed in v8.0.3 — file upload only

  async function ingestCsvFile(file) {
    if (!file) return;
    const text = await file.text();
    if ($('data')) $('data').value = text;
    if ($('fileName')) {
      $('fileName').hidden = false;
      if ($('fileNameText')) $('fileNameText').textContent = file.name;
      if ($('fileMeta')) $('fileMeta').textContent = `${Math.round(file.size / 1024)} KB`;
    }
    const sym = currentSymbol || $('symbol')?.value;
    if (!sym) {
      toast('ابتدا نماد را انتخاب کنید، سپس فایل را بارگذاری کنید', 'err');
      setDataStatus('نماد انتخاب نشده — فایل در بافر است', 'warn');
      return;
    }
    currentTf = $('tf')?.value || currentTf || '1D';
    const imp = await importHistoricalIfAny(sym, currentTf);
    if (imp.error) {
      toast(imp.error, 'err');
      setDataStatus(imp.error, 'err');
      return;
    }
    // also try project path cache refresh
    try {
      const { ensureProjectData } = await import('./logic/datasets.js');
      await ensureProjectData(sym, currentTf);
    } catch (_) {}
    refreshAssetPanel(sym);
    const n = imp.imported || 0;
    const msg = n ? `${n} کندل از CSV برای ${sym}/${currentTf} ذخیره شد` : 'فایل خوانده شد (ممکن است تکراری باشد)';
    setDataStatus(msg, 'ok');
    toast(msg, 'ok');
  }

  const drop = $('drop'), csv = $('csv');
  if (drop && csv) {
    drop.onclick = () => csv.click();
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); csv.click(); } };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('dragover'); };
    drop.ondragleave = () => drop.classList.remove('dragover');
    drop.ondrop = async e => {
      e.preventDefault(); drop.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) await ingestCsvFile(f);
    };
    csv.onchange = async () => {
      const f = csv.files[0];
      if (f) await ingestCsvFile(f);
      csv.value = '';
    };
  }

  // MPB: load CSV price data into current symbol
  $('mpbLoadCsvBtn')?.addEventListener('click', () => $('mpbCsvFile')?.click());
  $('mpbCsvFile')?.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) await ingestCsvFile(f);
    e.target.value = '';
  });

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

  $('addAssetBtn').onclick = () => {
    const dlg = $('addAssetDialog');
    if ($('newSym')) $('newSym').value = '';
    if ($('newName')) $('newName').value = '';
    if ($('newCat')) $('newCat').value = 'stocks';
    dlg?.showModal();
  };
  $('addAssetCancelBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $('addAssetDialog')?.close();
  });
  $('addAssetForm').onsubmit = (e) => {
    e.preventDefault();
    const symRaw = ($('newSym')?.value || '').trim();
    if (!symRaw) { toast('نماد را وارد کنید', 'err'); return; }
    const res = registerCustomAsset({
      symbol: symRaw,
      nameFa: ($('newName')?.value || '').trim() || symRaw,
      category: $('newCat')?.value || 'stocks'
    });
    if (!res.ok) { toast(res.error || 'افزودن ناموفق', 'err'); return; }
    $('addAssetDialog')?.close();
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
  function isDesktopLayout() {
    return window.matchMedia('(min-width: 901px)').matches;
  }
  function openSidebar() {
    const sb = $('sidebar');
    const ov = $('sidebarOverlay');
    if (sb) sb.classList.add('is-open');
    document.body.classList.add('sidebar-open');
    document.body.classList.remove('sidebar-collapsed');
    if (ov && !isDesktopLayout()) {
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
    if (isDesktopLayout()) {
      document.body.classList.add('sidebar-collapsed');
    }
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
      // فقط در موبایل منو را ببند؛ در دسکتاپ باز بماند
      if (!isDesktopLayout()) closeSidebar();
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
      const sb = $('sidebar');
      if (isDesktopLayout()) {
        if (document.body.classList.contains('sidebar-collapsed')) {
          openSidebar(); // expands grid + shows sidebar
        } else {
          closeSidebar(); // collapses grid column so main grows
        }
      } else {
        const isOpen = sb && sb.classList.contains('is-open');
        if (isOpen) closeSidebar();
        else openSidebar();
      }
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

  // Settings page
  document.querySelectorAll('input[name="setTheme"]').forEach(r => {
    r.addEventListener('change', () => { if (r.checked) applyTheme(r.value); });
  });
  document.querySelectorAll('input[name="setLang"]').forEach(r => {
    r.addEventListener('change', () => { if (r.checked) applyLang(r.value); });
  });
  document.querySelectorAll('input[name="setSkin"]').forEach(r => {
    r.addEventListener('change', () => { if (r.checked) applySkin(r.value); });
  });
  try {
    const sk = localStorage.getItem('oma_skin') || 'terminal-glass';
    const radio = document.querySelector(`input[name="setSkin"][value="${sk}"]`);
    if (radio) radio.checked = true;
    applySkin(sk);
  } catch (_) { applySkin('terminal-glass'); }

  window.__OMA_V5__ = { getCachedSymbols, buildAnalysisSeries, loadManual, loadHistorical, getDataDayIndex };
}

init();


/* ── Fundamental offline form (v11.2) — inline list + advanced blend ── */
const FUND_ADV_KEY = 'oma_v11_fund_adv';

function getFundAdvancedSettings() {
  const def = { blendPct: 38, sensitivity: 115, minCoveragePct: 20, requireActual: true };
  try {
    const raw = localStorage.getItem(FUND_ADV_KEY);
    if (!raw) return {
      blendPct: def.blendPct,
      sensitivity: def.sensitivity,
      minCoveragePct: def.minCoveragePct,
      requireActual: def.requireActual,
      weightMult: def.blendPct / 30,
      minCoverage: def.minCoveragePct / 100
    };
    const o = JSON.parse(raw);
    const blendPct = Math.max(0, Math.min(70, Number(o.blendPct) || 30));
    const sensitivity = Math.max(50, Math.min(150, Number(o.sensitivity) || 100));
    const minCoveragePct = Math.max(10, Math.min(80, Number(o.minCoveragePct) || 25));
    const requireActual = o.requireActual !== false;
    return {
      blendPct, sensitivity, minCoveragePct, requireActual,
      weightMult: blendPct / 30,
      minCoverage: minCoveragePct / 100
    };
  } catch {
    return { ...def, weightMult: 1, minCoverage: 0.25 };
  }
}

function saveFundAdvancedSettings(partial) {
  const cur = getFundAdvancedSettings();
  const next = { ...cur, ...partial };
  try {
    localStorage.setItem(FUND_ADV_KEY, JSON.stringify({
      blendPct: next.blendPct,
      sensitivity: next.sensitivity,
      minCoveragePct: next.minCoveragePct,
      requireActual: next.requireActual
    }));
  } catch (_) {}
  return getFundAdvancedSettings();
}

async function ensureFundModule() {
  if (window.__fundMod) return window.__fundMod;
  try {
    const mod = await import('./logic/fundamental.js');
    window.__fundMod = mod;
    return mod;
  } catch (e) {
    console.warn('fund module', e);
    return null;
  }
}

function activeFundSymbol() {
  const fromMod = (typeof currentSymbol === 'string' && currentSymbol) ? currentSymbol : '';
  const fromWin = (typeof window !== 'undefined' && window.currentSymbol) ? window.currentSymbol : '';
  const fromLs = localStorage.getItem('oma_symbol') || '';
  const fromSel = $('symbol')?.value || '';
  return String(fromMod || fromWin || fromLs || fromSel || 'XAUUSD').toUpperCase();
}

async function refreshFundEditableList() {
  const list = $('fundEditableList');
  const sum = $('fundLiveSummary');
  if (!list) return;
  const mod = await ensureFundModule();
  if (!mod) {
    list.innerHTML = '<p class="muted">ماژول بنیادی در دسترس نیست.</p>';
    return;
  }
  const sym = activeFundSymbol();
  const schema = (mod.getSchemaForSymbol(sym) || []).slice(0, 8);
  const data = mod.getFundamentalData(sym) || {};
  if (!schema.length) {
    list.innerHTML = '<p class="muted">متغیری برای این نماد تعریف نشده.</p>';
    return;
  }
  list.innerHTML = schema.map(v => {
    const r = data[v.id] || {};
    const act = r.actual != null ? r.actual : '';
    const fc = r.forecast != null ? r.forecast : '';
    const pr = r.previous != null ? r.previous : '';
    const dt = r.date || '';
    return `<div class="fund-row" data-var="${v.id}" role="listitem">
      <div class="fund-row-head">
        <span class="fund-row-name">${v.nameFa}</span>
        <span class="fund-row-meta mono">${v.unit || ''}</span>
      </div>
      <div class="fund-row-fields">
        <label>واقعی<input class="input mono fund-inp" data-f="actual" type="number" step="any" value="${act}" placeholder="—"></label>
        <label>پیش‌بینی<input class="input mono fund-inp" data-f="forecast" type="number" step="any" value="${fc}" placeholder="—"></label>
        <label>قبلی<input class="input mono fund-inp" data-f="previous" type="number" step="any" value="${pr}" placeholder="—"></label>
        <label>تاریخ<input class="input mono fund-inp" data-f="date" type="date" value="${dt}"></label>
      </div>
      <div class="fund-row-actions">
        <button type="button" class="btn btn-primary btn-sm fund-save-row">ذخیره</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.fund-row').forEach(row => {
    const btn = row.querySelector('.fund-save-row');
    if (!btn || btn._wired) return;
    btn._wired = true;
    btn.addEventListener('click', async () => {
      const mod2 = await ensureFundModule();
      if (!mod2) return;
      const varId = row.dataset.var;
      const payload = {};
      row.querySelectorAll('.fund-inp').forEach(inp => {
        payload[inp.dataset.f] = inp.value;
      });
      const symSave = activeFundSymbol();
      const res = mod2.upsertFundamentalVar(symSave, varId, payload);
      const msg = $('fundFormMsg');
      const label = row.querySelector('.fund-row-name')?.textContent || varId;
      if (res.ok) {
        // Verify persisted in store
        const stored = mod2.getFundamentalData(symSave) || {};
        const okPersist = stored[varId] && (
          (payload.actual === '' || payload.actual == null || Number(stored[varId].actual) === Number(payload.actual)) ||
          stored[varId].updatedAt
        );
        if (msg) msg.textContent = okPersist
          ? `ذخیره شد: ${label} (${symSave})`
          : `هشدار: ذخیره ${label} ممکن است در localStorage ثبت نشده باشد.`;
        toast(okPersist ? `بنیادی ذخیره شد — ${label}` : `خطا در ذخیره‌سازی ${label}`, okPersist ? 'ok' : 'err');
        refreshFundSummaryOnly();
      } else {
        if (msg) msg.textContent = res.error || 'خطا';
        toast(res.error || 'ذخیره بنیادی ناموفق', 'err');
      }
    });
  });

  await refreshFundSummaryOnly();
}

async function refreshFundSummaryOnly() {
  const sum = $('fundLiveSummary');
  const mod = await ensureFundModule();
  if (!mod || !sum) return;
  const fund = mod.runFundamental(activeFundSymbol(), undefined, { regime: 'Unclear' });
  sum.textContent = mod.fundamentalSummaryFa(fund);
}

function wireFundAdvanced() {
  const toggle = $('fundAdvToggle');
  const panel = $('fundAdvPanel');
  if (toggle && !toggle._wired) {
    toggle._wired = true;
    toggle.addEventListener('click', () => {
      const open = panel && !panel.hidden;
      if (panel) panel.hidden = open;
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  }
  const s = getFundAdvancedSettings();
  const setVal = (id, v, labelId, suffix) => {
    const el = $(id);
    const lab = $(labelId);
    if (el) el.value = String(v);
    if (lab) lab.textContent = (Number(v).toLocaleString('fa-IR')) + (suffix || '');
  };
  setVal('fundBlendPct', s.blendPct, 'fundBlendPctVal', '٪');
  setVal('fundSensPct', s.sensitivity, 'fundSensPctVal', '٪');
  setVal('fundMinCoverage', s.minCoveragePct, 'fundMinCoverageVal', '٪');
  if ($('fundRequireActual')) $('fundRequireActual').checked = s.requireActual;

  const bindRange = (id, key, labelId) => {
    const el = $(id);
    if (!el || el._wired) return;
    el._wired = true;
    el.addEventListener('input', () => {
      const v = Number(el.value);
      if ($(labelId)) $(labelId).textContent = v.toLocaleString('fa-IR') + '٪';
      saveFundAdvancedSettings({ [key]: v });
    });
  };
  bindRange('fundBlendPct', 'blendPct', 'fundBlendPctVal');
  bindRange('fundSensPct', 'sensitivity', 'fundSensPctVal');
  bindRange('fundMinCoverage', 'minCoveragePct', 'fundMinCoverageVal');
  const req = $('fundRequireActual');
  if (req && !req._wired) {
    req._wired = true;
    req.addEventListener('change', () => saveFundAdvancedSettings({ requireActual: !!req.checked }));
  }
  const reset = $('fundAdvReset');
  if (reset && !reset._wired) {
    reset._wired = true;
    reset.addEventListener('click', () => {
      saveFundAdvancedSettings({ blendPct: 38, sensitivity: 115, minCoveragePct: 20, requireActual: true });
      wireFundAdvanced();
    });
  }
}

function wireFundForm() {
  wireFundAdvanced();
  const clearAll = $('fundClearAllBtn');
  if (clearAll && !clearAll._wired) {
    clearAll._wired = true;
    clearAll.addEventListener('click', async () => {
      if (!window.confirm('همه داده‌های بنیادی این نماد پاک شود؟')) return;
      const mod = await ensureFundModule();
      if (!mod) return;
      mod.clearFundamentalVar(activeFundSymbol());
      const msg = $('fundFormMsg');
      if (msg) msg.textContent = 'داده‌های نماد پاک شد.';
      refreshFundEditableList();
    });
  }
  refreshFundEditableList();
}


/* ── Forecast candlestick chart (v11.5) ── */
let __chartState = null;

function buildForecastCandles(hist, result, nFuture = 3) {
  if (!hist || !hist.length) return { hist: [], future: [] };
  const last = hist[hist.length - 1];
  const close = Number(last.c);
  if (!Number.isFinite(close) || close <= 0) return { hist, future: [] };

  let atr = result?.atr ?? result?.analysis?.atr ?? result?.indicators?.atr;
  atr = Number(atr);
  let step = Number.isFinite(atr) && atr > 0 ? atr * 0.55 : null;
  if (!step || step <= 0) {
    const slice = hist.slice(-20);
    const ranges = slice.map(c => Number(c.h) - Number(c.l)).filter(x => Number.isFinite(x) && x > 0);
    const avg = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : close * 0.004;
    step = Math.max(avg * 0.65, close * 0.001);
  }

  const signal = result?.signal || 'HOLD';
  const target = Number(result?.target);
  const stop = Number(result?.stop);
  let dir = 0;
  if (signal === 'BUY') dir = 1;
  else if (signal === 'SELL') dir = -1;
  else if (Number.isFinite(target) && target > close) dir = 0.4;
  else if (Number.isFinite(target) && target < close) dir = -0.4;

  const tfMs = (() => {
    const tf = currentTf || '1D';
    if (tf === '1H') return 3600000;
    if (tf === '4H') return 4 * 3600000;
    if (tf === '1W') return 7 * 86400000;
    return 86400000;
  })();

  const future = [];
  let px = close;
  const lastTs = Number.isFinite(last.ts) ? last.ts : Date.now();
  const conf0 = Number.isFinite(result?.confidence) ? result.confidence : 0.5;

  for (let i = 1; i <= nFuture; i++) {
    const progress = i / nFuture;
    let dest = px + dir * step * (1.1 - progress * 0.3);
    if (Number.isFinite(target) && dir !== 0) {
      dest = px * (1 - progress * 0.35) + (close + (target - close) * progress * 0.7) * (progress * 0.35 + 0.65);
      dest = px + (dest - px);
      dest = px + (target - close) * (0.22 * progress) + dir * step * 0.2 * (1 - progress * 0.4);
    }
    // keep path stable (no Math.random) so redraws don't jump
    const wobble = step * 0.12 * Math.sin(i * 1.7 + conf0);
    const o = px;
    const c = dest + wobble * 0.15;
    const wick = step * (0.35 + 0.12 * progress);
    const h = Math.max(o, c) + wick * 0.4;
    const l = Math.min(o, c) - wick * 0.4;
    future.push({
      o, h, l, c,
      v: null,
      ts: lastTs + i * tfMs,
      forecast: true,
      conf: Math.max(0.22, conf0 * (1 - progress * 0.32))
    });
    px = c;
  }
  return { hist, future };
}

function formatChartDate(c, tf) {
  const ts = c?.ts;
  if (!Number.isFinite(ts)) return c?.day || c?.date || '—';
  const d = new Date(ts);
  if (tf === '1D' || tf === '1W') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
}

function drawForecastChartFrame(state, pulse = 0) {
  const { canvas, cssW, cssH, pad, hist, future, all, result, tf, showDates, showVolume, splitIndex } = state;
  const ctx = canvas.getContext('2d');
  const dpr = state.dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const W = cssW - pad.l - pad.r;
  const volH = showVolume ? 44 : 0;
  const H = cssH - pad.t - pad.b - volH;
  let lo = Math.min(...all.map(c => Number(c.l)).filter(Number.isFinite));
  let hi = Math.max(...all.map(c => Number(c.h)).filter(Number.isFinite));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    lo = 0; hi = 1;
  }
  const padY = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
  lo -= padY; hi += padY;
  const yScale = (p) => pad.t + H * (1 - (p - lo) / (hi - lo));
  const slot = W / Math.max(all.length, 1);
  const bodyW = Math.max(3, Math.min(16, slot * 0.62));

  const bg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#12141a';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssW, cssH);

  // grid
  ctx.strokeStyle = 'rgba(148,163,184,0.12)';
  ctx.lineWidth = 1;
  for (let g = 0; g < 5; g++) {
    const y = pad.t + (H * g) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke();
  }

  const splitX = pad.l + splitIndex * slot;
  // forecast zone soft fill (non-destructive, drawn under candles)
  if (future.length) {
    ctx.fillStyle = `rgba(167, 139, 250, ${0.06 + pulse * 0.08})`;
    ctx.fillRect(splitX, pad.t, Math.max(0, pad.l + W - splitX), H);
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(splitX, pad.t); ctx.lineTo(splitX, pad.t + H); ctx.stroke();
    ctx.setLineDash([]);
  }

  const bull = '#10b981', bear = '#f43f5e', fcBull = '#22d3ee', fcBear = '#a78bfa';

  function drawCandle(c, i, isFc) {
    const o = Number(c.o), h = Number(c.h), l = Number(c.l), cl = Number(c.c);
    if (![o, h, l, cl].every(Number.isFinite)) return;
    const x = pad.l + i * slot + slot / 2;
    const up = cl >= o;
    const col = isFc ? (up ? fcBull : fcBear) : (up ? bull : bear);
    ctx.globalAlpha = isFc ? (0.5 + 0.45 * (c.conf || 0.5)) : 1;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = isFc ? 1.6 : 1.25;
    ctx.beginPath();
    ctx.moveTo(x, yScale(h));
    ctx.lineTo(x, yScale(l));
    ctx.stroke();
    const y1 = yScale(Math.max(o, cl));
    const y2 = yScale(Math.min(o, cl));
    const bh = Math.max(1.5, y2 - y1);
    if (isFc) {
      ctx.globalAlpha = 0.28 + 0.4 * (c.conf || 0.5);
      ctx.fillRect(x - bodyW / 2, y1, bodyW, bh);
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(x - bodyW / 2, y1, bodyW, bh);
    } else {
      ctx.fillRect(x - bodyW / 2, y1, bodyW, bh);
    }
    ctx.globalAlpha = 1;
  }

  hist.forEach((c, i) => drawCandle(c, i, false));
  future.forEach((c, i) => drawCandle(c, hist.length + i, true));

  // volume bars
  if (showVolume) {
    const vols = hist.map(c => Number(c.v)).filter(v => Number.isFinite(v) && v > 0);
    const vmax = vols.length ? Math.max(...vols) : 1;
    const baseY = pad.t + H + 6;
    hist.forEach((c, i) => {
      const v = Number(c.v);
      if (!Number.isFinite(v) || v <= 0) return;
      const x = pad.l + i * slot + slot / 2;
      const vh = Math.max(2, (v / vmax) * (volH - 12));
      const up = Number(c.c) >= Number(c.o);
      ctx.fillStyle = up ? 'rgba(16,185,129,0.35)' : 'rgba(244,63,94,0.35)';
      ctx.fillRect(x - bodyW / 2, baseY + (volH - 12) - vh, bodyW, vh);
    });
  }

  // price labels
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-3').trim() || '#94a3b8';
  ctx.font = '11px Vazirmatn, sans-serif';
  ctx.textAlign = 'right';
  for (let g = 0; g < 5; g++) {
    const pr = hi - ((hi - lo) * g) / 4;
    const y = pad.t + (H * g) / 4;
    ctx.fillText(pr.toFixed(pr > 100 ? 1 : 2), pad.l - 6, y + 4);
  }

  // date labels
  if (showDates) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(148,163,184,0.85)';
    ctx.font = '10px Vazirmatn, sans-serif';
    const step = Math.max(1, Math.floor(all.length / 8));
    for (let i = 0; i < all.length; i += step) {
      const x = pad.l + i * slot + slot / 2;
      const label = formatChartDate(all[i], tf);
      ctx.fillText(label, x, cssH - 8);
    }
    // mark forecast labels
    future.forEach((c, i) => {
      const idx = hist.length + i;
      const x = pad.l + idx * slot + slot / 2;
      ctx.fillStyle = 'rgba(167,139,250,0.95)';
      ctx.fillText('P' + (i + 1), x, pad.t + H + (showVolume ? volH - 2 : 14));
    });
  }

  // target / stop
  if (result?.target != null && Number.isFinite(Number(result.target))) {
    const y = yScale(Number(result.target));
    ctx.strokeStyle = 'rgba(16,185,129,0.55)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(16,185,129,0.9)';
    ctx.textAlign = 'left';
    ctx.fillText('هدف', pad.l + 4, y - 4);
  }
  if (result?.stop != null && Number.isFinite(Number(result.stop))) {
    const y = yScale(Number(result.stop));
    ctx.strokeStyle = 'rgba(244,63,94,0.5)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(244,63,94,0.9)';
    ctx.textAlign = 'left';
    ctx.fillText('حد ضرر', pad.l + 4, y - 4);
  }

  // crosshair
  if (state.cross && state.showCrosshair) {
    const { x, y, idx } = state.cross;
    ctx.strokeStyle = 'rgba(148,163,184,0.45)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke();
    ctx.setLineDash([]);
    if (idx >= 0 && idx < all.length) {
      const c = all[idx];
      const price = lo + (1 - (y - pad.t) / H) * (hi - lo);
      state._hoverPrice = price;
      state._hoverIdx = idx;
    }
  }

  state.yScale = yScale;
  state.slot = slot;
  state.lo = lo;
  state.hi = hi;
  state.plotH = H;
}

function renderForecastChart(symbolId, result) {
  const canvas = $('forecastChart');
  const status = $('chartStatus');
  const scroll = $('chartScroll');
  if (!canvas || !canvas.getContext) return;

  const tf = currentTf || '1D';
  let hist = [];
  try {
    const series = buildAnalysisSeries(symbolId || currentSymbol, tf);
    hist = (series?.candles || []).filter(c =>
      [c.o, c.h, c.l, c.c].every(x => Number.isFinite(Number(x)) && Number(x) > 0)
    ).slice(-80);
  } catch (_) { hist = []; }

  if (hist.length < 3) {
    if (status) status.textContent = 'دادهٔ تاریخی کافی برای نمودار نیست — نماد و فایل data را بررسی کنید.';
    return;
  }

  const conf = Number.isFinite(result?.confidence) ? result.confidence : 0.5;
  const nFuture = !result ? 0 : (conf >= 0.65 ? 4 : conf >= 0.4 ? 3 : 2);
  const built = buildForecastCandles(hist, result, nFuture);
  const future = built.future || [];
  const all = hist.concat(future);

  const showDates = $('chartShowDates')?.checked !== false;
  const showVolume = $('chartShowVolume')?.checked !== false;
  const showCrosshair = $('chartShowCrosshair')?.checked !== false;

  const slotPx = 14;
  const pad = { t: 18, r: 18, b: showDates ? 32 : 22, l: 58 };
  const cssH = 380;
  const minW = (scroll?.clientWidth || 900);
  const cssW = Math.max(minW, all.length * slotPx + pad.l + pad.r);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  __chartState = {
    canvas, cssW, cssH, pad, hist, future, all, result, tf,
    showDates, showVolume, showCrosshair,
    splitIndex: hist.length, dpr, cross: null
  };

  const paint = (pulse = 0) => drawForecastChartFrame(__chartState, pulse);
  paint(0);

  if (status) {
    const sig = result?.signal || '—';
    status.textContent = `${symbolId || ''} / ${tf} · ${hist.length} واقعی · ${future.length} پیش‌بینی (${sig}) · اطمینان ${result?.confidence != null ? Math.round(result.confidence * 100) + '٪' : '—'} · اسکرول افقی برای دیدن همه کندل‌ها`;
  }

  // scroll to show last hist + forecast
  if (scroll) {
    requestAnimationFrame(() => {
      scroll.scrollLeft = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    });
  }

  // pulse animation — full redraw (fixes previous overlay bug)
  if (canvas._glowRaf) cancelAnimationFrame(canvas._glowRaf);
  if (future.length) {
    let t0 = performance.now();
    const animate = (now) => {
      const pulse = 0.5 + 0.5 * Math.sin((now - t0) / 450);
      paint(pulse);
      if (__chartState?.cross) paint(pulse);
      if (now - t0 < 5000) canvas._glowRaf = requestAnimationFrame(animate);
    };
    canvas._glowRaf = requestAnimationFrame(animate);
  }

  // crosshair + tooltip once
  if (!canvas._chartWired) {
    canvas._chartWired = true;
    const tip = $('chartTooltip');
    canvas.addEventListener('mousemove', (e) => {
      if (!__chartState || !$('chartShowCrosshair')?.checked) {
        if (tip) tip.hidden = true;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { pad, slot, all, hist, tf } = __chartState;
      const idx = Math.min(all.length - 1, Math.max(0, Math.floor((x - pad.l) / slot)));
      __chartState.cross = { x, y, idx };
      __chartState.showCrosshair = true;
      __chartState.showDates = $('chartShowDates')?.checked !== false;
      __chartState.showVolume = $('chartShowVolume')?.checked !== false;
      drawForecastChartFrame(__chartState, 0.3);
      if (tip && all[idx]) {
        const c = all[idx];
        const isFc = idx >= hist.length;
        tip.hidden = false;
        tip.style.left = Math.min(rect.width - 160, Math.max(8, x + 12)) + 'px';
        tip.style.top = Math.max(8, y - 10) + 'px';
        tip.innerHTML = `<strong>${isFc ? 'پیش‌بینی' : 'واقعی'}</strong><br>${formatChartDate(c, tf)}<br>
          O ${Number(c.o).toFixed(2)} · H ${Number(c.h).toFixed(2)}<br>
          L ${Number(c.l).toFixed(2)} · C ${Number(c.c).toFixed(2)}` +
          (c.v != null && Number.isFinite(Number(c.v)) ? `<br>Vol ${Number(c.v).toLocaleString('fa-IR')}` : '');
      }
    });
    canvas.addEventListener('mouseleave', () => {
      if (__chartState) { __chartState.cross = null; drawForecastChartFrame(__chartState, 0); }
      if (tip) tip.hidden = true;
    });
    ['chartShowDates', 'chartShowVolume', 'chartShowCrosshair'].forEach(id => {
      $(id)?.addEventListener('change', () => {
        if (window.__lastAnalysisResult) renderForecastChart(currentSymbol, window.__lastAnalysisResult);
        else if (currentSymbol) renderForecastChart(currentSymbol, null);
      });
    });
  }
}

// aliases for symbol change hooks
async function refreshFundVarSelect() { return refreshFundEditableList(); }
async function refreshFundStoredList() { return refreshFundSummaryOnly(); }
