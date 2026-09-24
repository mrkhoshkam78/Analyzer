# Market Data Repository V10

Structure:
  data/{SYMBOL}/{symbol}-1d.csv

Symbols: XAUUSD, BRENT
Files:
  data/XAUUSD/xauusd-1d.csv
  data/BRENT/brent-1d.csv

CSV schema (required):
  Date/timestamp, Open, High, Low, Close, Volume

Notes:
- Only verified OHLCV is stored. Missing TF files are NOT fabricated.
- Volume may be 0/empty when source has no volume — Data Quality reflects this.
- Extend range by importing CSV via UI or importHistoricalCsv(symbol, tf, text).
