//! Shared types for OMA Rust core

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candle {
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    #[serde(default)]
    pub v: Option<f64>,
    #[serde(default)]
    pub ts: Option<i64>,
    #[serde(default)]
    pub day: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacdConfig {
    pub fast: usize,
    pub slow: usize,
    pub signal: usize,
}

impl Default for MacdConfig {
    fn default() -> Self {
        Self {
            fast: 12,
            slow: 26,
            signal: 9,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacdResult {
    pub macd: Option<f64>,
    pub signal: Option<f64>,
    pub hist: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BollingerResult {
    pub mid: Option<f64>,
    pub upper: Option<f64>,
    pub lower: Option<f64>,
    pub pct_b: Option<f64>,
    pub width: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StochResult {
    pub k: Option<f64>,
    pub d: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdxResult {
    pub adx: Option<f64>,
    pub plus_di: Option<f64>,
    pub minus_di: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SrResult {
    pub support: Option<f64>,
    pub resistance: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakoutResult {
    pub up: bool,
    pub down: bool,
}

/// Default periods matching JS CONFIG
pub mod periods {
    pub const RSI: usize = 14;
    pub const ATR: usize = 14;
    pub const SMA_FAST: usize = 20;
    pub const SMA_SLOW: usize = 50;
    pub const EMA_FAST: usize = 12;
    pub const EMA_SLOW: usize = 26;
    pub const EMA_SIGNAL: usize = 9;
    pub const MOMENTUM: usize = 10;
    pub const ROC: usize = 12;
    pub const BB: usize = 20;
    pub const BB_STD: f64 = 2.0;
    pub const STOCH_K: usize = 14;
    pub const STOCH_D: usize = 3;
    pub const ADX: usize = 14;
    pub const LOOKBACK_SR: usize = 20;
    pub const VOLUME_AVG: usize = 20;
}
