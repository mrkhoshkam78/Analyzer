# Offline Market Analyzer (OMA)

**Baseline:** v11.6.0 · **Migration:** v12.0.0 (TypeScript + Rust core)

## Quick start

### Original JS (parity baseline)

```bash
# any static server from repo root
npx --yes serve .
# open http://localhost:3000/index-legacy.html
```

### TypeScript migration (Vite)

```bash
npm install
npm run dev
# open the printed localhost URL
```

### Regression (no build required)

```bash
node tests/regression/indicators_baseline.mjs
node tests/regression/compare_ts_js.mjs
```

### Rust analytics core

```bash
cd rust-core
cargo test
# WASM (optional):
cargo build --release --target wasm32-unknown-unknown --features wasm
```

### Fundamental proxy

```bash
cd server && npm install   # if needed
EODHD_API_TOKEN=... node index.js   # :3847
```

## Docs

- `docs/PHASE0_AUDIT.md` — full audit & dependency map  
- `docs/MIGRATION_STATUS.md` — migration progress, tests, architecture  

## Data

CSV under `data/` (and `public/data/` for Vite): XAUUSD & BRENT × 1D / 4H / 1H.

## پیش‌بینی ۷روزه (v12.1.0)

- CONFIG.forecastHorizonDays = 7 (و defaultHorizonBars = 7)
- مسیر روزانه: result.forecast7d و prediction.dailyPath
- نمودار کندل + پنل ۷روزه در UI
- Rust: rust-core/src/prediction
- تست: node tests/regression/forecast_7day.mjs

## Accuracy enhancements (v12.2.0)

- Probabilistic calibration (score → P_up / P_down)
- Quality gates: ADX, regime, MTF, confidence, agreement, event risk, EV
- Layered 7-day forecast: tight days 1–2, wide range days 5–7
- Dual backtest metrics: all signals vs high-quality filtered
- MPB: resolveMatchWeights for walk-forward learned blends
- Tests: node tests/regression/accuracy_v12_2.mjs
