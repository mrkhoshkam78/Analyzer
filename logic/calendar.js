/**
 * Economic Calendar store V7.0.1
 * Manual / imported events only — never fabricates events.
 */
import { loadJSON, saveJSON } from './storage.js';

const CAL_STORE = 'economic_calendar';

export function loadCalendar() {
  return loadJSON(CAL_STORE, []) || [];
}

export function saveCalendar(events) {
  return saveJSON(CAL_STORE, Array.isArray(events) ? events : []);
}

/**
 * Upsert events. Each: { id, name, country, currency, importance, scheduledTs|scheduledIso, actual, forecast, previous, affectedAssets }
 */
export function upsertCalendarEvents(events) {
  const list = loadCalendar().slice();
  const byId = new Map(list.map(e => [e.id, e]));
  let n = 0;
  for (const e of events || []) {
    if (!e || !e.id) continue;
    let scheduledTs = e.scheduledTs;
    if (scheduledTs == null && e.scheduledIso) {
      scheduledTs = Date.parse(e.scheduledIso);
    }
    if (!Number.isFinite(scheduledTs)) continue;
    byId.set(e.id, {
      id: String(e.id),
      name: e.name || e.id,
      country: e.country || null,
      currency: e.currency || null,
      importance: e.importance || 'medium', // high|medium|low
      scheduledTs,
      scheduledIso: new Date(scheduledTs).toISOString(),
      actual: e.actual != null && Number.isFinite(Number(e.actual)) ? Number(e.actual) : null,
      forecast: e.forecast != null && Number.isFinite(Number(e.forecast)) ? Number(e.forecast) : null,
      previous: e.previous != null && Number.isFinite(Number(e.previous)) ? Number(e.previous) : null,
      affectedAssets: Array.isArray(e.affectedAssets) ? e.affectedAssets.map(a => String(a).toUpperCase()) : [],
      updatedAt: Date.now()
    });
    n++;
  }
  const out = Array.from(byId.values()).sort((a, b) => a.scheduledTs - b.scheduledTs);
  saveCalendar(out);
  return { ok: true, count: n, total: out.length };
}

export function clearCalendar() {
  saveCalendar([]);
  return { ok: true };
}

/** Events with scheduledTs <= asOfTs OR within future window (for next-event) — caller filters relevance */
export function getCalendarAsOf(asOfTs, futureWindowMs = 7 * 86400000) {
  const list = loadCalendar();
  if (!Number.isFinite(asOfTs)) return list.slice();
  return list.filter(e => e.scheduledTs <= asOfTs + futureWindowMs);
}
