/**
 * UI Controller V8.0.3
 * Fundamental is an optional input to Prediction (toggle), not a standalone view.
 */
import { getSymbol, formatPrice, getAllSymbols, registerCustomAsset } from './logic/symbols.js';
import {
  loadHistorical, loadManual, setHistorical, upsertManualPrices,
  buildAnalysisSeries, getAssetSummary, dayKeyOffset, dayKey,
  getCachedSymbols, dropSessionCache, TIMEFRAMES, getTfMeta, timeBucketKey,
  getDataDayIndex
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
  currentTf = $('tf').value || '1D';
  $('chipSym').textContent = meta.symbol;
  $('chipName').textContent = meta.nameFa;
  $('chipMeta').textContent = `${meta.typeFa} · ${meta.unitFa} · ${currentTf}`;
  if ($('assetChip')) $('assetChip').hidden = false;
  updateHeaderAssetLabel();
  refreshAssetPanel(id);
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
  // V8.0.2: pull from project data/ when local store is thin
  try {
    const { ensureProjectData } = await import('./logic/datasets.js');
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
  // client-side soft cache (same TTL idea as server)
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
          coverage: obj.coverage
        };
      }
    }
  } catch { /* ignore */ }

  const url = `${API_BASE}/api/fundamental?symbol=${encodeURIComponent(symbol)}`;
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  } catch (e) {
    return {
      ok: false,
      error: 'سرور فاندامنتال در دسترس نیست. Backend را با EODHD_API_TOKEN اجرا کنید.',
      code: 'NETWORK'
    };
  }
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body || body.ok === false) {
    return {
      ok: false,
      error: (body && body.error) || `خطای سرور فاندامنتال (${res.status})`,
      code: (body && body.code) || 'HTTP'
    };
  }
  if (!body.snapshot || typeof body.snapshot !== 'object') {
    return { ok: false, error: 'پاسخ فاندامنتال نامعتبر یا خالی است.', code: 'EMPTY' };
  }
  try {
    sessionStorage.setItem(FUND_CACHE_KEY, JSON.stringify({
      symbol,
      ts: Date.now(),
      fetchedAt: body.fetchedAt,
      snapshot: body.snapshot,
      coverage: body.coverage
    }));
  } catch { /* quota */ }
  return {
    ok: true,
    snapshot: body.snapshot,
    fetchedAt: body.fetchedAt,
    fromCache: Boolean(body._fromCache),
    coverage: body.coverage
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

    // Optional Fundamental (only when toggle ON — zero EODHD traffic when OFF)
    let fundSnap = null;
    let fundMeta = { used: false, mode: 'tech_only' };
    if (isFundToggleOn()) {
      setProcessing(true, 'در حال دریافت داده فاندامنتال…');
      setFundFetchStatus('در حال دریافت داده فاندامنتال…', 'is-loading');
      const fundRes = await fetchFundamentalSnapshot(sym);
      if (!fundRes.ok) {
        setProcessing(false);
        setFundFetchStatus(fundRes.error || 'خطای فاندامنتال', 'is-err');
        if (!silent) toast(fundRes.error || 'دریافت فاندامنتال ناموفق', 'err');
        // Stop prediction when Fundamental is explicitly requested but unavailable
        return;
      }
      fundSnap = fundRes.snapshot;
      fundMeta = {
        used: true,
        mode: 'with_fundamental',
        fromCache: fundRes.fromCache,
        fetchedAt: fundRes.fetchedAt,
        coverage: fundRes.coverage
      };
      setFundFetchStatus(
        fundRes.fromCache
          ? `فاندامنتال از Cache (${fundRes.fetchedAt ? new Date(fundRes.fetchedAt).toLocaleString('fa-IR') : '—'})`
          : `فاندامنتال دریافت شد · پوشش ${fundRes.coverage || '—'}`,
        'is-ok'
      );
      setProcessing(true, 'تحلیل ترکیبی…');
    }

    // Build multi-TF seriesMap from available historical data (no fabrication)
    const seriesMap = { [currentTf]: series.candles };
    try {
      const { loadHistorical, TIMEFRAMES } = await import('./logic/datasets.js');
      for (const tf of TIMEFRAMES) {
        if (tf.id === currentTf) continue;
        const hist = loadHistorical(sym, tf.id);
        if (hist && hist.length >= 20) seriesMap[tf.id] = hist;
      }
    } catch (_) { /* offline / missing */ }

    const { analyze } = await import('./logic/analysis.js');
    const result = analyze(series.candles, {
      currentPrice, symbol: sym, timeframe: currentTf, recordPrediction: true,
      fundamentalSnapshot: fundSnap,
      seriesMap
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

    // Entry
    html += '<div class="ens-section"><div class="ens-sec-title">نقطه ورود / Entry</div>';
    if (entry && (entry.entryType || entry.preferredEntry != null)) {
      const wait = entry.waitForEntry;
      html += `<div class="ens-grid">`;
      html += `<div class="ens-item"><span class="ens-label">نوع ورود</span><span class="ens-val">${entry.entryType || '—'}</span></div>`;
      html += `<div class="ens-item"><span class="ens-label">وضعیت</span><span class="ens-val ${wait ? 'bear' : 'bull'}">${wait ? 'Wait for Entry' : 'ورود معتبر'}</span></div>`;
      if (entry.preferredEntry != null) html += `<div class="ens-item"><span class="ens-label">ورود پیشنهادی</span><span class="ens-val mono">${entry.preferredEntry}</span></div>`;
      if (entry.entryZone) html += `<div class="ens-item"><span class="ens-label">ناحیه ورود</span><span class="ens-val mono">${entry.entryZone.low} – ${entry.entryZone.high}</span></div>`;
      if (entry.stop != null) html += `<div class="ens-item"><span class="ens-label">Stop</span><span class="ens-val mono">${entry.stop}</span></div>`;
      if (entry.target1 != null) html += `<div class="ens-item"><span class="ens-label">Target 1</span><span class="ens-val mono">${entry.target1}</span></div>`;
      if (entry.target2 != null) html += `<div class="ens-item"><span class="ens-label">Target 2</span><span class="ens-val mono">${entry.target2}</span></div>`;
      if (entry.rr != null) html += `<div class="ens-item"><span class="ens-label">R:R</span><span class="ens-val mono">${entry.rr}</span></div>`;
      if (entry.invalidation != null) html += `<div class="ens-item"><span class="ens-label">Invalidation</span><span class="ens-val mono">${entry.invalidation}</span></div>`;
      html += `</div>`;
      if (entry.reason) html += `<div class="ens-active">${entry.reason}</div>`;
      if (entry.confirmation?.length) html += `<div class="ens-active muted">تأیید: ${entry.confirmation.join(' · ')}</div>`;
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
      renderMPBPanel(window.__lastAnalysisResult || null);
      refreshMPBLibrary();
    }
    if (view === 'fundamental') {
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
  const skin = document.documentElement.getAttribute('data-skin') || 'terminal-glass';
  const lang = document.documentElement.getAttribute('lang') || 'fa';
  const dark = $('setThemeDark');
  const light = $('setThemeLight');
  if (dark) dark.checked = theme === 'dark';
  if (light) light.checked = theme === 'light';
  const fa = $('setLangFa');
  const en = $('setLangEn');
  if (fa) fa.checked = lang !== 'en';
  if (en) en.checked = lang === 'en';
  const tg = $('setSkinTg');
  if (tg) tg.checked = true;
  if ($('skinNameLabel')) $('skinNameLabel').textContent = 'Terminal Glass';
}

function applyLang(lang) {
  const l = lang === 'en' ? 'en' : 'fa';
  document.documentElement.setAttribute('lang', l);
  document.documentElement.setAttribute('dir', l === 'en' ? 'ltr' : 'rtl');
  try { localStorage.setItem('oma_lang', l); } catch (_) {}
}

function applySkin(skin) {
  const s = skin === 'vector-soft' ? 'vector-soft' : 'terminal-glass';
  document.documentElement.setAttribute('data-skin', s);
  // ensure theme+skin combo attributes stay in sync for CSS selectors
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('oma_skin', s); } catch (_) {}
  const names = { 'terminal-glass': 'Terminal Glass', 'vector-soft': 'Vector Soft' };
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
    ? 'تحلیل بنیادی فعال است. برای دریافت داده، Backend باید در حال اجرا باشد.'
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
  $('tf').addEventListener('change', () => {
    currentTf = $('tf').value;
    updateHeaderAssetLabel();
    updateSmartDateTimeUI();
    if (currentSymbol) refreshAssetPanel(currentSymbol);
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
