/**
 * Market Context Engine V7.0.1
 * Session, Asset/Economy mapping, Economic Event state, Data Quality.
 * No fake calendar data — Unknown when unavailable.
 */
import { CONFIG } from './config.js';
import { isNum } from './indicators.js';

/** Asset → relevant economies / currencies / macro factors (modular, asset-aware weights) */
export const ASSET_ECONOMY_MAP = Object.freeze({
  XAUUSD: Object.freeze({
    economies: ['US', 'Global'],
    currencies: ['USD'],
    factors: [
      { id: 'fed_funds', weight: 0.22, name: 'Federal Funds Rate' },
      { id: 'cpi', weight: 0.15, name: 'US Inflation / CPI' },
      { id: 'nfp', weight: 0.08, name: 'US Employment (NFP)' },
      { id: 'dxy', weight: 0.30, name: 'USD Index (DXY)' },
      { id: 'us10y', weight: 0.25, name: 'US 10Y Yield' },
      { id: 'risk_sentiment', weight: 0.12, name: 'Global Risk Sentiment' }
    ],
    primaryEconomy: 'US',
    notes: 'Gold is primarily USD/Fed/rates driven with global risk overlay'
  }),
  USDEUR: Object.freeze({
    economies: ['US', 'Eurozone'],
    currencies: ['USD', 'EUR'],
    factors: [
      { id: 'fed_funds', weight: 0.25, name: 'Federal Funds Rate' },
      { id: 'ecb_rate', weight: 0.22, name: 'ECB Policy Rate' },
      { id: 'cpi', weight: 0.12, name: 'US CPI' },
      { id: 'ez_cpi', weight: 0.12, name: 'Eurozone CPI' },
      { id: 'nfp', weight: 0.12, name: 'US NFP' },
      { id: 'dxy', weight: 0.17, name: 'DXY' }
    ],
    primaryEconomy: 'US',
    notes: 'USD/EUR rate differential and dual-region macro'
  }),
  BRENT: Object.freeze({
    economies: ['US', 'Europe', 'UK', 'Global'],
    currencies: ['USD'],
    factors: [
      { id: 'dxy', weight: 0.22, name: 'USD Index' },
      { id: 'nfp', weight: 0.12, name: 'US Demand Proxy (NFP)' },
      { id: 'fed_funds', weight: 0.15, name: 'US Rates' },
      { id: 'supply', weight: 0.25, name: 'Global Supply / Inventories' },
      { id: 'geo_risk', weight: 0.15, name: 'Geopolitical / Energy Risk' },
      { id: 'cpi', weight: 0.11, name: 'Inflation / Demand' }
    ],
    primaryEconomy: 'Global',
    notes: 'Oil: supply/demand + USD + energy-specific events'
  }),
  DEFAULT: Object.freeze({
    economies: ['US'],
    currencies: ['USD'],
    factors: [
      { id: 'dxy', weight: 0.3, name: 'DXY' },
      { id: 'fed_funds', weight: 0.25, name: 'Fed Funds' },
      { id: 'cpi', weight: 0.2, name: 'CPI' },
      { id: 'nfp', weight: 0.15, name: 'NFP' },
      { id: 'us10y', weight: 0.1, name: 'US10Y' }
    ],
    primaryEconomy: 'US',
    notes: 'Default USD-centric mapping'
  })
});

export function getAssetEconomy(symbol) {
  const key = String(symbol || '').toUpperCase();
  return ASSET_ECONOMY_MAP[key] || ASSET_ECONOMY_MAP.DEFAULT;
}

/**
 * Session detection from timestamp (UTC-based windows).
 * Windows are approximate FX session hours in UTC (no hard performance claims).
 * Returns session id + phase; reliability of strategies per session comes from backtest data only.
 */
export function detectSession(tsOrDate) {
  const d = tsOrDate instanceof Date ? tsOrDate : new Date(tsOrDate);
  if (!Number.isFinite(d.getTime())) {
    return {
      session: 'Unknown',
      phase: 'unknown',
      hourUtc: null,
      overlaps: [],
      liquidity: 'unknown',
      timezone: 'UTC'
    };
  }
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;

  // Approximate UTC session windows (standard FX convention)
  const asia = hour >= 0 && hour < 9;
  const london = hour >= 7 && hour < 16;
  const ny = hour >= 12 && hour < 21;

  let session = 'Off-hours';
  const overlaps = [];
  if (asia && !london) session = 'Asia';
  if (london && !ny) session = 'London';
  if (ny && !london) session = 'New York';
  if (london && ny) {
    session = 'London-New York Overlap';
    overlaps.push('London', 'New York');
  }
  if (asia && london) overlaps.push('Asia', 'London');
  if (!asia && !london && !ny) session = 'Off-hours';

  // Phase within session
  let phase = 'mid';
  if (session === 'Asia') phase = hour < 3 ? 'open' : hour > 7 ? 'close' : 'mid';
  else if (session === 'London') phase = hour < 9 ? 'open' : hour > 14 ? 'close' : 'mid';
  else if (session === 'New York') phase = hour < 14 ? 'open' : hour > 19 ? 'close' : 'mid';
  else if (session === 'London-New York Overlap') phase = 'overlap';

  // Liquidity context (descriptive only — not a performance claim)
  let liquidity = 'normal';
  if (session === 'London-New York Overlap') liquidity = 'high';
  else if (session === 'Off-hours') liquidity = 'low';
  else if (session === 'Asia') liquidity = 'moderate';

  return {
    session,
    phase,
    hourUtc: Math.round(hour * 100) / 100,
    overlaps,
    liquidity,
    timezone: 'UTC',
    iso: d.toISOString()
  };
}

/**
 * Event state from calendar items available at asOfTs.
 * events: [{ id, country, currency, importance, scheduledTs, actual, forecast, previous, affectedAssets }]
 * No synthetic events.
 */
export function computeEventContext(events, asOfTs, symbol) {
  const empty = {
    state: 'UNKNOWN',
    eventRisk: 0.3,
    nextEvent: null,
    timeToEventMs: null,
    timeToEventHours: null,
    recentSurprise: null,
    activeEvents: [],
    dataAvailable: false,
    message: 'داده تقویم اقتصادی در دسترس نیست'
  };

  if (!events || !Array.isArray(events) || events.length === 0) {
    return empty;
  }

  const now = Number.isFinite(asOfTs) ? asOfTs : Date.now();
  const sym = String(symbol || '').toUpperCase();
  const economy = getAssetEconomy(sym);
  const relevantCurrencies = new Set(economy.currencies || []);

  // Filter to asset-relevant events with valid scheduled time <= or near now
  const relevant = events.filter(e => {
    if (!e || e.scheduledTs == null) return false;
    if (e.affectedAssets && Array.isArray(e.affectedAssets)) {
      if (!e.affectedAssets.map(a => String(a).toUpperCase()).includes(sym)) {
        // still allow if currency matches
        if (e.currency && !relevantCurrencies.has(String(e.currency).toUpperCase())) return false;
      }
    } else if (e.currency && !relevantCurrencies.has(String(e.currency).toUpperCase())) {
      return false;
    }
    return true;
  });

  if (!relevant.length) {
    return { ...empty, dataAvailable: true, message: 'رویداد مرتبط با این دارایی یافت نشد', state: 'NORMAL', eventRisk: 0.2 };
  }

  // Sort by scheduled time
  relevant.sort((a, b) => a.scheduledTs - b.scheduledTs);

  const PRE_MS = 4 * 3600 * 1000;      // 4h pre window (configurable conceptually)
  const IMMINENT_MS = 45 * 60 * 1000;  // 45m
  const REACTION_MS = 90 * 60 * 1000;  // 90m post
  const POST_MS = 6 * 3600 * 1000;     // 6h post

  let state = 'NORMAL';
  let eventRisk = 0.2;
  let nextEvent = null;
  let timeToEventMs = null;
  let recentSurprise = null;
  const activeEvents = [];

  for (const e of relevant) {
    const dt = e.scheduledTs - now;
    const importance = e.importance === 'high' ? 1 : e.importance === 'medium' ? 0.55 : 0.25;

    if (dt > 0 && dt <= PRE_MS) {
      activeEvents.push({ ...e, relative: 'upcoming', dt });
      if (!nextEvent || e.scheduledTs < nextEvent.scheduledTs) nextEvent = e;
      if (dt <= IMMINENT_MS) {
        state = 'IMMINENT_EVENT';
        eventRisk = Math.max(eventRisk, 0.55 + importance * 0.35);
      } else if (state !== 'IMMINENT_EVENT') {
        state = 'PRE_EVENT';
        eventRisk = Math.max(eventRisk, 0.35 + importance * 0.25);
      }
    } else if (dt <= 0 && dt > -REACTION_MS) {
      activeEvents.push({ ...e, relative: 'reaction', dt });
      state = 'EVENT_REACTION';
      eventRisk = Math.max(eventRisk, 0.6 + importance * 0.3);
      // Surprise if actual+forecast
      if (isNum(e.actual) && isNum(e.forecast)) {
        const surprise = e.actual - e.forecast;
        recentSurprise = {
          eventId: e.id,
          surprise,
          importance,
          currency: e.currency,
          // asset-aware sign handled by fundamental engine; here we only expose magnitude
          magnitude: Math.abs(surprise)
        };
        eventRisk = Math.min(1, eventRisk + Math.min(0.2, Math.abs(surprise) * 0.02));
      }
    } else if (dt <= -REACTION_MS && dt > -POST_MS) {
      if (state === 'NORMAL') state = 'POST_EVENT';
      eventRisk = Math.max(eventRisk, 0.3 + importance * 0.15);
      activeEvents.push({ ...e, relative: 'post', dt });
    } else if (dt > PRE_MS) {
      if (!nextEvent || e.scheduledTs < nextEvent.scheduledTs) nextEvent = e;
    }
  }

  if (nextEvent) {
    timeToEventMs = nextEvent.scheduledTs - now;
  }

  return {
    state,
    eventRisk: Math.round(Math.min(1, eventRisk) * 1000) / 1000,
    nextEvent: nextEvent ? {
      id: nextEvent.id,
      name: nextEvent.name || nextEvent.id,
      country: nextEvent.country,
      currency: nextEvent.currency,
      importance: nextEvent.importance,
      scheduledTs: nextEvent.scheduledTs,
      scheduledIso: new Date(nextEvent.scheduledTs).toISOString()
    } : null,
    timeToEventMs,
    timeToEventHours: timeToEventMs != null ? Math.round((timeToEventMs / 3600000) * 100) / 100 : null,
    recentSurprise,
    activeEvents: activeEvents.slice(0, 5),
    dataAvailable: true,
    message: state === 'NORMAL' ? 'بدون رویداد مهم نزدیک' : `وضعیت رویداد: ${state}`
  };
}

/**
 * Aggregate data quality score 0–1 from available inputs.
 */
export function computeDataQuality(opts = {}) {
  let score = 0;
  let max = 0;
  const notes = [];

  const add = (w, ok, note) => {
    max += w;
    if (ok) score += w;
    else if (note) notes.push(note);
  };

  add(0.25, opts.candleCount >= (CONFIG.minCandles || 30), `عمق تاریخچه کم (${opts.candleCount || 0})`);
  add(0.15, opts.hasOHLC === true, 'OHLC ناقص');
  add(0.1, opts.hasVolume === true, 'Volume موجود نیست');
  add(0.1, opts.hasTimestamp === true, 'Timestamp نامعتبر/ناقص');
  add(0.15, opts.hasFundamental === true, 'داده فاندامنتال موجود نیست');
  add(0.1, opts.hasCalendar === true, 'تقویم اقتصادی موجود نیست');
  add(0.1, opts.tfIntegrity !== false, 'یکپارچگی تایم‌فریم مشکوک');
  add(0.05, opts.sampleSizeOk !== false, 'نمونه آماری ناکافی');

  const q = max > 0 ? score / max : 0.3;
  return {
    score: Math.round(q * 1000) / 1000,
    notes,
    level: q >= 0.75 ? 'high' : q >= 0.5 ? 'medium' : 'low'
  };
}

/**
 * Full context snapshot for a prediction point.
 */
export function buildMarketContext(options = {}) {
  const {
    symbol,
    asOfTs = Date.now(),
    candles = [],
    fundamentalOk = false,
    calendarEvents = null,
    volumeAvailable = false,
    timeframe = '1D'
  } = options;

  const economy = getAssetEconomy(symbol);
  const session = detectSession(asOfTs);
  const eventCtx = computeEventContext(calendarEvents, asOfTs, symbol);

  const last = candles && candles.length ? candles[candles.length - 1] : null;
  const hasOHLC = last && [last.o, last.h, last.l, last.c].every(isNum);
  const hasTs = last && (last.ts != null || last.date);

  const dq = computeDataQuality({
    candleCount: candles?.length || 0,
    hasOHLC,
    hasVolume: volumeAvailable,
    hasTimestamp: !!hasTs,
    hasFundamental: fundamentalOk,
    hasCalendar: eventCtx.dataAvailable && eventCtx.state !== 'UNKNOWN',
    tfIntegrity: true,
    sampleSizeOk: (candles?.length || 0) >= 40
  });

  return {
    symbol: String(symbol || '').toUpperCase(),
    asOfTs,
    asOfIso: new Date(asOfTs).toISOString(),
    timeframe,
    economy,
    session,
    event: eventCtx,
    dataQuality: dq,
    relevantEconomies: economy.economies,
    relevantCurrencies: economy.currencies,
    primaryEconomy: economy.primaryEconomy
  };
}
