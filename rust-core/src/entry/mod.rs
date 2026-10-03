//! Entry pure math — parity with logic/entry.js V10.0
//! computeEV, cost model, priorWin, positionSize (Kelly), gates thresholds.

use serde::{Deserialize, Serialize};

pub const ENTRY_MIN_RR: f64 = 1.05;
pub const ENTRY_MIN_EV_R: f64 = -0.08;
pub const MIN_SAMPLES_FOR_KELLY: usize = 30;
pub const DEFAULT_RISK_PCT: f64 = 0.01;

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvResult {
    pub ev_r: Option<f64>,
    pub ev_price: Option<f64>,
    pub net_rr: Option<f64>,
}

/// Expected value in R-units after round-trip cost drag (conservative).
pub fn compute_ev(win_p: f64, reward: f64, risk: f64, cost_frac: f64, price: f64) -> EvResult {
    if !(risk.is_finite() && risk > 0.0 && reward.is_finite() && reward > 0.0 && price.is_finite() && price > 0.0) {
        return EvResult {
            ev_r: None,
            ev_price: None,
            net_rr: None,
        };
    }
    let cost_price = cost_frac * price;
    let net_reward = (reward - cost_price).max(0.0);
    let net_risk = risk + cost_price;
    let loss_p = 1.0 - win_p;
    let ev_price = win_p * net_reward - loss_p * net_risk;
    let ev_r = if net_risk > 0.0 {
        Some(ev_price / net_risk)
    } else {
        None
    };
    let net_rr = if net_risk > 0.0 {
        Some(net_reward / net_risk)
    } else {
        None
    };
    EvResult {
        ev_r: ev_r.map(round2),
        ev_price: Some(round2(ev_price)),
        net_rr: net_rr.map(round2),
    }
}

/// Round-trip cost as fraction of price: 2*spread + 2*slip + 2*commission.
pub fn estimate_cost_frac(
    price: f64,
    atr: Option<f64>,
    spread_pts: f64,
    slip_atr_frac: f64,
    commission_pct: f64,
) -> f64 {
    if !price.is_finite() || price <= 0.0 {
        return 0.0;
    }
    let atr_safe = atr.filter(|a| a.is_finite() && *a > 0.0).unwrap_or(price * 0.01);
    let spread_frac = spread_pts / price;
    let slip_frac = slip_atr_frac * atr_safe / price;
    spread_frac * 2.0 + slip_frac * 2.0 + commission_pct * 2.0
}

/// priorWin dampened by agreement, structure quality, data quality.
pub fn prior_win(
    base_p: f64,
    agreement: f64,
    structure_q: f64,
    data_quality: f64,
) -> f64 {
    let mut p = base_p;
    p += clamp((agreement - 0.5) * 0.08, -0.04, 0.04);
    p += (structure_q - 0.5) * 0.06;
    let dq = clamp(data_quality, 0.2, 1.0);
    let mix = 0.55 + 0.45 * dq;
    p = p * mix + 0.45 * (1.0 - mix);
    clamp(p, 0.26, 0.68)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionSizeResult {
    pub units: Option<f64>,
    pub units_fixed: Option<f64>,
    pub units_kelly: Option<f64>,
    pub kelly_frac: Option<f64>,
    pub note: String,
}

/// Fixed fractional risk; half-Kelly only when hist_samples >= threshold.
pub fn position_size(
    equity: f64,
    risk_pct: f64,
    entry: f64,
    stop: f64,
    win_p: Option<f64>,
    net_rr: Option<f64>,
    hist_samples: usize,
) -> PositionSizeResult {
    if !(equity.is_finite() && equity > 0.0 && entry.is_finite() && stop.is_finite()) {
        return PositionSizeResult {
            units: None,
            units_fixed: None,
            units_kelly: None,
            kelly_frac: None,
            note: "ورودی نامعتبر".into(),
        };
    }
    let dist = (entry - stop).abs();
    if dist <= 0.0 {
        return PositionSizeResult {
            units: None,
            units_fixed: None,
            units_kelly: None,
            kelly_frac: None,
            note: "فاصله ورود/حدصفر".into(),
        };
    }
    let risk_amount = equity * risk_pct.max(0.0);
    let units_fixed = risk_amount / dist;
    let mut kelly_frac = None;
    let mut units_kelly = None;
    let mut note = String::from("کسری ثابت ریسک");

    if hist_samples >= MIN_SAMPLES_FOR_KELLY {
        if let (Some(wp), Some(rr)) = (win_p, net_rr) {
            if rr > 0.0 && wp.is_finite() {
                // Kelly for odds b = netRR: f* = p - (1-p)/b
                let b = rr;
                let f = wp - (1.0 - wp) / b;
                // half-Kelly, capped
                let half = (f * 0.5).clamp(-0.0, 0.25);
                if half > 0.0 {
                    kelly_frac = Some(half);
                    units_kelly = Some((equity * half) / dist);
                    note = "نیمه‌Kelly + سقف".into();
                } else {
                    note = "Kelly منفی — فقط کسری ثابت".into();
                }
            }
        }
    } else {
        note.push_str(" · Kelly غیرفعال (داده تاریخی ناکافی)");
    }

    let units = match units_kelly {
        Some(uk) => Some(units_fixed.min(uk)),
        None => Some(units_fixed),
    };

    PositionSizeResult {
        units,
        units_fixed: Some(units_fixed),
        units_kelly,
        kelly_frac,
        note,
    }
}

/// Gate check: reject if RR or EV below thresholds (soft mode relaxes slightly).
pub fn passes_gates(raw_rr: f64, ev_r: Option<f64>, soft: bool) -> (bool, String) {
    let min_rr = if soft {
        ENTRY_MIN_RR.min(0.95)
    } else {
        ENTRY_MIN_RR
    };
    let min_ev = if soft {
        ENTRY_MIN_EV_R.min(-0.15)
    } else {
        ENTRY_MIN_EV_R
    };
    if raw_rr < min_rr {
        return (false, format!("R:R خام ضعیف ({:.2})", raw_rr));
    }
    if let Some(ev) = ev_r {
        if ev < min_ev {
            return (false, format!("EV خالص منفی/ضعیف ({:.2}R)", ev));
        }
    }
    (true, String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ev_basic() {
        let e = compute_ev(0.5, 20.0, 10.0, 0.0, 100.0);
        // 0.5*20 - 0.5*10 = 5; evR = 5/10 = 0.5
        assert!((e.ev_r.unwrap() - 0.5).abs() < 0.02);
        assert!((e.net_rr.unwrap() - 2.0).abs() < 0.02);
    }

    #[test]
    fn kelly_disabled_without_samples() {
        let p = position_size(10000.0, 0.01, 100.0, 95.0, Some(0.55), Some(1.5), 5);
        assert!(p.kelly_frac.is_none());
        assert!(p.note.contains("Kelly"));
    }
}
