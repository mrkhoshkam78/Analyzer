# Market Data Repository V7.0.1

Structure:
  data/{SYMBOL}/{TIMEFRAME}.csv

Symbols: XAUUSD, BRENT, USDEUR
Timeframes: 1m, 5m, 15m, 30m, 1h, 1D, 1W

CSV schema (required):
  Date/timestamp, Open, High, Low, Close, Volume

Notes:
- Only verified OHLCV is stored. Missing TF files are NOT fabricated.
- Volume may be 0/empty when source has no volume — Data Quality reflects this.
- Extend range by importing CSV via UI or importHistoricalCsv(symbol, tf, text).
- Current bundled seeds: XAUUSD 1D and BRENT 1D (approx 2026-07-01 → 2026-09-11).
- USDEUR and lower timeframes: add via Manual CSV Import.
