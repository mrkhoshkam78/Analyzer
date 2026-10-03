//! Multi-day forecast path — parity with logic/forecastPath.js v12.1.0
//! Default horizon: 7 days.

use crate::indicators::atr;
use crate::types::Candle;
use serde::{Deserialize, Serialize};

pub const DEFAULT_HORIZON_DAYS: u32 = 7;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForecastBar {
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub ts: i64,
    pub conf: f64,
    pub dir: f64,
    pub day_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaySummary {
    pub day: u32,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub change_pct: f64,
    pub confidence: f64,
    pub signal: String,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForecastPath {
    pub horizon_days: u32,
    pub horizon_bars: u32,
    pub future: Vec<ForecastBar>,
    pub days: Vec<DaySummary>,
    pub direction: String,
    pub total_move: f64,
    pub atr: f64,
    pub confidence: f64,
}

pub fn horizon_days_to_bars(timeframe: &str, days: u32) -> u32 {
    let d = days.clamp(1, 30);
    match timeframe.to_uppercase().as_str() {
        "1H" => d * 24,
        "4H" => d * 6,
        "1W" => d.div_ceil(7).max(1),
        _ => d,
    }
}

fn tf_ms(timeframe: &str) -> i64 {
    match timeframe.to_uppercase().as_str() {
        "1H" => 3_600_000,
        "4H" => 14_400_000,
        "1W" => 604_800_000,
        _ => 86_400_000,
    }
}

/// Build projected path for `horizon_days` (default 7).
pub fn build_forecast_path(
    hist: &[Candle],
    signal: &str,
    target: Option<f64>,
    confidence: Option<f64>,
    atr_in: Option<f64>,
    timeframe: &str,
    horizon_days: u32,
) -> ForecastPath {
    let empty = ForecastPath {
        horizon_days: 0,
        horizon_bars: 0,
        future: vec![],
        days: vec![],
        direction: "HOLD".into(),
        total_move: 0.0,
        atr: 0.0,
        confidence: 0.5,
    };
    if hist.is_empty() {
        return empty;
    }
    let last = hist.last().unwrap();
    let close = last.c;
    if !close.is_finite() || close <= 0.0 {
        return empty;
    }

    let days = horizon_days.clamp(1, 30);
    let n_future = horizon_days_to_bars(timeframe, days) as usize;

    let mut atr_v = atr_in.filter(|a| a.is_finite() && *a > 0.0).or_else(|| atr(hist, 14));
    if atr_v.is_none() {
        let slice = if hist.len() > 20 { &hist[hist.len() - 20..] } else { hist };
        let mut sum = 0.0;
        let mut n = 0;
        for c in slice {
            let r = c.h - c.l;
            if r.is_finite() && r > 0.0 {
                sum += r;
                n += 1;
            }
        }
        atr_v = Some(if n > 0 { sum / n as f64 } else { close * 0.004 });
    }
    let atr_v = atr_v.unwrap().max(close * 0.0008);

    let sig = signal.to_uppercase();
    let conf0 = confidence
        .filter(|c| c.is_finite())
        .map(|c| c.clamp(0.2, 1.0))
        .unwrap_or(0.5);

    let mut dir = 0.0_f64;
    if sig == "BUY" {
        dir = 1.0;
    } else if sig == "SELL" {
        dir = -1.0;
    } else if let Some(t) = target {
        if t > close {
            dir = 0.35;
        } else if t < close {
            dir = -0.35;
        }
    }

    let total_move = if let Some(t) = target {
        if t != close && dir != 0.0 {
            let to_target = t - close;
            if (dir > 0.0 && to_target < 0.0) || (dir < 0.0 && to_target > 0.0) {
                dir * atr_v * (1.2 + conf0)
            } else {
                to_target * (0.5 + 0.35 * conf0)
            }
        } else if dir != 0.0 {
            dir * atr_v * (1.15 + conf0 * 1.35) * (days as f64 / 5.0).sqrt()
        } else {
            0.0
        }
    } else if dir != 0.0 {
        dir * atr_v * (1.15 + conf0 * 1.35) * (days as f64 / 5.0).sqrt()
    } else {
        0.0
    };

    let step = tf_ms(timeframe);
    let last_ts = last.ts.unwrap_or(0);
    let mut future = Vec::with_capacity(n_future);
    let mut px = close;

    for i in 1..=n_future {
        let progress = i as f64 / n_future as f64;
        let eased = 1.0 - (1.0 - progress).powf(1.35);
        let dest = close + total_move * eased;
        let o = px;
        let mut c = dest;
        if dir > 0.0 && c < o {
            c = o + atr_v.abs() * 0.05;
        }
        if dir < 0.0 && c > o {
            c = o - atr_v.abs() * 0.05;
        }
        if dir == 0.0 {
            c = o + atr_v * 0.08 * (i as f64 * 2.1).sin();
        }
        let body = (c - o).abs();
        let wick = (atr_v * 0.25).max(body * 0.35);
        let h = o.max(c) + wick * 0.55;
        let l = o.min(c) - wick * 0.55;
        let conf = (conf0 * (1.0 - progress * 0.32)).max(0.2);
        future.push(ForecastBar {
            o,
            h,
            l,
            c,
            ts: last_ts + i as i64 * step,
            conf,
            dir,
            day_index: i as u32,
        });
        px = c;
    }

    let days_sum = summarize_by_day(&future, days, close, conf0, &sig);

    ForecastPath {
        horizon_days: days,
        horizon_bars: n_future as u32,
        future,
        days: days_sum,
        direction: sig,
        total_move,
        atr: atr_v,
        confidence: conf0,
    }
}

fn summarize_by_day(
    future: &[ForecastBar],
    horizon_days: u32,
    entry: f64,
    conf0: f64,
    signal: &str,
) -> Vec<DaySummary> {
    if future.is_empty() {
        return vec![];
    }
    let n = future.len();
    let mut out = Vec::new();
    for d in 1..=horizon_days {
        let end_idx = ((d as f64 / horizon_days as f64) * n as f64).ceil() as usize;
        let end_idx = end_idx.min(n).saturating_sub(1);
        let start_idx = ((((d - 1) as f64 / horizon_days as f64) * n as f64).ceil() as usize).min(n.saturating_sub(1));
        if start_idx > end_idx {
            continue;
        }
        let slice = &future[start_idx..=end_idx];
        if slice.is_empty() {
            continue;
        }
        let last_c = slice.last().unwrap();
        let hi = slice.iter().map(|x| x.h).fold(f64::NEG_INFINITY, f64::max);
        let lo = slice.iter().map(|x| x.l).fold(f64::INFINITY, f64::min);
        let mid = last_c.c;
        let change_pct = ((mid - entry) / entry) * 100.0;
        out.push(DaySummary {
            day: d,
            open: slice[0].o,
            high: hi,
            low: lo,
            close: mid,
            change_pct: (change_pct * 100.0).round() / 100.0,
            confidence: (conf0 * (1.0 - (d as f64 / horizon_days as f64) * 0.32)).max(0.2),
            signal: signal.to_string(),
            ts: last_c.ts,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seven_days_one_d() {
        assert_eq!(horizon_days_to_bars("1D", 7), 7);
        assert_eq!(horizon_days_to_bars("4H", 7), 42);
    }

    #[test]
    fn path_length() {
        let hist: Vec<Candle> = (0..40)
            .map(|i| {
                let c = 2000.0 + i as f64;
                Candle {
                    o: c,
                    h: c + 2.0,
                    l: c - 2.0,
                    c,
                    v: None,
                    ts: Some(1_700_000_000_000 + i * 86_400_000),
                    day: None,
                }
            })
            .collect();
        let p = build_forecast_path(&hist, "BUY", Some(2050.0), Some(0.6), None, "1D", 7);
        assert_eq!(p.horizon_days, 7);
        assert_eq!(p.future.len(), 7);
        assert_eq!(p.days.len(), 7);
    }
}
