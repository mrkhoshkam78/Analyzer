/**
 * Module Web Worker – parse CSV + run full analysis off the main thread.
 * Receives: { type: 'analyze', text: string, currentPrice?: number }
 * Posts:    { type: 'result', result: object } | { type: 'error', message: string }
 */

import { parseOHLCV, analyze } from './analysis.js';

self.onmessage = function (e) {
  const msg = e.data;
  if (!msg || msg.type !== 'analyze') return;

  try {
    const { candles, error } = parseOHLCV(msg.text || '');
    if (error || !candles.length) {
      self.postMessage({ type: 'error', message: error || 'No valid candles' });
      return;
    }
    const result = analyze(candles, {
      currentPrice: msg.currentPrice
    });
    // Never send the full candle array back – keep transfer minimal
    self.postMessage({ type: 'result', result });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err && err.message ? err.message : 'Analysis failed'
    });
  }
};
