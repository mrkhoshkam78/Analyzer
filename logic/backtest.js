/**
 * Historical Backtest Engine — no look-ahead bias.
 * Uses only candles up to prediction index; evaluates against future close.
 */
import { runTechnical } from './technical.js';
import { runFundamental, getFundamentalData } from './fundamental.js';
import { CONFIG } from './config.js';
import { loadJSON, saveJSON } from './storage.js';

const BT_STORE = 'backtest_results';

export function loadBacktestResults() {
  return loadJSON(BT_STORE, []) || [];
}

export function saveBacktestResults(list) {
  return saveJSON(BT_STORE, list);
}

/**
 * Run walk-forward style backtest on OHLCV candles.
 * @param {Array} candles chronological OHLCV with optional ts
 * @param {object} opts { symbol, horizon, step, mode: 'tech'|'fund'|'combined', fundSnapshot }
 */
export function runBacktest(candles, opts = {}) {
  const horizon = Math.max(1, Math.min(60, Number(opts.horizon) || 5));
  const step = Math.max(1, Number(opts.step) || 5);
  const mode = opts.mode || 'combined';
  const symbol = opts.symbol || 'UNKNOWN';
  const minBars = CONFIG.minCandles || 30;

  if (!candles || candles.length < minBars + horizon + 2) {
    return {
      ok: false,
      error: `حداقل ${minBars + horizon + 2} کندل برای بک‌تست لازم است (فعلی: ${candles?.length || 0}).`
    };
  }

  const fundSnap = opts.fundSnapshot || getFundamentalData(symbol) || null;
  const hasFund = fundSnap && Object.keys(fundSnap).length > 0;

  const predictions = [];
  let correct = 0;
  let wrong = 0;
  let neutral = 0;
  let totalErrorPct = 0;
  let wins = 0;
  let losses = 0;
  let sumRR = 0;
  let rrCount = 0;

  // Walk forward: at index i, only use candles[0..i]
  const start = minBars;
  const end = candles.length - horizon - 1;

  for (let i = start; i <= end; i += step) {
    const hist = candles.slice(0, i + 1);
    const entry = hist[hist.length - 1];
    const entryPrice = entry.c;
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;

    // Technical on past only
    const tech = runTechnical(hist, { symbol, currentPrice: entryPrice, timeframe: opts.timeframe || '1D' });
    if (!tech.ok) continue;

    let techScore = tech.score;
    let fundScore = null;
    let combined = techScore;
    let fundApplied = false;

    if ((mode === 'fund' || mode === 'combined') && hasFund) {
      const fund = runFundamental(symbol, fundSnap);
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
      } else if (mode === 'fund') {
        // skip point if fund-only and no fund data
        continue;
      }
    } else if (mode === 'fund' && !hasFund) {
      continue;
    }

    combined = Math.max(0, Math.min(100, combined));

    let signal = 'HOLD';
    if (combined >= CONFIG.buyThreshold) signal = 'BUY';
    else if (combined <= CONFIG.sellThreshold) signal = 'SELL';

    const direction = signal === 'BUY' ? 'up' : signal === 'SELL' ? 'down' : 'neutral';

    // Targets from structure at prediction time
    const ind = tech.indicators || {};
    const support = ind.support;
    const resistance = ind.resistance;
    const range = (resistance != null && support != null && resistance > support)
      ? resistance - support : entryPrice * 0.01;
    let target = entryPrice;
    let stop = entryPrice;
    if (signal === 'BUY') {
      target = resistance != null ? Math.max(resistance, entryPrice + range * 0.35) : entryPrice * 1.01;
      stop = support != null ? Math.max(0, support - range * 0.08) : entryPrice * 0.99;
    } else if (signal === 'SELL') {
      target = support != null ? Math.min(support, entryPrice - range * 0.35) : entryPrice * 0.99;
      stop = resistance != null ? resistance + range * 0.08 : entryPrice * 1.01;
    }

    const confBase = 0.5 + Math.abs(combined - 50) / 100;
    const confidence = Math.max(0.15, Math.min(0.95, confBase));

    // Future reality (only after prediction point)
    const futureSlice = candles.slice(i + 1, i + 1 + horizon);
    if (!futureSlice.length) continue;
    const futureClose = futureSlice[futureSlice.length - 1].c;
    if (!Number.isFinite(futureClose) || futureClose <= 0) continue;

    // MFE / MAE over the horizon path
    let mfe = 0; // max favorable excursion (fraction)
    let mae = 0; // max adverse
    for (const bar of futureSlice) {
      const ret = (bar.c - entryPrice) / entryPrice;
      if (direction === 'up') {
        if (ret > mfe) mfe = ret;
        if (ret < mae) mae = ret;
      } else if (direction === 'down') {
        if (-ret > mfe) mfe = -ret;
        if (-ret < mae) mae = -ret;
      } else {
        // neutral: treat abs as adverse-ish
        if (Math.abs(ret) > mae) mae = -Math.abs(ret);
      }
    }

    const actualRet = (futureClose - entryPrice) / entryPrice;
    const actualDir = Math.abs(actualRet) < 0.002 ? 'neutral'
      : actualRet > 0 ? 'up' : 'down';

    let result = 'neutral';
    if (direction === 'neutral') {
      result = actualDir === 'neutral' ? 'correct' : 'neutral';
      if (result === 'correct') neutral++;
      else neutral++;
    } else if (direction === actualDir) {
      result = 'correct';
      correct++;
      wins++;
    } else if (actualDir === 'neutral') {
      result = 'neutral';
      neutral++;
    } else {
      result = 'wrong';
      wrong++;
      losses++;
    }

    const errorPct = Math.abs(actualRet) * 100;
    totalErrorPct += errorPct;

    // Simple RR: |target-entry| / |entry-stop|
    const risk = Math.abs(entryPrice - stop);
    const reward = Math.abs(target - entryPrice);
    if (risk > 0 && reward > 0) {
      sumRR += reward / risk;
      rrCount++;
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
      techScore: Math.round(techScore * 10) / 10,
      fundScore: fundScore != null ? Math.round(fundScore * 10) / 10 : null,
      combinedScore: Math.round(combined * 10) / 10,
      actualFuturePrice: futureClose,
      actualDirection: actualDir,
      actualReturnPct: Math.round(actualRet * 10000) / 100,
      mfe: Math.round(mfe * 10000) / 100,
      mae: Math.round(mae * 10000) / 100,
      result,
      errorPct: Math.round(errorPct * 100) / 100,
      horizon,
      mode,
      fundApplied
    });
  }

  const n = predictions.length;
  if (n === 0) {
    return { ok: false, error: 'هیچ نقطه قابل ارزیابی تولید نشد. داده یا پارامترها را بررسی کنید.' };
  }

  const directional = predictions.filter(p => p.predictedDirection !== 'neutral');
  const dirCorrect = directional.filter(p => p.result === 'correct').length;
  const dirWrong = directional.filter(p => p.result === 'wrong').length;
  const dirN = directional.length || 1;

  // Precision/Recall treating BUY as positive class for up-moves (simplified)
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const p of predictions) {
    const predUp = p.predictedDirection === 'up';
    const actUp = p.actualDirection === 'up';
    if (predUp && actUp) tp++;
    else if (predUp && !actUp) fp++;
    else if (!predUp && actUp) fn++;
    else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = (correct + (neutral * 0.5)) / n; // soft: half credit neutral
  const hardAccuracy = correct / n;
  const dirAccuracy = dirCorrect / dirN;
  const falseSignalRate = dirWrong / dirN;
  const winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0;
  const avgError = totalErrorPct / n;
  const avgRR = rrCount > 0 ? sumRR / rrCount : null;

  const summary = {
    ok: true,
    symbol,
    mode,
    horizon,
    step,
    n,
    correct,
    wrong,
    neutral,
    accuracy: Math.round(hardAccuracy * 10000) / 100, // 0–100 scale
    softAccuracy: Math.round(accuracy * 10000) / 100,
    directionalAccuracy: Math.round(dirAccuracy * 10000) / 100,
    precision: Math.round(precision * 10000) / 100,
    recall: Math.round(recall * 10000) / 100,
    f1: Math.round(f1 * 10000) / 100,
    falseSignalRate: Math.round(falseSignalRate * 10000) / 100,
    winRate: Math.round(winRate * 10000) / 100,
    avgErrorPct: Math.round(avgError * 100) / 100,
    avgRiskReward: avgRR != null ? Math.round(avgRR * 100) / 100 : null,
    fundUsed: hasFund && (mode !== 'tech'),
    predictions,
    // sample first/mid/last for report
    samples: pickSamples(predictions, 8)
  };

  // Persist last run
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
    falseSignalRate: summary.falseSignalRate,
    avgErrorPct: summary.avgErrorPct
  });
  saveBacktestResults(history.slice(0, 50));

  return summary;
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
