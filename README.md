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
