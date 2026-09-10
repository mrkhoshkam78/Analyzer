/**
 * Web Worker – parse + analyze off main thread.
 * Receives: { type: 'analyze', text, currentPrice? }
 * Posts: { type: 'result', result } | { type: 'error', message }
 */

import { parseOHLCV, analyze } from './analysis.js';

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || msg.type !== 'analyze') return;

  try {
    const { candles, error } = parseOHLCV(msg.text || '');
    if (error || !candles.length) {
      self.postMessage({
        type: 'error',
        message: error || 'کندل معتبری یافت نشد.'
      });
      return;
    }
    const result = analyze(candles, {
      currentPrice: msg.currentPrice
    });
    self.postMessage({ type: 'result', result });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err && err.message ? err.message : 'خطا در اجرای تحلیل.'
    });
  }
};
