/**
 * کنترلر UI — تحلیل‌گر بازار آفلاین
 * بدون API آنلاین نماد. منطق تحلیل در logic/
 */

import { getSymbol, formatPrice, SYMBOL_LIST } from './logic/symbols.js';

const $ = (id) => document.getElementById(id);

let worker = null;

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

// ---------- ساعت زنده ----------
function pad(n) {
  return String(n).padStart(2, '0');
}

function formatNow() {
  const d = new Date();
  const date = d.toLocaleDateString('fa-IR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  });
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return { date, time, full: `${date} — ${time}` };
}

function tickClock() {
  const { date, time, full } = formatNow();
  const cd = $('clockDate');
  const ct = $('clockTime');
  if (cd) cd.textContent = date;
  if (ct) ct.textContent = time;
  const rc = $('resultClock');
  if (rc && $('result').classList.contains('show')) {
    rc.textContent = full;
  }
}

// ---------- نماد آفلاین ----------
function onSymbolChange() {
  const id = $('symbol').value;
  const meta = getSymbol(id);
  if (!meta) {
    $('assetChip').classList.remove('show');
    return;
  }
  $('chipSym').textContent = meta.symbol;
  $('chipName').textContent = meta.nameFa;
  $('chipMeta').textContent = `${meta.typeFa} · ${meta.unitFa}`;
  $('assetChip').classList.add('show');
}

// ---------- فایل ----------
function setProcessing(on, msg = 'در حال پردازش داده بازار…') {
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

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('خواندن فایل ناموفق بود.'));
    r.readAsText(file);
  });
}

function showFileInfo(name, sizeKb) {
  $('fileNameText').textContent = name;
  $('fileMeta').textContent = sizeKb != null ? `${Number(sizeKb).toLocaleString('fa-IR')} کیلوبایت` : '';
  $('fileName').classList.add('show');
}

function hideFileInfo() {
  $('fileName').classList.remove('show');
  $('fileNameText').textContent = 'فایلی انتخاب نشده';
  $('fileMeta').textContent = '';
}

// ---------- تحلیل ----------
async function runAnalysis() {
  const sym = $('symbol').value;
  if (!sym || !getSymbol(sym)) {
    alert('لطفاً یکی از سه نماد مجاز (XAUUSD، USDEUR یا BRENT) را انتخاب کنید.');
    return;
  }
  const text = ($('data').value || '').trim();
  if (!text) {
    alert('لطفاً فایل CSV را بارگذاری کنید یا داده OHLCV را بچسبانید.');
    return;
  }

  setProcessing(true, 'در حال پردازش داده بازار…');
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
        alert(e.data.message || 'تحلیل انجام نشد. فایل را از نظر ستون‌های OHLC و حداقل ۳۰ کندل بررسی کنید.');
        return;
      }
      showResult(e.data.result, sym);
    };
    w.addEventListener('message', onMsg);
    w.postMessage(payload);
  } else {
    try {
      const { parseOHLCV, analyze } = await import('./logic/analysis.js');
      await new Promise(r => setTimeout(r, 0));
      const { candles, error } = parseOHLCV(text);
      if (error || !candles.length) {
        setProcessing(false);
        alert(error || 'کندل معتبری یافت نشد.');
        return;
      }
      await new Promise(r => setTimeout(r, 0));
      const result = analyze(candles, { currentPrice: payload.currentPrice });
      setProcessing(false);
      showResult(result, sym);
    } catch (err) {
      setProcessing(false);
      alert(err.message || 'خطا در تحلیل. لطفاً دوباره تلاش کنید.');
    }
  }
}

const SIGNAL_FA = { BUY: 'خرید', HOLD: 'نگهداری', SELL: 'فروش' };
const TREND_FA = {
  'Strong Bullish': 'قوی صعودی',
  Bullish: 'صعودی',
  Neutral: 'خنثی',
  Bearish: 'نزولی',
  'Strong Bearish': 'قوی نزولی'
};
const RISK_FA = { High: 'بالا', Medium: 'متوسط', Low: 'پایین' };

const SIGNAL_ICONS = {
  BUY: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
  SELL: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`,
  HOLD: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12h8"/></svg>`
};

function showResult(r, symbolId) {
  if (!r || !r.ok) {
    alert(r?.error || 'تحلیل ناموفق بود. حداقل ۳۰ کندل معتبر OHLC لازم است.');
    return;
  }

  const sig = r.signal;
  const panel = $('signalPanel');
  panel.className = 'signal-panel ' + sig;

  const signalEl = $('signal');
  signalEl.className = 'signal ' + sig;
  $('signalText').textContent = SIGNAL_FA[sig] || sig;
  $('signalIcon').innerHTML = SIGNAL_ICONS[sig] || SIGNAL_ICONS.HOLD;

  const meta = getSymbol(symbolId);
  const symLabel = meta ? meta.symbol : symbolId || 'دارایی';
  const tf = $('tf').value;
  $('scoreContext').textContent = `${symLabel} · ${tf}`;
  $('score').textContent = `امتیاز ${r.score.toLocaleString('fa-IR')} از ۱۰۰`;
  $('bar').style.width = r.score + '%';
  const barWrap = $('scoreBar');
  if (barWrap) barWrap.setAttribute('aria-valuenow', String(r.score));

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

  $('report').textContent = r.report || '';
  $('suggestionText').textContent = r.suggestion || 'شرایط برای پیشنهاد مشخص کافی نیست.';

  const { full } = formatNow();
  $('resultClock').textContent = full;

  $('result').classList.add('show');
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearAll() {
  $('symbol').value = '';
  $('current').value = '';
  $('data').value = '';
  $('assetChip').classList.remove('show');
  hideFileInfo();
  $('result').classList.remove('show');
  const csv = $('csv');
  if (csv) csv.value = '';
  $('pasteArea').classList.remove('show');
  $('pasteToggle').setAttribute('aria-expanded', 'false');
}

// ---------- تم ----------
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
  $('themeBtn').addEventListener('click', () => {
    applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });

  // ساعت — هر ۱ ثانیه، سبک
  tickClock();
  setInterval(tickClock, 1000);

  $('symbol').addEventListener('change', onSymbolChange);

  $('pasteToggle').addEventListener('click', () => {
    const area = $('pasteArea');
    const open = area.classList.toggle('show');
    $('pasteToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  });

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
    setProcessing(true, 'در حال خواندن فایل…');
    try {
      const text = await readFileAsText(file);
      $('data').value = text;
      setProcessing(false);
    } catch (err) {
      setProcessing(false);
      alert(err.message || 'خواندن فایل ممکن نشد.');
    }
  }

  $('analyzeBtn').addEventListener('click', runAnalysis);
  $('clearBtn').addEventListener('click', clearAll);

  // اطمینان: فقط سه نماد در لیست
  const sel = $('symbol');
  if (sel) {
    const allowed = new Set(SYMBOL_LIST);
    [...sel.options].forEach(opt => {
      if (opt.value && !allowed.has(opt.value)) opt.remove();
    });
  }
}

init();
