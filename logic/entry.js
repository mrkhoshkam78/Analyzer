/**
 * Entry Price Engine V7.0.1
 * Preferred entry, zone, type, confirmation, invalidation.
 * Does not invent levels — uses structure + ATR + MTF agreement.
 */
import { CONFIG } from './config.js';
import { isNum } from './indicators.js';
import { computeTargetStop } from './strategies.js';

/**
 * @param {object} input
 *  - price, signal, support, resistance, atr, atrPct
 *  - regime, mtf (multi-tf result), agreement, riskScore
 *  - fib (optional), session, eventState
 */
export function computeEntry(input = {}) {
  const {
    price,
    signal = 'HOLD',
    support = null,
    resistance = null,
    atr = null,
    atrPct = null,
    regime = 'Unclear',
    mtf = null,
    strategyAgreement = 0.5,
    riskScore = 50,
    fib = null,
    eventState = 'UNKNOWN',
    sessionLiquidity = 'normal'
  } = input;

  const empty = {
    valid: false,
    entryType: 'No Valid Entry',
    preferredEntry: null,
    entryZone: null,
    currentPrice: price,
    confirmation: [],
    invalidation: null,
    target1: null,
    target2: null,
    stop: null,
    rr: null,
    waitForEntry: true,
    reason: 'سیگنال یا ساختار کافی نیست'
  };

  if (!isNum(price) || price <= 0) {
    return { ...empty, reason: 'قیمت نامعتبر' };
  }

  if (signal === 'HOLD') {
    return {
      ...empty,
      reason: 'سیگنال HOLD — ورود توصیه نمی‌شود',
      waitForEntry: true,
      entryType: 'No Valid Entry'
    };
  }

  // High event risk → wait
  if (eventState === 'IMMINENT_EVENT' || eventState === 'EVENT_REACTION') {
    return {
      ...empty,
      reason: `ریسک رویداد (${eventState}) — صبر تا آرامش بازار`,
      waitForEntry: true,
      entryType: 'No Valid Entry'
    };
  }

  // High risk + low agreement → wait
  if (riskScore >= 75 && strategyAgreement < 0.45) {
    return {
      ...empty,
      reason: 'ریسک بالا و توافق استراتژی پایین',
      waitForEntry: true
    };
  }

  const atrSafe = isNum(atr) && atr > 0 ? atr : price * 0.008;
  const volRegime = atrPct > CONFIG.highVolPct ? 'high' : atrPct < CONFIG.lowVolPct ? 'low' : 'normal';
  const isBuy = signal === 'BUY';
  const isSell = signal === 'SELL';

  // Structure-aware entry types
  let entryType = 'Market Entry';
  let preferred = price;
  let zoneLow = price;
  let zoneHigh = price;
  const confirmation = [];
  let invalidation = null;

  const nearSup = isNum(support) && (price - support) / price < 0.012;
  const nearRes = isNum(resistance) && (resistance - price) / price < 0.012;
  const aboveRes = isNum(resistance) && price > resistance * 1.001;
  const belowSup = isNum(support) && price < support * 0.999;

  if (isBuy) {
    if (nearSup) {
      entryType = 'Support/Resistance Entry';
      preferred = support + atrSafe * 0.15;
      zoneLow = support;
      zoneHigh = support + atrSafe * 0.5;
      confirmation.push('نزدیک حمایت ساختاری');
    } else if (aboveRes && (regime === 'Trending Bullish' || regime === 'Breakout')) {
      entryType = 'Breakout Entry';
      preferred = resistance + atrSafe * 0.1;
      zoneLow = resistance;
      zoneHigh = resistance + atrSafe * 0.6;
      confirmation.push('شکست مقاومت');
      // retest alternative
      if (price > resistance + atrSafe * 0.8) {
        entryType = 'Breakout-Retest Entry';
        preferred = resistance + atrSafe * 0.05;
        zoneLow = resistance - atrSafe * 0.1;
        zoneHigh = resistance + atrSafe * 0.35;
        confirmation.push('منتظر ریتست مقاومت شکسته');
      }
    } else if (regime === 'Trending Bullish' || regime === 'Range') {
      entryType = 'Pullback Entry';
      const pullLevel = isNum(support) ? support : price - atrSafe * 1.2;
      preferred = Math.max(pullLevel, price - atrSafe * 0.8);
      zoneLow = preferred - atrSafe * 0.3;
      zoneHigh = preferred + atrSafe * 0.4;
      confirmation.push('ورود در اصلاح به سمت ساختار');
      if (price > preferred + atrSafe * 0.6) {
        // current price stretched — wait for pullback
        return {
          valid: true,
          entryType: 'Pullback Entry',
          preferredEntry: preferred,
          entryZone: { low: zoneLow, high: zoneHigh },
          currentPrice: price,
          confirmation: ['قیمت فعلی کشیده است — منتظر پولبک'],
          invalidation: isNum(support) ? support - atrSafe * 0.5 : price - atrSafe * 2,
          target1: null,
          target2: null,
          stop: null,
          rr: null,
          waitForEntry: true,
          reason: 'Wait for Entry — پولبک به ناحیه ورود'
        };
      }
    } else {
      entryType = 'Market Entry';
      preferred = price;
      zoneLow = price - atrSafe * 0.2;
      zoneHigh = price + atrSafe * 0.15;
    }

    // Fib confluence
    if (fib?.ok && fib.nearest?.near && fib.bias === 'bull') {
      confirmation.push(`هم‌ترازی فیبوناچی ${fib.nearest.level}`);
      preferred = (preferred + fib.nearest.price) / 2;
    }

    invalidation = isNum(support)
      ? Math.min(support, preferred) - atrSafe * (volRegime === 'high' ? 0.8 : 0.5)
      : preferred - atrSafe * 1.2;

  } else if (isSell) {
    if (nearRes) {
      entryType = 'Support/Resistance Entry';
      preferred = resistance - atrSafe * 0.15;
      zoneLow = resistance - atrSafe * 0.5;
      zoneHigh = resistance;
      confirmation.push('نزدیک مقاومت ساختاری');
    } else if (belowSup && (regime === 'Trending Bearish' || regime === 'Breakout')) {
      entryType = 'Breakout Entry';
      preferred = support - atrSafe * 0.1;
      zoneLow = support - atrSafe * 0.6;
      zoneHigh = support;
      confirmation.push('شکست حمایت');
      if (price < support - atrSafe * 0.8) {
        entryType = 'Breakout-Retest Entry';
        preferred = support - atrSafe * 0.05;
        zoneLow = support - atrSafe * 0.35;
        zoneHigh = support + atrSafe * 0.1;
        confirmation.push('منتظر ریتست حمایت شکسته');
      }
    } else if (regime === 'Trending Bearish' || regime === 'Range') {
      entryType = 'Pullback Entry';
      const pullLevel = isNum(resistance) ? resistance : price + atrSafe * 1.2;
      preferred = Math.min(pullLevel, price + atrSafe * 0.8);
      zoneLow = preferred - atrSafe * 0.4;
      zoneHigh = preferred + atrSafe * 0.3;
      confirmation.push('ورود در اصلاح صعودی به مقاومت');
      if (price < preferred - atrSafe * 0.6) {
        return {
          valid: true,
          entryType: 'Pullback Entry',
          preferredEntry: preferred,
          entryZone: { low: zoneLow, high: zoneHigh },
          currentPrice: price,
          confirmation: ['قیمت فعلی کشیده است — منتظر پولبک'],
          invalidation: isNum(resistance) ? resistance + atrSafe * 0.5 : price + atrSafe * 2,
          target1: null,
          target2: null,
          stop: null,
          rr: null,
          waitForEntry: true,
          reason: 'Wait for Entry — پولبک به ناحیه ورود'
        };
      }
    } else {
      entryType = 'Market Entry';
      preferred = price;
      zoneLow = price - atrSafe * 0.15;
      zoneHigh = price + atrSafe * 0.2;
    }

    if (fib?.ok && fib.nearest?.near && fib.bias === 'bear') {
      confirmation.push(`هم‌ترازی فیبوناچی ${fib.nearest.level}`);
      preferred = (preferred + fib.nearest.price) / 2;
    }

    invalidation = isNum(resistance)
      ? Math.max(resistance, preferred) + atrSafe * (volRegime === 'high' ? 0.8 : 0.5)
      : preferred + atrSafe * 1.2;
  }

  // MTF confirmation
  if (mtf?.ok) {
    if (mtf.alignment === (isBuy ? 'bullish' : 'bearish')) {
      confirmation.push(`توافق مولتی‌تایم‌فریم: ${mtf.agreementLabel}`);
    } else if (mtf.htfLtfConflict) {
      confirmation.push('تعارض HTF/LTF — احتیاط');
    }
  }

  if (strategyAgreement >= 0.7) confirmation.push('توافق قوی استراتژی‌ها');
  else if (strategyAgreement < 0.4) confirmation.push('توافق ضعیف استراتژی‌ها');

  // Targets from structure+ATR relative to preferred entry
  const ts1 = computeTargetStop(preferred, signal, support, resistance, atrSafe, volRegime);
  let target1 = ts1.target;
  let stop = ts1.stop;

  // Target2 = extension
  let target2 = target1;
  if (isBuy) {
    target2 = target1 + atrSafe * (volRegime === 'high' ? 1.5 : 1.2);
    // enforce Stop < Entry < Target
    if (!(stop < preferred && preferred < target1)) {
      stop = preferred - atrSafe * 1.1;
      target1 = preferred + atrSafe * 2.0;
      target2 = preferred + atrSafe * 3.2;
    }
  } else {
    target2 = target1 - atrSafe * (volRegime === 'high' ? 1.5 : 1.2);
    if (!(target1 < preferred && preferred < stop)) {
      stop = preferred + atrSafe * 1.1;
      target1 = preferred - atrSafe * 2.0;
      target2 = preferred - atrSafe * 3.2;
    }
  }

  const risk = Math.abs(preferred - stop);
  const reward = Math.abs(target1 - preferred);
  const rr = risk > 0 ? Math.round((reward / risk) * 100) / 100 : null;

  // R:R validation — reject poor R:R unless breakout continuation
  if (rr != null && rr < 1.2 && entryType !== 'Breakout Entry') {
    return {
      valid: false,
      entryType: 'No Valid Entry',
      preferredEntry: preferred,
      entryZone: { low: zoneLow, high: zoneHigh },
      currentPrice: price,
      confirmation,
      invalidation,
      target1,
      target2,
      stop,
      rr,
      waitForEntry: true,
      reason: `R:R نامناسب (${rr}) — ورود توصیه نمی‌شود`
    };
  }

  const atMarket = Math.abs(price - preferred) / price < 0.003;
  const waitForEntry = !atMarket && (entryType === 'Pullback Entry' || entryType === 'Breakout-Retest Entry');

  return {
    valid: true,
    entryType,
    preferredEntry: Math.round(preferred * 1e6) / 1e6,
    entryZone: {
      low: Math.round(zoneLow * 1e6) / 1e6,
      high: Math.round(zoneHigh * 1e6) / 1e6
    },
    currentPrice: price,
    confirmation,
    invalidation: invalidation != null ? Math.round(invalidation * 1e6) / 1e6 : null,
    target1: Math.round(target1 * 1e6) / 1e6,
    target2: Math.round(target2 * 1e6) / 1e6,
    stop: Math.round(stop * 1e6) / 1e6,
    rr,
    waitForEntry,
    reason: waitForEntry
      ? `Wait for Entry — ${entryType}`
      : `ورود ${entryType} در محدوده تعریف‌شده`
  };
}
