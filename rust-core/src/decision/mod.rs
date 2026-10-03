//! Decision score combination — parity with CONFIG thresholds in logic/decision.js / config.js
//! Full ensemble/strategy orchestration stays in TypeScript; pure arithmetic lives here.

use serde::{Deserialize, Serialize};

pub const BUY_THRESHOLD: f64 = 57.0;
pub const SELL_THRESHOLD: f64 = 43.0;
pub const TECH_WEIGHT: f64 = 0.7;
pub const FUND_WEIGHT: f64 = 0.3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Signal {
    Buy,
    Sell,
    Hold,
}

impl Signal {
    pub fn as_str(&self) -> &'static str {
        match self {
            Signal::Buy => "BUY",
            Signal::Sell => "SELL",
            Signal::Hold => "HOLD",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombinedDecision {
    pub signal: Signal,
    pub combined_score: f64,
    pub technical_score: f64,
    pub fundamental_score: Option<f64>,
    pub fundamental_applied: bool,
    pub confidence: f64,
}

/// Combine technical + optional fundamental (only when fund.ok).
/// Matches: combined = 0.7 * tech + 0.3 * fund when fund present, else tech alone.
pub fn combine_scores(technical: f64, fundamental: Option<f64>) -> f64 {
    let t = technical.clamp(0.0, 100.0);
    match fundamental {
        Some(f) if f.is_finite() => {
            let f = f.clamp(0.0, 100.0);
            TECH_WEIGHT * t + FUND_WEIGHT * f
        }
        _ => t,
    }
}

/// Map combined score to BUY / SELL / HOLD using calibrated thresholds 57 / 43.
pub fn signal_from_score(combined: f64) -> Signal {
    if combined >= BUY_THRESHOLD {
        Signal::Buy
    } else if combined <= SELL_THRESHOLD {
        Signal::Sell
    } else {
        Signal::Hold
    }
}

/// Confidence: 0.5 + |combined−50|/100 then clamp-friendly range.
pub fn base_confidence(combined: f64) -> f64 {
    let c = 0.5 + (combined - 50.0).abs() / 100.0;
    c.clamp(0.25, 0.95)
}

pub fn decide(technical: f64, fundamental: Option<f64>) -> CombinedDecision {
    let combined = combine_scores(technical, fundamental);
    let signal = signal_from_score(combined);
    let confidence = base_confidence(combined);
    CombinedDecision {
        signal,
        combined_score: (combined * 100.0).round() / 100.0,
        technical_score: technical,
        fundamental_score: fundamental,
        fundamental_applied: fundamental.is_some(),
        confidence: (confidence * 1000.0).round() / 1000.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thresholds() {
        assert_eq!(signal_from_score(57.0), Signal::Buy);
        assert_eq!(signal_from_score(43.0), Signal::Sell);
        assert_eq!(signal_from_score(50.0), Signal::Hold);
    }

    #[test]
    fn combine_with_fund() {
        let c = combine_scores(60.0, Some(40.0));
        // 0.7*60 + 0.3*40 = 42+12 = 54
        assert!((c - 54.0).abs() < 1e-9);
    }
}
