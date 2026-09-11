/**
 * Technical Analysis Engine — scores 0–100 from indicators only
 * Adaptive MACD + Fibonacci integrated into scoring.
 */
import { CONFIG } from './config.js';
import { getMacdConfig, getFibConfig } from './indicatorConfig.js';
import {
  ema, rsi, macd, atr, momentum, roc, bollinger, stochastic, adx,
  supportResistance, volumeAnalysis, detectBreakout, maxDrawdown,
  volatilityPct, fibonacciLevels, isNum, last
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

  const symbol = options.symbol || null;
  const timeframe = options.timeframe || '1D';
  const macdCfg = getMacdConfig(symbol, timeframe);
  const fibCfg = getFibConfig(symbol, timeframe);

  const closes = candles.map(c => c.c);
  const price = isNum(options.currentPrice) && options.currentPrice > 0
    ? options.currentPrice
    : last(closes);

  const e20 = ema(closes, CONFIG.smaFast);
  const e50 = ema(closes, CONFIG.smaSlow);
  const r = rsi(closes);
  const m = macd(closes, macdCfg);
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
  const fib = fibonacciLevels(candles, {
    lookback: fibCfg.lookback,
    nearPct: fibCfg.nearPct,
    price
  });

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
      factors.push({ key: 'trend', dir: 'bull', text: 'روند: صعودی قوی 🔺' });
    } else if (price < e20 && price < e50 && e20 < e50) {
      trendScore = 22; trendLabel = 'Strong Bearish';
      factors.push({ key: 'trend', dir: 'bear', text: 'روند: نزولی قوی 🔻' });
    } else if (price > e50) {
      trendScore = 65; trendLabel = 'Bullish';
      factors.push({ key: 'trend', dir: 'bull', text: 'روند: صعودی' });
    } else if (price < e50) {
      trendScore = 35; trendLabel = 'Bearish';
      factors.push({ key: 'trend', dir: 'bear', text: 'روند: نزولی' });
    }
  }
  if (adxRes.adx != null) {
    if (adxRes.adx >= 25) {
      factors.push({ key: 'adx', dir: adxRes.plusDI > adxRes.minusDI ? 'bull' : 'bear', text: `قدرت روند ADX=${adxRes.adx.toFixed(1)}` });
      if (adxRes.plusDI > adxRes.minusDI) trendScore = Math.min(100, trendScore + 6);
      else trendScore = Math.max(0, trendScore - 6);
    } else {
      factors.push({ key: 'adx', dir: 'neutral', text: 'روند: خنثی / ضعیف' });
    }
  }

  // RSI
  if (r != null) {
    if (r < 30) { rsiScore = 78; factors.push({ key: 'rsi', dir: 'bull', text: 'RSI: اشباع فروش' }); }
    else if (r > 70) { rsiScore = 22; factors.push({ key: 'rsi', dir: 'bear', text: 'RSI: اشباع خرید' }); }
    else if (r < 45) rsiScore = 58;
    else if (r > 55) rsiScore = 42;
  }

  // Adaptive MACD — crossover + histogram momentum
  if (m.macd != null && !m.insufficient) {
    if (m.crossover === 'bullish') {
      macdScore = 78;
      factors.push({ key: 'macd', dir: 'bull', text: `تقاطع صعودی MACD (${macdCfg.fast}/${macdCfg.slow}/${macdCfg.signal})` });
    } else if (m.crossover === 'bearish') {
      macdScore = 22;
      factors.push({ key: 'macd', dir: 'bear', text: `تقاطع نزولی MACD (${macdCfg.fast}/${macdCfg.slow}/${macdCfg.signal})` });
    } else if (m.momentumDir === 'bull' || (m.macd > 0 && (m.hist == null || m.hist >= 0))) {
      macdScore = 68;
      factors.push({ key: 'macd', dir: 'bull', text: 'مومنتوم: صعودی 🔺' });
    } else if (m.momentumDir === 'bear' || m.macd < 0) {
      macdScore = 32;
      factors.push({ key: 'macd', dir: 'bear', text: 'مومنتوم: نزولی 🔻' });
    }
  }

  // Momentum / ROC
  if (mom != null) {
    if (mom > 2) { momScore = 68; factors.push({ key: 'momentum', dir: 'bull', text: 'مومنتوم: مثبت' }); }
    else if (mom < -2) { momScore = 32; factors.push({ key: 'momentum', dir: 'bear', text: 'مومنتوم: منفی' }); }
  }

  // Bollinger
  if (bb.pctB != null) {
    if (bb.pctB < 0.1) { factors.push({ key: 'bb', dir: 'bull', text: 'نزدیک کف نوسان' }); momScore = Math.min(100, momScore + 5); }
    else if (bb.pctB > 0.9) { factors.push({ key: 'bb', dir: 'bear', text: 'نزدیک سقف نوسان' }); momScore = Math.max(0, momScore - 5); }
  }

  // Stochastic
  if (stoch.k != null) {
    if (stoch.k < 20) { factors.push({ key: 'stoch', dir: 'bull', text: 'اشباع فروش' }); rsiScore = Math.min(100, rsiScore + 4); }
    else if (stoch.k > 80) { factors.push({ key: 'stoch', dir: 'bear', text: 'اشباع خرید' }); rsiScore = Math.max(0, rsiScore - 4); }
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

  // Fibonacci proximity → structure score
  if (fib.ok && fib.nearest && fib.nearest.near) {
    if (fib.bias === 'bull') {
      structScore += 10;
      factors.push({
        key: 'fibonacci',
        dir: 'bull',
        text: `نزدیک سطح فیبوناچی ${fib.nearest.level} (${fib.nearest.kind === 'ext' ? 'گسترش' : 'بازگشت'})`
      });
    } else if (fib.bias === 'bear') {
      structScore -= 10;
      factors.push({
        key: 'fibonacci',
        dir: 'bear',
        text: `نزدیک سطح فیبوناچی ${fib.nearest.level} (${fib.nearest.kind === 'ext' ? 'گسترش' : 'بازگشت'})`
      });
    } else {
      factors.push({
        key: 'fibonacci',
        dir: 'neutral',
        text: `نزدیک سطح فیبوناچی ${fib.nearest.level}`
      });
    }
  }
  structScore = Math.max(0, Math.min(100, structScore));

  // Volatility
  if (volPct != null) {
    if (volPct > CONFIG.highVolPct) {
      volScore = 35; factors.push({ key: 'volatility', dir: 'bear', text: 'نوسان بالا' });
    } else if (volPct < CONFIG.lowVolPct) {
      volScore = 58; factors.push({ key: 'volatility', dir: 'neutral', text: 'نوسان پایین' });
    }
  }

  // Volume
  if (volA.available) {
    if (volA.spike) { volumeScore = 68; factors.push({ key: 'volume', dir: 'bull', text: 'حجم: بالا' }); }
    else if (volA.weak) { volumeScore = 40; factors.push({ key: 'volume', dir: 'bear', text: 'حجم: ضعیف' }); }
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
      macdCrossover: m.crossover,
      macdMomentum: m.momentumDir,
      macdPeriods: m.periods,
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
      drawdown: dd,
      fibonacci: fib
    }
  };
}
