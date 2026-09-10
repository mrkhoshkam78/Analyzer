/**
 * Web Worker – parse + analyze off main thread.
 */
import { parseOHLCV, analyze } from './analysis.js';

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || msg.type !== 'analyze') return;

  try {
    const { candles, error } = parseOHLCV(msg.text || '');
    if (error || !candles.length) {
      self.postMessage({ type: 'error', message: error || 'کندل معتبری یافت نشد.' });
      return;
    }
    const result = analyze(candles, {
      currentPrice: msg.currentPrice,
      symbol: msg.symbol,
      timeframe: msg.timeframe,
      fundamentalSnapshot: msg.fundamentalSnapshot || null,
      horizonBars: msg.horizonBars,
      recordPrediction: msg.recordPrediction !== false
    });
    self.postMessage({ type: 'result', result });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err && err.message ? err.message : 'خطا در اجرای تحلیل.'
    });
  }
};
