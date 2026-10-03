//! Walk-forward path evaluation — parity with logic/backtest.js MFE/MAE / target-stop hits.
//! No look-ahead: only futureSlice bars after entry are inspected.

use crate::types::Candle;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathOutcome {
    /// MFE in percent (2dp style via *100 of fraction*100 → stored as percent points x100/100)
    pub mfe: f64,
    pub mae: f64,
    pub target_hit: bool,
    pub stop_hit: bool,
    pub both_same_bar: bool,
    pub outcome: String,
    pub actual_ret: f64,
    pub actual_dir: String,
    pub target_hit_bar: i32,
    pub stop_hit_bar: i32,
}

fn round_pct_from_frac(frac: f64) -> f64 {
    // JS: Math.round(mfe * 10000) / 100  → percent with 2 decimals
    (frac * 10000.0).round() / 100.0
}

/// Evaluate path after entry on future bars only.
pub fn evaluate_path(
    future_slice: &[Candle],
    entry_price: f64,
    signal: &str,
    target: Option<f64>,
    stop: Option<f64>,
) -> PathOutcome {
    let mut mfe = 0.0_f64;
    let mut mae = 0.0_f64;
    let mut target_hit = false;
    let mut stop_hit = false;
    let mut target_hit_bar: i32 = -1;
    let mut stop_hit_bar: i32 = -1;
    let mut both_same_bar = false;

    let is_buy = signal.eq_ignore_ascii_case("BUY");
    let is_sell = signal.eq_ignore_ascii_case("SELL");

    for (bi, bar) in future_slice.iter().enumerate() {
        let hi = if bar.h.is_finite() { bar.h } else { bar.c };
        let lo = if bar.l.is_finite() { bar.l } else { bar.c };

        if is_buy {
            let fav = (hi - entry_price) / entry_price;
            let adv = (lo - entry_price) / entry_price;
            if fav > mfe {
                mfe = fav;
            }
            if adv < mae {
                mae = adv;
            }
            let hit_t = target.map(|t| hi >= t).unwrap_or(false);
            let hit_s = stop.map(|s| lo <= s).unwrap_or(false);
            if hit_t && hit_s {
                both_same_bar = true;
                stop_hit = true;
                stop_hit_bar = bi as i32;
                break;
            } else if hit_s && !stop_hit {
                stop_hit = true;
                stop_hit_bar = bi as i32;
                break;
            } else if hit_t && !target_hit {
                target_hit = true;
                target_hit_bar = bi as i32;
                break;
            }
        } else if is_sell {
            let fav = (entry_price - lo) / entry_price;
            let adv = (entry_price - hi) / entry_price;
            if fav > mfe {
                mfe = fav;
            }
            if adv < mae {
                mae = adv;
            }
            let hit_t = target.map(|t| lo <= t).unwrap_or(false);
            let hit_s = stop.map(|s| hi >= s).unwrap_or(false);
            if hit_t && hit_s {
                both_same_bar = true;
                stop_hit = true;
                stop_hit_bar = bi as i32;
                break;
            } else if hit_s && !stop_hit {
                stop_hit = true;
                stop_hit_bar = bi as i32;
                break;
            } else if hit_t && !target_hit {
                target_hit = true;
                target_hit_bar = bi as i32;
                break;
            }
        } else {
            let up = (hi - entry_price) / entry_price;
            let dn = (lo - entry_price) / entry_price;
            if up > mfe {
                mfe = up;
            }
            if dn < mae {
                mae = dn;
            }
        }
    }

    let outcome = if target_hit && !stop_hit {
        "target"
    } else if stop_hit && !target_hit {
        "stop"
    } else if both_same_bar {
        "both_stop_first"
    } else if target_hit && stop_hit {
        "both"
    } else {
        "neither"
    };

    let future_close = future_slice
        .last()
        .map(|c| c.c)
        .unwrap_or(entry_price);
    let actual_ret = (future_close - entry_price) / entry_price;
    let actual_dir = if actual_ret.abs() < 0.002 {
        "neutral"
    } else if actual_ret > 0.0 {
        "up"
    } else {
        "down"
    };

    PathOutcome {
        mfe: round_pct_from_frac(mfe),
        mae: round_pct_from_frac(mae),
        target_hit,
        stop_hit,
        both_same_bar,
        outcome: outcome.into(),
        actual_ret,
        actual_dir: actual_dir.into(),
        target_hit_bar,
        stop_hit_bar,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationMetrics {
    pub accuracy: f64,
    pub precision_buy: f64,
    pub recall_buy: f64,
    pub f1_buy: f64,
    pub samples: usize,
}

/// Simple 3-class helpers for BUY vs not — used in regression of metric formulas.
pub fn binary_buy_metrics(preds: &[bool], actuals: &[bool]) -> ClassificationMetrics {
    let n = preds.len().min(actuals.len());
    let mut tp = 0usize;
    let mut fp = 0usize;
    let mut fn_ = 0usize;
    let mut correct = 0usize;
    for i in 0..n {
        if preds[i] == actuals[i] {
            correct += 1;
        }
        if preds[i] && actuals[i] {
            tp += 1;
        } else if preds[i] && !actuals[i] {
            fp += 1;
        } else if !preds[i] && actuals[i] {
            fn_ += 1;
        }
    }
    let precision = if tp + fp > 0 {
        tp as f64 / (tp + fp) as f64
    } else {
        0.0
    };
    let recall = if tp + fn_ > 0 {
        tp as f64 / (tp + fn_) as f64
    } else {
        0.0
    };
    let f1 = if precision + recall > 0.0 {
        2.0 * precision * recall / (precision + recall)
    } else {
        0.0
    };
    ClassificationMetrics {
        accuracy: if n > 0 { correct as f64 / n as f64 } else { 0.0 },
        precision_buy: precision,
        recall_buy: recall,
        f1_buy: f1,
        samples: n,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buy_hits_target() {
        let future = vec![
            Candle {
                o: 100.0,
                h: 105.0,
                l: 99.0,
                c: 104.0,
                v: None,
                ts: None,
                day: None,
            },
        ];
        let o = evaluate_path(&future, 100.0, "BUY", Some(104.0), Some(95.0));
        assert!(o.target_hit);
        assert_eq!(o.outcome, "target");
    }
}
