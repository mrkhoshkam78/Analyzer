//! Technical indicators — deterministic, pure.
//! Numerical parity target: logic/indicators.js v11.6.0
//! Return None when data is insufficient (never fabricate).

use crate::types::{
    periods, AdxResult, BollingerResult, BreakoutResult, Candle, MacdConfig, MacdResult, SrResult,
    StochResult,
};

#[inline]
pub fn is_finite(n: f64) -> bool {
    n.is_finite()
}

pub fn sma(values: &[f64], period: usize) -> Option<f64> {
    if values.len() < period || period == 0 {
        return None;
    }
    let slice = &values[values.len() - period..];
    if slice.iter().any(|v| !v.is_finite()) {
        return None;
    }
    Some(slice.iter().sum::<f64>() / period as f64)
}

/// EMA seeded with SMA of first `period` values, then recursive.
pub fn ema(values: &[f64], period: usize) -> Option<f64> {
    if values.len() < period || period == 0 {
        return None;
    }
    if values[..period].iter().any(|v| !v.is_finite()) {
        return None;
    }
    let mut e: f64 = values[..period].iter().sum::<f64>() / period as f64;
    let k = 2.0 / (period as f64 + 1.0);
    for i in period..values.len() {
        if !values[i].is_finite() {
            return None;
        }
        e = values[i] * k + e * (1.0 - k);
    }
    Some(e)
}

pub fn ema_series(values: &[f64], period: usize) -> Vec<Option<f64>> {
    if values.len() < period || period == 0 {
        return vec![];
    }
    if values[..period].iter().any(|v| !v.is_finite()) {
        return vec![];
    }
    let mut out: Vec<Option<f64>> = vec![None; values.len()];
    let seed: f64 = values[..period].iter().sum::<f64>() / period as f64;
    out[period - 1] = Some(seed);
    let k = 2.0 / (period as f64 + 1.0);
    for i in period..values.len() {
        if !values[i].is_finite() {
            out[i] = None;
            continue;
        }
        match out[i - 1] {
            Some(prev) => out[i] = Some(values[i] * k + prev * (1.0 - k)),
            None => out[i] = None,
        }
    }
    out
}

/// Wilder RSI
pub fn rsi(closes: &[f64], period: usize) -> Option<f64> {
    if closes.len() <= period {
        return None;
    }
    for i in 0..=period {
        if !closes[i].is_finite() {
            return None;
        }
    }
    let mut gains = 0.0_f64;
    let mut losses = 0.0_f64;
    for i in 1..=period {
        let d = closes[i] - closes[i - 1];
        if d >= 0.0 {
            gains += d;
        } else {
            losses -= d;
        }
    }
    let mut avg_gain = gains / period as f64;
    let mut avg_loss = losses / period as f64;
    for i in (period + 1)..closes.len() {
        if !closes[i].is_finite() {
            return None;
        }
        let d = closes[i] - closes[i - 1];
        avg_gain = (avg_gain * (period as f64 - 1.0) + d.max(0.0)) / period as f64;
        avg_loss = (avg_loss * (period as f64 - 1.0) + (-d).max(0.0)) / period as f64;
    }
    if avg_gain == 0.0 && avg_loss == 0.0 {
        return Some(50.0);
    }
    if avg_loss == 0.0 {
        return Some(100.0);
    }
    if avg_gain == 0.0 {
        return Some(0.0);
    }
    let rs = avg_gain / avg_loss;
    if !rs.is_finite() {
        return None;
    }
    Some(100.0 - 100.0 / (1.0 + rs))
}

pub fn rsi_default(closes: &[f64]) -> Option<f64> {
    rsi(closes, periods::RSI)
}

pub fn momentum(closes: &[f64], period: usize) -> Option<f64> {
    if closes.len() <= period {
        return None;
    }
    let a = closes[closes.len() - 1];
    let b = closes[closes.len() - 1 - period];
    if !a.is_finite() || !b.is_finite() {
        return None;
    }
    Some(a - b)
}

pub fn roc(closes: &[f64], period: usize) -> Option<f64> {
    if closes.len() <= period {
        return None;
    }
    let a = closes[closes.len() - 1];
    let b = closes[closes.len() - 1 - period];
    if !a.is_finite() || !b.is_finite() || b == 0.0 {
        return None;
    }
    let v = ((a - b) / b) * 100.0;
    if v.is_finite() {
        Some(v)
    } else {
        None
    }
}

/// True Range / Wilder ATR
pub fn atr(candles: &[Candle], period: usize) -> Option<f64> {
    if candles.len() < period + 1 || period == 0 {
        return None;
    }
    let mut trs: Vec<f64> = Vec::with_capacity(candles.len());
    trs.push(candles[0].h - candles[0].l); // first TR = H-L
    for i in 1..candles.len() {
        let h = candles[i].h;
        let l = candles[i].l;
        let pc = candles[i - 1].c;
        if !(h.is_finite() && l.is_finite() && pc.is_finite()) {
            return None;
        }
        let tr = (h - l)
            .max((h - pc).abs())
            .max((l - pc).abs());
        trs.push(tr);
    }
    // Wilder smoothing: first ATR = SMA of first `period` TRs (starting after first bar alignment)
    // Match JS: uses TR series from index 0.. and SMA then Wilder
    if trs.len() < period {
        return None;
    }
    let mut atr_val: f64 = trs[..period].iter().sum::<f64>() / period as f64;
    for i in period..trs.len() {
        atr_val = (atr_val * (period as f64 - 1.0) + trs[i]) / period as f64;
    }
    if atr_val.is_finite() {
        Some(atr_val)
    } else {
        None
    }
}

pub fn atr_default(candles: &[Candle]) -> Option<f64> {
    atr(candles, periods::ATR)
}

pub fn macd(closes: &[f64], cfg: &MacdConfig) -> MacdResult {
    let empty = MacdResult {
        macd: None,
        signal: None,
        hist: None,
    };
    if closes.len() < cfg.slow + cfg.signal {
        return empty;
    }
    let fast_s = ema_series(closes, cfg.fast);
    let slow_s = ema_series(closes, cfg.slow);
    if fast_s.is_empty() || slow_s.is_empty() {
        return empty;
    }
    let mut macd_line: Vec<f64> = Vec::new();
    let mut macd_for_signal: Vec<Option<f64>> = vec![None; closes.len()];
    for i in 0..closes.len() {
        match (fast_s[i], slow_s[i]) {
            (Some(f), Some(s)) => {
                let m = f - s;
                macd_line.push(m);
                macd_for_signal[i] = Some(m);
            }
            _ => {}
        }
    }
    // Signal EMA on the MACD line values that exist — match JS approach:
    // JS builds macd series aligned, then EMA on non-null tail.
    // We take contiguous valid macd values from the point both EMAs exist.
    let first_valid = cfg.slow - 1; // index where slow EMA first exists
    let mut line_vals: Vec<f64> = Vec::new();
    for i in first_valid..closes.len() {
        if let (Some(f), Some(s)) = (fast_s[i], slow_s[i]) {
            line_vals.push(f - s);
        } else {
            // break continuity — JS returns null if any missing in path
            return empty;
        }
    }
    if line_vals.len() < cfg.signal {
        return empty;
    }
    let signal_val = ema(&line_vals, cfg.signal);
    let macd_val = line_vals.last().copied();
    let hist = match (macd_val, signal_val) {
        (Some(m), Some(s)) => Some(m - s),
        _ => None,
    };
    MacdResult {
        macd: macd_val,
        signal: signal_val,
        hist,
    }
}

pub fn macd_default(closes: &[f64]) -> MacdResult {
    macd(closes, &MacdConfig::default())
}

pub fn bollinger(closes: &[f64], period: usize, mult: f64) -> BollingerResult {
    let empty = BollingerResult {
        mid: None,
        upper: None,
        lower: None,
        pct_b: None,
        width: None,
    };
    if closes.len() < period {
        return empty;
    }
    let slice = &closes[closes.len() - period..];
    if slice.iter().any(|v| !v.is_finite()) {
        return empty;
    }
    let mid = slice.iter().sum::<f64>() / period as f64;
    let var: f64 = slice.iter().map(|v| {
        let d = v - mid;
        d * d
    }).sum::<f64>() / period as f64;
    let sd = var.sqrt();
    if !sd.is_finite() {
        return empty;
    }
    let upper = mid + mult * sd;
    let lower = mid - mult * sd;
    let last = *closes.last().unwrap();
    let pct_b = if (upper - lower).abs() > f64::EPSILON {
        Some((last - lower) / (upper - lower))
    } else {
        None
    };
    let width = if mid.abs() > f64::EPSILON {
        Some((upper - lower) / mid)
    } else {
        None
    };
    BollingerResult {
        mid: Some(mid),
        upper: Some(upper),
        lower: Some(lower),
        pct_b,
        width,
    }
}

pub fn stochastic(candles: &[Candle], k_period: usize, d_period: usize) -> StochResult {
    let empty = StochResult { k: None, d: None };
    if candles.len() < k_period {
        return empty;
    }
    // %K for last bar
    let slice = &candles[candles.len() - k_period..];
    let mut lowest = f64::INFINITY;
    let mut highest = f64::NEG_INFINITY;
    for c in slice {
        if c.l.is_finite() && c.l < lowest {
            lowest = c.l;
        }
        if c.h.is_finite() && c.h > highest {
            highest = c.h;
        }
    }
    let close = candles.last().unwrap().c;
    if !close.is_finite() || !lowest.is_finite() || !highest.is_finite() {
        return empty;
    }
    let range = highest - lowest;
    let k = if range.abs() < f64::EPSILON {
        50.0
    } else {
        ((close - lowest) / range) * 100.0
    };
    // %D = SMA of last d_period %K values
    if candles.len() < k_period + d_period - 1 {
        return StochResult {
            k: if k.is_finite() { Some(k) } else { None },
            d: None,
        };
    }
    let mut ks: Vec<f64> = Vec::new();
    for end in (candles.len() - d_period)..candles.len() {
        let start = end + 1 - k_period;
        if start > end {
            return empty;
        }
        let s = &candles[start..=end];
        let mut lo = f64::INFINITY;
        let mut hi = f64::NEG_INFINITY;
        for c in s {
            if c.l.is_finite() && c.l < lo {
                lo = c.l;
            }
            if c.h.is_finite() && c.h > hi {
                hi = c.h;
            }
        }
        let cl = candles[end].c;
        let r = hi - lo;
        let kv = if r.abs() < f64::EPSILON {
            50.0
        } else {
            ((cl - lo) / r) * 100.0
        };
        if !kv.is_finite() {
            return empty;
        }
        ks.push(kv);
    }
    let d = ks.iter().sum::<f64>() / ks.len() as f64;
    StochResult {
        k: if k.is_finite() { Some(k) } else { None },
        d: if d.is_finite() { Some(d) } else { None },
    }
}

/// Wilder ADX
pub fn adx(candles: &[Candle], period: usize) -> AdxResult {
    let empty = AdxResult {
        adx: None,
        plus_di: None,
        minus_di: None,
    };
    if candles.len() < period * 2 {
        return empty;
    }
    // Build TR, +DM, -DM series
    let n = candles.len();
    let mut tr: Vec<f64> = vec![0.0; n];
    let mut plus_dm: Vec<f64> = vec![0.0; n];
    let mut minus_dm: Vec<f64> = vec![0.0; n];
    tr[0] = candles[0].h - candles[0].l;
    for i in 1..n {
        let h = candles[i].h;
        let l = candles[i].l;
        let pc = candles[i - 1].c;
        let ph = candles[i - 1].h;
        let pl = candles[i - 1].l;
        tr[i] = (h - l).max((h - pc).abs()).max((l - pc).abs());
        let up = h - ph;
        let down = pl - l;
        plus_dm[i] = if up > down && up > 0.0 { up } else { 0.0 };
        minus_dm[i] = if down > up && down > 0.0 { down } else { 0.0 };
    }
    // Wilder smooth first period
    let mut atr_s: f64 = tr[1..=period].iter().sum();
    let mut p_dm_s: f64 = plus_dm[1..=period].iter().sum();
    let mut m_dm_s: f64 = minus_dm[1..=period].iter().sum();
    let mut dx_vals: Vec<f64> = Vec::new();
    // first DX at index period
    {
        let pdi = if atr_s > 0.0 {
            100.0 * p_dm_s / atr_s
        } else {
            0.0
        };
        let mdi = if atr_s > 0.0 {
            100.0 * m_dm_s / atr_s
        } else {
            0.0
        };
        let sum = pdi + mdi;
        let dx = if sum > 0.0 {
            100.0 * (pdi - mdi).abs() / sum
        } else {
            0.0
        };
        dx_vals.push(dx);
    }
    for i in (period + 1)..n {
        atr_s = atr_s - atr_s / period as f64 + tr[i];
        p_dm_s = p_dm_s - p_dm_s / period as f64 + plus_dm[i];
        m_dm_s = m_dm_s - m_dm_s / period as f64 + minus_dm[i];
        let pdi = if atr_s > 0.0 {
            100.0 * p_dm_s / atr_s
        } else {
            0.0
        };
        let mdi = if atr_s > 0.0 {
            100.0 * m_dm_s / atr_s
        } else {
            0.0
        };
        let sum = pdi + mdi;
        let dx = if sum > 0.0 {
            100.0 * (pdi - mdi).abs() / sum
        } else {
            0.0
        };
        dx_vals.push(dx);
    }
    if dx_vals.len() < period {
        return empty;
    }
    // ADX = Wilder smooth of DX
    let mut adx_val: f64 = dx_vals[..period].iter().sum::<f64>() / period as f64;
    for i in period..dx_vals.len() {
        adx_val = (adx_val * (period as f64 - 1.0) + dx_vals[i]) / period as f64;
    }
    // Final +DI / -DI from last smoothed
    let pdi = if atr_s > 0.0 {
        100.0 * p_dm_s / atr_s
    } else {
        0.0
    };
    let mdi = if atr_s > 0.0 {
        100.0 * m_dm_s / atr_s
    } else {
        0.0
    };
    AdxResult {
        adx: if adx_val.is_finite() { Some(adx_val) } else { None },
        plus_di: if pdi.is_finite() { Some(pdi) } else { None },
        minus_di: if mdi.is_finite() { Some(mdi) } else { None },
    }
}

pub fn support_resistance(candles: &[Candle], lookback: usize) -> SrResult {
    if candles.len() < 5 {
        return SrResult {
            support: None,
            resistance: None,
        };
    }
    let n = lookback.min(candles.len());
    let slice = &candles[candles.len() - n..];
    let mut support = f64::INFINITY;
    let mut resistance = f64::NEG_INFINITY;
    for c in slice {
        if c.l.is_finite() && c.l < support {
            support = c.l;
        }
        if c.h.is_finite() && c.h > resistance {
            resistance = c.h;
        }
    }
    if !support.is_finite() || !resistance.is_finite() {
        return SrResult {
            support: None,
            resistance: None,
        };
    }
    SrResult {
        support: Some(support),
        resistance: Some(resistance),
    }
}

pub fn detect_breakout(candles: &[Candle], lookback: usize) -> BreakoutResult {
    if candles.len() < lookback + 1 {
        return BreakoutResult {
            up: false,
            down: false,
        };
    }
    let prev = &candles[candles.len() - lookback - 1..candles.len() - 1];
    let mut high = f64::NEG_INFINITY;
    let mut low = f64::INFINITY;
    for c in prev {
        if c.h.is_finite() && c.h > high {
            high = c.h;
        }
        if c.l.is_finite() && c.l < low {
            low = c.l;
        }
    }
    let last_c = candles.last().unwrap().c;
    if !last_c.is_finite() || !high.is_finite() {
        return BreakoutResult {
            up: false,
            down: false,
        };
    }
    BreakoutResult {
        up: last_c > high,
        down: last_c < low,
    }
}

pub fn max_drawdown(closes: &[f64]) -> Option<f64> {
    if closes.len() < 2 {
        return None;
    }
    let mut peak = closes[0];
    let mut max_dd = 0.0_f64;
    for &p in closes {
        if !p.is_finite() {
            continue;
        }
        if p > peak {
            peak = p;
        }
        if peak > 0.0 {
            let dd = (peak - p) / peak;
            if dd.is_finite() && dd > max_dd {
                max_dd = dd;
            }
        }
    }
    Some(max_dd * 100.0)
}

pub fn volatility_pct(candles: &[Candle], period: usize) -> Option<f64> {
    let a = atr(candles, period)?;
    let price = candles.last()?.c;
    if !price.is_finite() || price <= 0.0 {
        return None;
    }
    let pct = (a / price) * 100.0;
    if pct.is_finite() {
        Some(pct)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sma_basic() {
        let v = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        assert!((sma(&v, 3).unwrap() - 4.0).abs() < 1e-12);
    }

    #[test]
    fn ema_basic() {
        let v: Vec<f64> = (1..=30).map(|x| x as f64).collect();
        let e = ema(&v, 10).unwrap();
        assert!(e.is_finite());
    }

    #[test]
    fn rsi_flat() {
        let v = vec![100.0; 40];
        assert!((rsi(&v, 14).unwrap() - 50.0).abs() < 1e-9);
    }
}
