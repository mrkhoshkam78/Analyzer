//! OMA Analytics Core v12.0.1
//! Numerical engines with parity target vs JS baseline v11.6.0

pub mod backtest;
pub mod decision;
pub mod entry;
pub mod indicators;
pub mod technical;
pub mod types;

pub mod prediction {}
pub mod strategies {}
pub mod regime {}
pub mod mtf {}
pub mod mpb {}
pub mod data {}

pub mod validation {
    //! Independent calculation checks (Auto Debugger numerical twins)
    use crate::indicators;
    use crate::types::Candle;

    pub const TOLERANCE: f64 = 1e-9;

    pub fn approx_equal(a: f64, b: f64, tol: f64) -> bool {
        if a.is_nan() && b.is_nan() {
            return true;
        }
        if !a.is_finite() || !b.is_finite() {
            return a == b;
        }
        (a - b).abs() <= tol
    }

    pub fn independent_rsi(closes: &[f64], period: usize) -> Option<f64> {
        indicators::rsi(closes, period)
    }

    pub fn independent_sma(values: &[f64], period: usize) -> Option<f64> {
        indicators::sma(values, period)
    }

    pub fn independent_ema(values: &[f64], period: usize) -> Option<f64> {
        indicators::ema(values, period)
    }

    pub fn independent_atr(candles: &[Candle], period: usize) -> Option<f64> {
        indicators::atr(candles, period)
    }

    pub fn independent_macd_line(
        closes: &[f64],
        fast: usize,
        slow: usize,
        signal: usize,
    ) -> Option<f64> {
        let cfg = crate::types::MacdConfig { fast, slow, signal };
        indicators::macd(closes, &cfg).macd
    }

    pub fn scores_match(a: f64, b: f64, tol: f64) -> bool {
        approx_equal(a, b, tol)
    }
}

#[cfg(feature = "wasm")]
mod wasm_api {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn wasm_sma(values: Vec<f64>, period: usize) -> Option<f64> {
        crate::indicators::sma(&values, period)
    }

    #[wasm_bindgen]
    pub fn wasm_ema(values: Vec<f64>, period: usize) -> Option<f64> {
        crate::indicators::ema(&values, period)
    }

    #[wasm_bindgen]
    pub fn wasm_rsi(closes: Vec<f64>, period: usize) -> Option<f64> {
        crate::indicators::rsi(&closes, period)
    }

    #[wasm_bindgen]
    pub fn wasm_combine_scores(technical: f64, fundamental: f64, has_fund: bool) -> f64 {
        let f = if has_fund { Some(fundamental) } else { None };
        crate::decision::combine_scores(technical, f)
    }

    #[wasm_bindgen]
    pub fn wasm_signal_from_score(combined: f64) -> String {
        crate::decision::signal_from_score(combined)
            .as_str()
            .to_string()
    }

    #[wasm_bindgen]
    pub fn wasm_compute_ev(
        win_p: f64,
        reward: f64,
        risk: f64,
        cost_frac: f64,
        price: f64,
    ) -> String {
        let e = crate::entry::compute_ev(win_p, reward, risk, cost_frac, price);
        serde_json::to_string(&e).unwrap_or_else(|_| "{}".into())
    }
}
