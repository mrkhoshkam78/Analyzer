/**
 * Historical Backtest Engine V6.05 — true walk-forward, no look-ahead bias.
 * - Fundamental filtered by timestamp
 * - MFE/MAE uses High/Low of future bars
 * - Target Hit / Stop Hit / Both / Neither
 * - 3-class BUY/SELL/HOLD metrics without half-credit double-counting
 * - Per-strategy and ensemble backtests
 */
import { runTechnical } from './technical.js';
import { runFundamental, getFundamentalData } from './fundamental.js';
import { CONFIG } from './config.js';
import { loadJSON, saveJSON } from './storage.js';
import { runDecision } from './decision.js';
import { runAllStrategies, computeTargetStop } from './strategies.js';
import { detectRegime } from './regime.js';

const BT_STORE = 'backtest_results';

export function loadBacktestResults() {
  return loadJSON(BT_STORE, []) || [];
}

export function saveBacktestResults(list) {
  return saveJSON(BT_STORE, list);
}

/**
 * Evaluate future path against target/stop using High/Low.
 * Conservative rule when both hit in same candle: Stop wins (adverse first).
 */
function evaluatePath(entryPrice, signal, target, stop, futureSlice) {
  let mfe = 0;
  let mae = 0;
  let targetHit = false;
  let stopHit = false;
  let targetHitBar = -1;
  let stopHitBar = -1;
  let bothSameBar = false;

  const isBuy = signal === 'BUY';
  const isSell = signal === 'SELL';

  for (let bi = 0; bi < futureSlice.length; bi++) {
    const bar = futureSlice[bi];
    const hi = Number.isFinite(bar.h) ? bar.h : bar.c;
    const lo = Number.isFinite(bar.l) ? bar.l : bar.c;
    const cl = bar.c;

    if (isBuy) {
      const fav = (hi - entryPrice) / entryPrice;
      const adv = (lo - entryPrice) / entryPrice;
      if (fav > mfe) mfe = fav;
      if (adv < mae) mae = adv;

      const hitT = target != null && hi >= target;
      const hitS = stop != null && lo <= stop;
      if (hitT && hitS) {
        bothSameBar = true;
        stopHit = true;
        stopHitBar = bi;
        // conservative: stop first
        break;
      } else if (hitS && !stopHit) {
        stopHit = true;
        stopHitBar = bi;
        break;
      } else if (hitT && !targetHit) {
        targetHit = true;
        targetHitBar = bi;
        break;
      }
    } else if (isSell) {
      const fav = (entryPrice - lo) / entryPrice;
      const adv = (entryPrice - hi) / entryPrice;
      if (fav > mfe) mfe = fav;
      if (adv < mae) mae = adv; // mae is negative-ish for adverse

      const hitT = target != null && lo <= target;
      const hitS = stop != null && hi >= stop;
      if (hitT && hitS) {
        bothSameBar = true;
        stopHit = true;
        stopHitBar = bi;
        break;
      } else if (hitS && !stopHit) {
        stopHit = true;
        stopHitBar = bi;
        break;
      } else if (hitT && !targetHit) {
        targetHit = true;
        targetHitBar = bi;
        break;
      }
    } else {
      // HOLD: track absolute excursion
      const up = (hi - entryPrice) / entryPrice;
      const dn = (lo - entryPrice) / entryPrice;
      if (up > mfe) mfe = up;
      if (dn < mae) mae = dn;
    }
  }

  let outcome = 'neither';
  if (targetHit && !stopHit) outcome = 'target';
  else if (stopHit && !targetHit) outcome = 'stop';
  else if (bothSameBar) outcome = 'both_stop_first';
  else if (targetHit && stopHit) outcome = 'both';

  const futureClose = futureSlice.length ? futureSlice[futureSlice.length - 1].c : entryPrice;
  const actualRet = (futureClose - entryPrice) / entryPrice;
  const actualDir = Math.abs(actualRet) < 0.002 ? 'neutral'
    : actualRet > 0 ? 'up' : 'down';

  return {
    mfe: Math.round(mfe * 10000) / 100,
    mae: Math.round(mae * 10000) / 100,
    targetHit,
    stopHit,
    bothSameBar,
    outcome,
    targetHitBar,
    stopHitBar,
    futureClose,
    actualRet,
    actualDir
  };
}

/**
 * 3-class classification metrics without half-credit.
 */
function computeClassMetrics(predictions) {
  // confusion: pred × actual (up/down/neutral)
  const labels = ['up', 'down', 'neutral'];
  const matrix = {};
  for (const a of labels) {
    matrix[a] = {};
    for (const b of labels) matrix[a][b] = 0;
  }

  for (const p of predictions) {
    const pred = p.predictedDirection;
    const act = p.actualDirection;
    if (matrix[pred] && matrix[pred][act] != null) matrix[pred][act]++;
  }

  const perClass = {};
  for (const cls of labels) {
    const tp = matrix[cls][cls];
    let fp = 0, fn = 0, support = 0;
    for (const other of labels) {
      if (other !== cls) {
        fp += matrix[cls][other];
        fn += matrix[other][cls];
      }
      support += matrix[other][cls];
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[cls] = {
      precision: Math.round(precision * 10000) / 100,
      recall: Math.round(recall * 10000) / 100,
      f1: Math.round(f1 * 10000) / 100,
      support,
      tp
    };
  }

  // Overall accuracy = diagonal / total (no half credit)
  let correct = 0;
  let total = predictions.length;
  for (const cls of labels) correct += matrix[cls][cls];
  const accuracy = total > 0 ? correct / total : 0;

  // Directional accuracy: only among non-neutral predictions
  const dirPreds = predictions.filter(p => p.predictedDirection !== 'neutral');
  const dirCorrect = dirPreds.filter(p => p.result === 'correct').length;
  const dirAccuracy = dirPreds.length > 0 ? dirCorrect / dirPreds.length : 0;

  return {
    accuracy: Math.round(accuracy * 10000) / 100,
    directionalAccuracy: Math.round(dirAccuracy * 10000) / 100,
    perClass,
    matrix,
    n: total,
    nDirectional: dirPreds.length
  };
}

/**
 * Run walk-forward backtest.
 * @param {Array} candles chronological OHLCV
 * @param {object} opts { symbol, horizon, step, mode, fundSnapshot, strategyId }
 *   mode: 'ensemble' | 'tech' | 'fund' | 'combined' | specific strategy id
 */
export function runBacktest(candles, opts = {}) {
  const horizon = Math.max(1, Math.min(60, Number(opts.horizon) || 5));
  const step = Math.max(1, Number(opts.step) || 5);
  const mode = opts.mode || 'ensemble';
  const symbol = opts.symbol || 'UNKNOWN';
  const minBars = CONFIG.minCandles || 30;
  const strategyId = opts.strategyId || null;

  if (!candles || candles.length < minBars + horizon + 2) {
    return {
      ok: false,
      error: `حداقل ${minBars + horizon + 2} کندل برای بک‌تست لازم است (فعلی: ${candles?.length || 0}).`
    };
  }

  // Full fund snapshot — will be filtered per-point by timestamp
  const fundSnapFull = opts.fundSnapshot || getFundamentalData(symbol) || null;

  const predictions = [];
  let wins = 0, losses = 0;
  let sumRR = 0, rrCount = 0;
  let sumRet = 0;
  let targetHits = 0, stopHits = 0, neither = 0;
  let peakEquity = 0, equity = 0, maxDD = 0;
  let sumMfe = 0, sumMae = 0;

  const start = minBars;
  const end = candles.length - horizon - 1;

  for (let i = start; i <= end; i += step) {
    const hist = candles.slice(0, i + 1);
    const entry = hist[hist.length - 1];
    const entryPrice = entry.c;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;

    // Timestamp for look-ahead prevention
    const asOfTs = entry.ts != null ? entry.ts
      : (entry.date ? Date.parse(entry.date) : null);

    let signal = 'HOLD';
    let direction = 'neutral';
    let target = entryPrice;
    let stop = entryPrice;
    let confidence = 0.4;
    let techScore = null;
    let fundScore = null;
    let combined = 50;
    let fundApplied = false;
    let regime = null;
    let strategySignals = null;

    if (mode === 'ensemble' || mode === 'combined') {
      const decision = runDecision(hist, {
        symbol,
        currentPrice: entryPrice,
        timeframe: opts.timeframe || '1D',
        fundamentalSnapshot: fundSnapFull,
        asOfTs,
        horizonBars: horizon
      });
      if (!decision.ok) continue;
      signal = decision.signal;
      direction = decision.prediction?.direction || (signal === 'BUY' ? 'up' : signal === 'SELL' ? 'down' : 'neutral');
      target = decision.target;
      stop = decision.stop;
      confidence = decision.confidence;
      techScore = decision.analysis?.technicalScore;
      fundScore = decision.analysis?.fundamentalScore;
      combined = decision.score;
      fundApplied = decision.fundamentalApplied;
      regime = decision.regime;
      strategySignals = decision.strategies;
    } else if (strategyId || ['trendFollowing', 'meanReversion', 'momentum', 'breakout', 'fibStructure', 'fundamental'].includes(mode)) {
      const sid = strategyId || mode;
      const stratResult = runAllStrategies(hist, {
        symbol,
        currentPrice: entryPrice,
        timeframe: opts.timeframe || '1D',
        fundamentalSnapshot: fundSnapFull,
        asOfTs
      });
      if (!stratResult.ok) continue;
      const s = stratResult.strategies.find(x => x.id === sid);
      if (!s || !s.active) continue;
      signal = s.signal;
      direction = signal === 'BUY' ? 'up' : signal === 'SELL' ? 'down' : 'neutral';
      target = s.target ?? entryPrice;
      stop = s.stop ?? entryPrice;
      confidence = s.confidence;
      combined = s.score;
      const reg = detectRegime(hist, stratResult.indicators);
      regime = reg.regime;
    } else {
      // Legacy tech / fund modes
      const tech = runTechnical(hist, { symbol, currentPrice: entryPrice, timeframe: opts.timeframe || '1D' });
      if (!tech.ok) continue;
      techScore = tech.score;
      combined = techScore;

      if ((mode === 'fund' || mode === 'combined') && fundSnapFull) {
        // Filter fund by timestamp
        let snap = fundSnapFull;
        if (asOfTs != null) {
          const filtered = {};
          const asOfStr = new Date(asOfTs).toISOString().slice(0, 10);
          for (const [vid, rec] of Object.entries(fundSnapFull)) {
            if (rec && rec.date && rec.date <= asOfStr) filtered[vid] = rec;
          }
          snap = Object.keys(filtered).length ? filtered : null;
        }
        if (snap) {
          const fund = runFundamental(symbol, snap);
          if (fund.ok && fund.score != null) {
            fundScore = fund.score;
            if (mode === 'fund') {
              combined = fundScore;
              fundApplied = true;
            } else {
              const ew = CONFIG.engineWeights;
              combined = techScore * ew.technical + fundScore * ew.fundamental;
              fundApplied = true;
            }
          } else if (mode === 'fund') continue;
        } else if (mode === 'fund') continue;
      }

      combined = Math.max(0, Math.min(100, combined));
      if (combined >= CONFIG.buyThreshold) signal = 'BUY';
      else if (combined <= CONFIG.sellThreshold) signal = 'SELL';
      else signal = 'HOLD';
      direction = signal === 'BUY' ? 'up' : signal === 'SELL' ? 'down' : 'neutral';

      const ind = tech.indicators || {};
      const ts = computeTargetStop(
        entryPrice, signal, ind.support, ind.resistance, ind.atr,
        ind.atrPct > CONFIG.highVolPct ? 'high' : ind.atrPct < CONFIG.lowVolPct ? 'low' : 'normal'
      );
      target = ts.target;
      stop = ts.stop;
      confidence = 0.5 + Math.abs(combined - 50) / 100;
    }

    // Future path
    const futureSlice = candles.slice(i + 1, i + 1 + horizon);
    if (!futureSlice.length) continue;

    const path = evaluatePath(entryPrice, signal, target, stop, futureSlice);

    // Classification result (3-class)
    let result = 'neutral';
    if (direction === 'neutral') {
      result = path.actualDir === 'neutral' ? 'correct' : 'wrong';
    } else if (direction === path.actualDir) {
      result = 'correct';
    } else if (path.actualDir === 'neutral') {
      result = 'neutral'; // predicted direction but market flat
    } else {
      result = 'wrong';
    }

    if (path.outcome === 'target') {
      wins++;
      targetHits++;
    } else if (path.outcome === 'stop' || path.outcome === 'both_stop_first') {
      losses++;
      stopHits++;
    } else {
      neither++;
      // P&L by close for neither
      if (direction === 'up' && path.actualRet > 0) wins++;
      else if (direction === 'down' && path.actualRet < 0) wins++;
      else if (direction !== 'neutral') losses++;
    }

    const risk = Math.abs(entryPrice - stop);
    const reward = Math.abs(target - entryPrice);
    if (risk > 0 && reward > 0) {
      sumRR += reward / risk;
      rrCount++;
    }

    sumRet += path.actualRet;
    sumMfe += path.mfe;
    sumMae += path.mae;

    // Equity curve (simple: +1 win, -1 loss for directional)
    if (direction !== 'neutral') {
      if (result === 'correct') equity += 1;
      else if (result === 'wrong') equity -= 1;
      if (equity > peakEquity) peakEquity = equity;
      const dd = peakEquity - equity;
      if (dd > maxDD) maxDD = dd;
    }

    const predDate = entry.ts
      ? new Date(entry.ts).toISOString().slice(0, 10)
      : (entry.date || `idx:${i}`);

    predictions.push({
      idx: i,
      predictionDate: predDate,
      entryPrice,
      predictedDirection: direction,
      signal,
      predictedTarget: target,
      predictedStop: stop,
      confidence: Math.round(confidence * 1000) / 1000,
      techScore: techScore != null ? Math.round(techScore * 10) / 10 : null,
      fundScore: fundScore != null ? Math.round(fundScore * 10) / 10 : null,
      combinedScore: Math.round(combined * 10) / 10,
      actualFuturePrice: path.futureClose,
      actualDirection: path.actualDir,
      actualReturnPct: Math.round(path.actualRet * 10000) / 100,
      mfe: path.mfe,
      mae: path.mae,
      targetHit: path.targetHit,
      stopHit: path.stopHit,
      pathOutcome: path.outcome,
      result,
      errorPct: Math.round(Math.abs(path.actualRet) * 10000) / 100,
      horizon,
      mode,
      fundApplied,
      regime,
      strategySignals: strategySignals
        ? strategySignals.map(s => ({ id: s.id, signal: s.signal, score: s.score }))
        : null
    });
  }

  const n = predictions.length;
  if (n === 0) {
    return { ok: false, error: 'هیچ نقطه قابل ارزیابی تولید نشد. داده یا پارامترها را بررسی کنید.' };
  }

  const classMetrics = computeClassMetrics(predictions);

  const dirPreds = predictions.filter(p => p.predictedDirection !== 'neutral');
  const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;
  const avgRet = sumRet / n;
  const avgMfe = sumMfe / n;
  const avgMae = sumMae / n;
  const avgRR = rrCount > 0 ? sumRR / rrCount : null;
  const profitFactor = losses > 0 ? wins / losses : wins > 0 ? Infinity : 0;
  const targetHitRate = n > 0 ? targetHits / n : 0;
  const stopHitRate = n > 0 ? stopHits / n : 0;

  // BUY / SELL / HOLD separate counts
  const bySignal = { BUY: [], SELL: [], HOLD: [] };
  for (const p of predictions) {
    if (bySignal[p.signal]) bySignal[p.signal].push(p);
  }

  const summary = {
    ok: true,
    symbol,
    mode,
    horizon,
    step,
    n,
    // 3-class metrics (no half-credit)
    accuracy: classMetrics.accuracy,
    directionalAccuracy: classMetrics.directionalAccuracy,
    perClass: classMetrics.perClass,
    confusionMatrix: classMetrics.matrix,
    // Trading metrics
    winRate: Math.round(winRate * 10000) / 100,
    avgReturnPct: Math.round(avgRet * 10000) / 100,
    avgMfe: Math.round(avgMfe * 100) / 100,
    avgMae: Math.round(avgMae * 100) / 100,
    profitFactor: Number.isFinite(profitFactor) ? Math.round(profitFactor * 100) / 100 : null,
    avgRiskReward: avgRR != null ? Math.round(avgRR * 100) / 100 : null,
    maxDrawdown: maxDD,
    targetHitRate: Math.round(targetHitRate * 10000) / 100,
    stopHitRate: Math.round(stopHitRate * 10000) / 100,
    targetHits,
    stopHits,
    neither,
    wins,
    losses,
    // Per signal class counts
    signalCounts: {
      BUY: bySignal.BUY.length,
      SELL: bySignal.SELL.length,
      HOLD: bySignal.HOLD.length
    },
    fundUsed: !!fundSnapFull && (mode !== 'tech'),
    predictions,
    samples: pickSamples(predictions, 8)
  };

  // Persist
  const history = loadBacktestResults();
  history.unshift({
    ts: Date.now(),
    symbol,
    mode,
    horizon,
    step,
    n,
    accuracy: summary.accuracy,
    directionalAccuracy: summary.directionalAccuracy,
    winRate: summary.winRate,
    targetHitRate: summary.targetHitRate,
    stopHitRate: summary.stopHitRate,
    avgReturnPct: summary.avgReturnPct
  });
  saveBacktestResults(history.slice(0, 50));

  return summary;
}

/**
 * Backtest each strategy separately + ensemble.
 */
export function runStrategyBacktests(candles, opts = {}) {
  const strategyIds = [
    'trendFollowing',
    'meanReversion',
    'momentum',
    'breakout',
    'fibStructure',
    'fundamental'
  ];
  const results = {};
  for (const sid of strategyIds) {
    results[sid] = runBacktest(candles, { ...opts, mode: sid, strategyId: sid });
  }
  results.ensemble = runBacktest(candles, { ...opts, mode: 'ensemble' });
  return results;
}

function pickSamples(list, k) {
  if (!list.length) return [];
  if (list.length <= k) return list;
  const out = [];
  const step = (list.length - 1) / (k - 1);
  for (let i = 0; i < k; i++) {
    out.push(list[Math.round(i * step)]);
  }
  return out;
}
