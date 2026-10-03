//! Technical scoring engine — parity with logic/technical.js v11.6.0
//! Scores 0–100 from indicator components with fixed weights.

use crate::indicators::{
    adx, atr, bollinger, detect_breakout, ema, macd, max_drawdown, momentum, roc, rsi,
    stochastic, support_resistance, volatility_pct,
};
use crate::types::{periods, Candle, MacdConfig};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Factor {
    pub key: String,
    pub dir: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechWeights {
    pub trend: f64,
    pub momentum: f64,
    pub rsi: f64,
    pub macd: f64,
    pub volatility: f64,
    pub structure: f64,
    pub volume: f64,
}

impl Default for TechWeights {
    fn default() -> Self {
        Self {
            trend: 22.0,
            momentum: 18.0,
            rsi: 14.0,
            macd: 14.0,
            volatility: 10.0,
            structure: 12.0,
            volume: 10.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TechnicalResult {
    pub ok: bool,
    pub error: Option<String>,
    pub score: Option<i32>,
    pub trend: Option<String>,
    pub trend_score: Option<f64>,
    pub factors: Vec<Factor>,
    pub overbought: bool,
    pub oversold: bool,
    /// Flattened key indicator values for regression
    pub rsi: Option<f64>,
    pub ema20: Option<f64>,
    pub ema50: Option<f64>,
    pub atr: Option<f64>,
    pub macd_line: Option<f64>,
    pub macd_signal: Option<f64>,
    pub macd_hist: Option<f64>,
    pub support: Option<f64>,
    pub resistance: Option<f64>,
}

const MIN_CANDLES: usize = 30;
const HIGH_VOL_PCT: f64 = 7.0;
const LOW_VOL_PCT: f64 = 3.0;

fn push_factor(factors: &mut Vec<Factor>, key: &str, dir: &str, text: &str) {
    factors.push(Factor {
        key: key.to_string(),
        dir: dir.to_string(),
        text: text.to_string(),
    });
}

/// Run technical analysis — mirrors `runTechnical` scoring rules.
pub fn run_technical(
    candles: &[Candle],
    current_price: Option<f64>,
    macd_cfg: Option<MacdConfig>,
) -> TechnicalResult {
    if candles.len() < MIN_CANDLES {
        return TechnicalResult {
            ok: false,
            error: Some(format!(
                "حداقل {} کندل برای تحلیل تکنیکال لازم است.",
                MIN_CANDLES
            )),
            score: None,
            trend: None,
            trend_score: None,
            factors: vec![],
            overbought: false,
            oversold: false,
            rsi: None,
            ema20: None,
            ema50: None,
            atr: None,
            macd_line: None,
            macd_signal: None,
            macd_hist: None,
            support: None,
            resistance: None,
        };
    }

    let cfg = macd_cfg.unwrap_or_default();
    let closes: Vec<f64> = candles.iter().map(|c| c.c).collect();
    let price = match current_price {
        Some(p) if p.is_finite() && p > 0.0 => p,
        _ => *closes.last().unwrap(),
    };

    let e20 = ema(&closes, periods::SMA_FAST);
    let e50 = ema(&closes, periods::SMA_SLOW);
    let r = rsi(&closes, periods::RSI);
    let m = macd(&closes, &cfg);
    let a = atr(candles, periods::ATR);
    let mom = momentum(&closes, periods::MOMENTUM);
    let _roc_val = roc(&closes, periods::ROC);
    let bb = bollinger(&closes, periods::BB, periods::BB_STD);
    let stoch = stochastic(candles, periods::STOCH_K, periods::STOCH_D);
    let adx_res = adx(candles, periods::ADX);
    let sr = support_resistance(candles, periods::LOOKBACK_SR);
    let brk = detect_breakout(candles, 20);
    let _dd = max_drawdown(&closes);
    let vol_pct = volatility_pct(candles, 20);

    let mut factors: Vec<Factor> = Vec::new();
    let mut trend_score: f64 = 50.0;
    let mut mom_score: f64 = 50.0;
    let mut rsi_score: f64 = 50.0;
    let mut macd_score: f64 = 50.0;
    let mut vol_score: f64 = 50.0;
    let mut struct_score: f64 = 50.0;
    let volume_score: f64 = 50.0; // volume often unavailable offline → neutral

    // Trend
    let mut trend_label = "Neutral".to_string();
    if let (Some(e20v), Some(e50v)) = (e20, e50) {
        if price > e20v && price > e50v && e20v > e50v {
            trend_score = 78.0;
            trend_label = "Strong Bullish".into();
            push_factor(&mut factors, "trend", "bull", "روند: صعودی قوی 🔺");
        } else if price < e20v && price < e50v && e20v < e50v {
            trend_score = 22.0;
            trend_label = "Strong Bearish".into();
            push_factor(&mut factors, "trend", "bear", "روند: نزولی قوی 🔻");
        } else if price > e50v {
            trend_score = 65.0;
            trend_label = "Bullish".into();
            push_factor(&mut factors, "trend", "bull", "روند: صعودی");
        } else if price < e50v {
            trend_score = 35.0;
            trend_label = "Bearish".into();
            push_factor(&mut factors, "trend", "bear", "روند: نزولی");
        }
    }

    if let Some(adx_v) = adx_res.adx {
        let pdi = adx_res.plus_di.unwrap_or(0.0);
        let mdi = adx_res.minus_di.unwrap_or(0.0);
        if adx_v >= 25.0 {
            let dir = if pdi > mdi { "bull" } else { "bear" };
            push_factor(
                &mut factors,
                "adx",
                dir,
                &format!("قدرت روند ADX={:.1}", adx_v),
            );
            if pdi > mdi {
                trend_score = (trend_score + 6.0).min(100.0);
            } else {
                trend_score = (trend_score - 6.0).max(0.0);
            }
        } else {
            push_factor(&mut factors, "adx", "neutral", "روند: خنثی / ضعیف");
        }
    }

    // RSI
    if let Some(rv) = r {
        if rv < 30.0 {
            rsi_score = 78.0;
            push_factor(&mut factors, "rsi", "bull", "RSI: اشباع فروش");
        } else if rv > 70.0 {
            rsi_score = 22.0;
            push_factor(&mut factors, "rsi", "bear", "RSI: اشباع خرید");
        } else if rv < 45.0 {
            rsi_score = 58.0;
        } else if rv > 55.0 {
            rsi_score = 42.0;
        }
    }

    // MACD
    if let Some(macd_v) = m.macd {
        let hist = m.hist;
        if hist.map(|h| h > 0.0).unwrap_or(false) || (macd_v > 0.0 && hist.map(|h| h >= 0.0).unwrap_or(true)) {
            macd_score = 68.0;
            push_factor(&mut factors, "macd", "bull", "مومنتوم: صعودی 🔺");
        } else if macd_v < 0.0 {
            macd_score = 32.0;
            push_factor(&mut factors, "macd", "bear", "مومنتوم: نزولی 🔻");
        }
    }

    // Momentum
    if let Some(mv) = mom {
        if mv > 2.0 {
            mom_score = 68.0;
            push_factor(&mut factors, "momentum", "bull", "مومنتوم: مثبت");
        } else if mv < -2.0 {
            mom_score = 32.0;
            push_factor(&mut factors, "momentum", "bear", "مومنتوم: منفی");
        }
    }

    // Bollinger pctB
    if let Some(pct_b) = bb.pct_b {
        if pct_b < 0.1 {
            push_factor(&mut factors, "bb", "bull", "نزدیک کف نوسان");
            mom_score = (mom_score + 5.0).min(100.0);
        } else if pct_b > 0.9 {
            push_factor(&mut factors, "bb", "bear", "نزدیک سقف نوسان");
            mom_score = (mom_score - 5.0).max(0.0);
        }
    }

    // Stochastic
    if let Some(k) = stoch.k {
        if k < 20.0 {
            push_factor(&mut factors, "stoch", "bull", "استوکاستیک: اشباع فروش");
            rsi_score = (rsi_score + 4.0).min(100.0);
        } else if k > 80.0 {
            push_factor(&mut factors, "stoch", "bear", "استوکاستیک: اشباع خرید");
            rsi_score = (rsi_score - 4.0).max(0.0);
        }
    }

    // Structure: S/R + breakout
    if let (Some(sup), Some(res)) = (sr.support, sr.resistance) {
        let mid = (sup + res) / 2.0;
        if price <= sup * 1.005 {
            struct_score = 72.0;
            push_factor(&mut factors, "structure", "bull", "نزدیک حمایت");
        } else if price >= res * 0.995 {
            struct_score = 28.0;
            push_factor(&mut factors, "structure", "bear", "نزدیک مقاومت");
        } else if price > mid {
            struct_score = 58.0;
        } else {
            struct_score = 42.0;
        }
    }
    if brk.up {
        struct_score = (struct_score + 12.0).min(100.0);
        push_factor(&mut factors, "breakout", "bull", "شکست صعودی");
    } else if brk.down {
        struct_score = (struct_score - 12.0).max(0.0);
        push_factor(&mut factors, "breakout", "bear", "شکست نزولی");
    }
    struct_score = struct_score.clamp(0.0, 100.0);

    // Volatility
    if let Some(vp) = vol_pct {
        if vp > HIGH_VOL_PCT {
            vol_score = 35.0;
            push_factor(&mut factors, "volatility", "bear", "نوسان بالا");
        } else if vp < LOW_VOL_PCT {
            vol_score = 58.0;
            push_factor(&mut factors, "volatility", "neutral", "نوسان پایین");
        }
    }

    let w = TechWeights::default();
    let denom = w.trend + w.momentum + w.rsi + w.macd + w.volatility + w.structure + w.volume;
    let score = (trend_score * w.trend
        + mom_score * w.momentum
        + rsi_score * w.rsi
        + macd_score * w.macd
        + vol_score * w.volatility
        + struct_score * w.structure
        + volume_score * w.volume)
        / denom;
    let technical_score = score.clamp(0.0, 100.0).round() as i32;

    let mut overbought = r.map(|x| x > 70.0).unwrap_or(false);
    let mut oversold = r.map(|x| x < 30.0).unwrap_or(false);
    if let Some(k) = stoch.k {
        if k > 80.0 {
            overbought = true;
        }
        if k < 20.0 {
            oversold = true;
        }
    }

    TechnicalResult {
        ok: true,
        error: None,
        score: Some(technical_score),
        trend: Some(trend_label),
        trend_score: Some(trend_score),
        factors,
        overbought,
        oversold,
        rsi: r,
        ema20: e20,
        ema50: e50,
        atr: a,
        macd_line: m.macd,
        macd_signal: m.signal,
        macd_hist: m.hist,
        support: sr.support,
        resistance: sr.resistance,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_candles(n: usize) -> Vec<Candle> {
        (0..n)
            .map(|i| {
                let c = 100.0 + (i as f64) * 0.5;
                Candle {
                    o: c - 0.2,
                    h: c + 1.0,
                    l: c - 1.0,
                    c,
                    v: Some(1000.0),
                    ts: None,
                    day: None,
                }
            })
            .collect()
    }

    #[test]
    fn technical_runs_on_enough_bars() {
        let c = sample_candles(60);
        let r = run_technical(&c, None, None);
        assert!(r.ok);
        assert!(r.score.is_some());
    }

    #[test]
    fn technical_rejects_short_series() {
        let c = sample_candles(10);
        let r = run_technical(&c, None, None);
        assert!(!r.ok);
    }
}
