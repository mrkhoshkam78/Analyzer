# PHASE 0 — Full Project Audit
**Offline Market Analyzer (OMA) v11.6.0**  
**Date:** 2026-10-03  
**Repo:** https://github.com/mrkhoshkam78/Analyzer.git

---

## 1. Project Overview

| Item | Value |
|------|--------|
| Version | v11.6.0 |
| Type | Offline browser Market Analyzer (ES modules) |
| UI | RTL Persian, dual theme (dark/light), dual skin |
| Data | Local CSV (XAUUSD, BRENT) + manual prices (localStorage) |
| Backend | Optional Node proxy for EODHD fundamental macro data |
| Worker | `logic/worker.js` (minimal stub) |

---

## 2. File Structure (Current)

```
Analyzer/
├── index.html          (717 lines) — full UI shell, DOM IDs
├── app.js              (2833 lines) — UI controller / orchestration
├── styles.css          (3698 lines) — Terminal Glass + Vector Soft skins
├── logic/
│   ├── analysis.js     — parseOHLCV, analyze() orchestrator
│   ├── autoDebugger.js (2475) — regression, diagnostics, correction log
│   ├── backtest.js     — walk-forward, strategy backtests
│   ├── calendar.js
│   ├── config.js       — CONFIG (thresholds, weights, periods)
│   ├── context.js
│   ├── datasets.js     (854) — historical/manual storage, series build
│   ├── decision.js     — combined score → BUY/SELL/HOLD
│   ├── entry.js        (985) — Entry Engine V10.0 (EV, Kelly, confluence)
│   ├── fundamental.js  — fundamental score + EODHD client
│   ├── indicatorConfig.js — adaptive MACD/Fib per asset×TF
│   ├── indicators.js   (443) — pure RSI/SMA/EMA/MACD/ATR/...
│   ├── learning.js
│   ├── marketData.js
│   ├── mtf.js          — multi-timeframe agreement
│   ├── prediction.js
│   ├── providers.js
│   ├── regime.js
│   ├── storage.js      — localStorage helpers
│   ├── strategies.js   (689)
│   ├── symbols.js
│   ├── technical.js    — technical scoring engine
│   ├── worker.js
│   ├── xauusd_seed.js / brent_seed.js
│   └── mpb/
│       ├── index.js    — runMPB orchestrator
│       ├── dataQuality.js
│       ├── evidence.js
│       ├── features.js
│       ├── matching.js — analogue search
│       ├── memory.js   — pattern store
│       └── regime.js
├── data/
│   ├── XAUUSD/{1d,1h,4h}.csv
│   └── BRENT/{1d,1h,4h}.csv
├── server/
│   ├── index.js        — EODHD proxy :3847
│   ├── package.json
│   └── render.yaml
└── assets/zen/*
```

---

## 3. Dependency Map

```
app.js
 ├─ symbols.js
 ├─ datasets.js → storage.js, symbols.js, calendar.js, config.js
 ├─ autoDebugger.js → technical, fundamental, decision, prediction, indicators, storage, config
 └─ (dynamic / inline) analysis, decision, entry, backtest, mpb, strategies, mtf, regime

analysis.js
 ├─ decision.js
 ├─ prediction.js
 ├─ indicators.js
 └─ mpb/index.js

technical.js
 ├─ config.js
 ├─ indicatorConfig.js → symbols.js
 └─ indicators.js

decision.js
 ├─ technical.js
 ├─ fundamental.js
 ├─ config.js
 └─ entry.js (optional path)

entry.js
 ├─ config.js, indicators.js, technical, mtf, regime

mpb/index.js
 ├─ dataQuality, features, regime, matching, evidence, memory
 └─ indicators.js

backtest.js → decision, strategies, technical, config
strategies.js → indicators, technical, config
regime.js → indicators, config
mtf.js → technical, config
```

---

## 4. Migration Classification

### → TypeScript (Application / UI / Orchestration)

| Module | Reason |
|--------|--------|
| app.js | DOM, events, tabs, toasts, orchestration |
| symbols.js | Symbol registry, formatting |
| datasets.js | Storage orchestration, CSV load paths |
| storage.js | localStorage adapter |
| calendar.js | Day index / bias |
| context.js | UI context |
| providers.js | Data provider abstraction |
| marketData.js | Data loading |
| fundamental.js (client) | API client + scoring UI side |
| learning.js | Prediction learning persistence |
| autoDebugger.js (UI/report) | Report rendering, history, user interaction |
| worker.js | Worker bootstrap |
| server (Node) | EODHD proxy — keep Node/TS |

### → Rust Core (Numerical / Analytics)

| Module / Function | Reason |
|-------------------|--------|
| indicators.js (all pure fns) | RSI, SMA, EMA, MACD, ATR, Momentum, ROC, BB, Stoch, ADX, S/R, Fib, Vol, DD, Breakout |
| technical.js scoring math | Deterministic score components |
| backtest core loops | Walk-forward numerical |
| decision score combine | Pure arithmetic |
| entry EV / R:R / Kelly math | Critical financial calc |
| mpb/features, matching, regime | Feature vectors, similarity, regime detect |
| autoDebugger independent* checks | Numerical validation twins |
| data validation / OHLC normalize | Consistency |

### Hybrid (TS orchestration + Rust compute)

| Area | TS | Rust |
|------|----|------|
| MPB | memory I/O, runMPB orchestration | features, matching, regime, evidence math |
| Auto Debugger | reports, history, events, UI | independent RSI/SMA/EMA/MACD, approxEqual, invariants |
| Fundamental | EODHD fetch, cache, UI | score formula (optional) |
| Strategies | selection / UI | signal generation math |

---

## 5. Data Contracts (must preserve)

### Candle
```ts
{ o: number, h: number, l: number, c: number, v?: number, ts?: number, day?: string, t?: string }
```

### CSV formats
- Daily: `<DATE> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> <VOL> <SPREAD>` (MT5 `YYYY.MM.DD`)
- Intraday: adds `<TIME>`

### Storage keys (localStorage)
- Historical / manual prices per symbol×tf
- Fundamental cache `oma_v6_fund_cache`
- Theme `oma_theme`, skin `oma_skin`, lang `oma_lang`
- Debug memory / regression memory / correction log
- Backtest results, predictions, MPB patterns

### CONFIG (frozen)
- Periods: RSI14, ATR14, SMA20/50, EMA12/26/9, Mom10, ROC12, BB20±2, Stoch14/3, ADX14
- Thresholds: buy 57 / sell 43
- Weights: tech (trend22, mom18, rsi14, macd14, vol10, struct12, volume10)
- Engine: tech 0.7 / fund 0.3
- Entry V10.0 gates

---

## 6. Critical DOM IDs (must not break)

Clock, toast, symbol select, TF tabs, paste/upload/manual entry panels, result panels, backtest dashboard, auto-debugger metrics (`adTests`, `adPassed`, `adFailed`, …), fundamental inputs, entry result, prediction cards, add-asset dialog, theme/skin toggles.

---

## 7. Risks & Constraints

1. **Financial calc safety** — any indicator change requires golden regression vs JS baseline.
2. **No file://** — data fetch needs HTTP server.
3. **Auto Debugger** is large (2475 LOC) and must not be simplified away.
4. **MPB memory** uses localStorage — keep in TS.
5. **Seed data** (xauusd_seed / brent_seed) are recent synthetic/projection bars — preserve.
6. Tooling: rustc 1.75 — wasm-bindgen must be ≤0.2.92 compatible.

---

## 8. Target Architecture Decision

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Web UI | TypeScript + Vite | Fast HMR, ES modules, type safety |
| Analytics | Rust → WASM | Deterministic numerics, performance |
| Bridge | wasm-bindgen + TS adapters | Clean API, fallback to pure TS if WASM unavailable |
| Desktop future | Tauri (prep only) | Same Rust core as commands |
| Fundamental backend | Node/TypeScript | Thin proxy; no benefit to rewrite in Rust yet |
| Workers | Web Worker + WASM | Non-blocking heavy backtest / MPB |

**Performance target:** UI never freezes; large dataset indicators + backtest off main thread.

---

## 9. Regression Strategy

1. Capture JS baseline outputs for XAUUSD/BRENT 1D/4H/1H on fixed candle windows.
2. Golden JSON under `tests/golden/`.
3. Tolerance: absolute `1e-9` for pure indicators; relative `1e-6` for scores; exact match for signals.
4. Auto Debugger independent checks become the primary cross-impl validator.

---

## 10. Migration Order (locked)

0. Audit (this doc)  
1. TS scaffold + types + CONFIG  
2. Port application layer to TS (parity)  
3. Rust core crate (indicators first)  
4. Port remaining numerical engines  
5. Bridge + adapters  
6. Regression tests  
7. Remove old JS only after parity  
8. Production web build  
9. Tauri prep (non-breaking)
