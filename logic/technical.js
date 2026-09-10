/**
 * Technical Analysis Engine — scores 0–100 from indicators only
 */
import { CONFIG } from './config.js';
import {
  ema, rsi, macd, atr, momentum, roc, bollinger, stochastic, adx,
  supportResistance, volumeAnalysis, detectBreakout, maxDrawdown,
  volatilityPct, isNum, last
} from './indicators.js';

/**
 * @returns technical result with score, factors, raw indicators
 */
export function runTechnical(candles, options = {}) {
  if (!candles || candles.length < CONFIG.minCandles) {
    return {
      ok: false,
      error: `حداقل ${CONFIG.minCandles} کندل برای تحلیل تکنیکال لازم است.`,
      score: null,
      factors: []
    };
  }

  const closes = candles.map(c => c.c);
  const price = isNum(options.currentPrice) && options.currentPrice > 0
    ? options.currentPrice
    : last(closes);

  const e20 = ema(closes, CONFIG.smaFast);
  const e50 = ema(closes, CONFIG.smaSlow);
  const r = rsi(closes);
  const m = macd(closes);
  const a = atr(candles);
  const mom = momentum(closes);
  const rocVal = roc(closes);
  const bb = bollinger(closes);
  const stoch = stochastic(candles);
  const adxRes = adx(candles);
  const { support, resistance } = supportResistance(candles);
  const volA = volumeAnalysis(candles);
  const brk = detectBreakout(candles);
  const dd = maxDrawdown(closes);
  const volPct = volatilityPct(candles);

  const factors = [];
  let trendScore = 50;
  let momScore = 50;
  let rsiScore = 50;
  let macdScore = 50;
  let volScore = 50;
  let structScore = 50;
  let volumeScore = 50;

  // Trend
  let trendLabel = 'Neutral';
  if (e20 != null && e50 != null) {
    if (price > e20 && price > e50 && e20 > e50) {
      trendScore = 78; trendLabel = 'Strong Bullish';
      factors.push({ key: 'trend', dir: 'bull', text: 'قیمت بالاتر از EMA20 و EMA50 با ساختار صعودی' });
    } else if (price < e20 && price < e50 && e20 < e50) {
      trendScore = 22; trendLabel = 'Strong Bearish';
      factors.push({ key: 'trend', dir: 'bear', text: 'قیمت پایین‌تر از EMA20 و EMA50 با ساختار نزولی' });
    } else if (price > e50) {
      trendScore = 65; trendLabel = 'Bullish';
      factors.push({ key: 'trend', dir: 'bull', text: 'قیمت بالاتر از EMA50' });
    } else if (price < e50) {
      trendScore = 35; trendLabel = 'Bearish';
      factors.push({ key: 'trend', dir: 'bear', text: 'قیمت پایین‌تر از EMA50' });
    }
  }
  if (adxRes.adx != null) {
    if (adxRes.adx >= 25) {
      factors.push({ key: 'adx', dir: adxRes.plusDI > adxRes.minusDI ? 'bull' : 'bear', text: `قدرت روند ADX=${adxRes.adx.toFixed(1)}` });
      if (adxRes.plusDI > adxRes.minusDI) trendScore = Math.min(100, trendScore + 6);
      else trendScore = Math.max(0, trendScore - 6);
    } else {
      factors.push({ key: 'adx', dir: 'neutral', text: 'روند ضعیف یا خنثی (ADX پایین)' });
    }
  }

  // RSI
  if (r != null) {
    if (r < 30) { rsiScore = 78; factors.push({ key: 'rsi', dir: 'bull', text: 'RSI در ناحیه اشباع فروش' }); }
    else if (r > 70) { rsiScore = 22; factors.push({ key: 'rsi', dir: 'bear', text: 'RSI در ناحیه اشباع خرید' }); }
    else if (r < 45) rsiScore = 58;
    else if (r > 55) rsiScore = 42;
  }

  // MACD
  if (m.macd != null) {
    if (m.macd > 0 && (m.hist == null || m.hist >= 0)) {
      macdScore = 70; factors.push({ key: 'macd', dir: 'bull', text: 'MACD مثبت' });
    } else if (m.macd < 0) {
      macdScore = 30; factors.push({ key: 'macd', dir: 'bear', text: 'MACD منفی' });
    }
  }

  // Momentum / ROC
  if (mom != null) {
    if (mom > 2) { momScore = 68; factors.push({ key: 'momentum', dir: 'bull', text: 'مومنتوم مثبت' }); }
    else if (mom < -2) { momScore = 32; factors.push({ key: 'momentum', dir: 'bear', text: 'مومنتوم منفی' }); }
  }

  // Bollinger
  if (bb.pctB != null) {
    if (bb.pctB < 0.1) { factors.push({ key: 'bb', dir: 'bull', text: 'قیمت نزدیک باند پایین بولینگر' }); momScore = Math.min(100, momScore + 5); }
    else if (bb.pctB > 0.9) { factors.push({ key: 'bb', dir: 'bear', text: 'قیمت نزدیک باند بالای بولینگر' }); momScore = Math.max(0, momScore - 5); }
  }

  // Stochastic
  if (stoch.k != null) {
    if (stoch.k < 20) { factors.push({ key: 'stoch', dir: 'bull', text: 'استوکاستیک در ناحیه اشباع فروش' }); rsiScore = Math.min(100, rsiScore + 4); }
    else if (stoch.k > 80) { factors.push({ key: 'stoch', dir: 'bear', text: 'استوکاستیک در ناحیه اشباع خرید' }); rsiScore = Math.max(0, rsiScore - 4); }
  }

  // Structure S/R + breakout
  if (support != null && price > 0) {
    const distSup = (price - support) / price;
    if (distSup < 0.04) { structScore += 12; factors.push({ key: 'support', dir: 'bull', text: 'نزدیک حمایت' }); }
  }
  if (resistance != null && price > 0) {
    const distRes = (resistance - price) / price;
    if (distRes < 0.02) { structScore -= 12; factors.push({ key: 'resistance', dir: 'bear', text: 'نزدیک مقاومت' }); }
  }
  if (brk.up) { structScore += 15; factors.push({ key: 'breakout', dir: 'bull', text: 'شکست صعودی' }); }
  if (brk.down) { structScore -= 15; factors.push({ key: 'breakout', dir: 'bear', text: 'شکست نزولی' }); }
  structScore = Math.max(0, Math.min(100, structScore));

  // Volatility → risk preference (high vol lowers score neutrality toward caution)
  if (volPct != null) {
    if (volPct > CONFIG.highVolPct) {
      volScore = 35; factors.push({ key: 'volatility', dir: 'bear', text: 'نوسان بالا' });
    } else if (volPct < CONFIG.lowVolPct) {
      volScore = 58; factors.push({ key: 'volatility', dir: 'neutral', text: 'نوسان پایین' });
    }
  }

  // Volume
  if (volA.available) {
    if (volA.spike) { volumeScore = 68; factors.push({ key: 'volume', dir: 'bull', text: 'حجم بالاتر از میانگین' }); }
    else if (volA.weak) { volumeScore = 40; factors.push({ key: 'volume', dir: 'bear', text: 'حجم ضعیف' }); }
  }

  const W = CONFIG.techWeights;
  const score =
    (trendScore * W.trend +
      momScore * W.momentum +
      rsiScore * W.rsi +
      macdScore * W.macd +
      volScore * W.volatility +
      structScore * W.structure +
      volumeScore * W.volume) /
    (W.trend + W.momentum + W.rsi + W.macd + W.volatility + W.structure + W.volume);

  const technicalScore = Math.round(Math.max(0, Math.min(100, score)));

  let overbought = r != null && r > 70;
  let oversold = r != null && r < 30;
  if (stoch.k != null) {
    if (stoch.k > 80) overbought = true;
    if (stoch.k < 20) oversold = true;
  }

  return {
    ok: true,
    score: technicalScore,
    trend: trendLabel,
    trendScore,
    factors,
    overbought,
    oversold,
    indicators: {
      price,
      ema20: e20,
      ema50: e50,
      rsi: r,
      macd: m.macd,
      macdSignal: m.signal,
      macdHist: m.hist,
      atr: a,
      atrPct: volPct,
      momentum: mom,
      roc: rocVal,
      bollinger: bb,
      stochastic: stoch,
      adx: adxRes,
      support,
      resistance,
      volume: volA,
      breakout: brk,
      drawdown: dd
    }
  };
}
