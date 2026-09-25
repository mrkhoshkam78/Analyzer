# Project market data (V10.0.2)

Offline OHLCV used by `ensureProjectData` → historical store → calendar + analysis.

## Layout

```
data/
  XAUUSD/
    xauusd-1d.csv
    xauusd-4h.csv
    xauusd-1h.csv
  BRENT/
    brent-1d.csv
    brent-4h.csv
    brent-1h.csv
```

## Format

CSV header: `date` or `datetime`, `open`, `high`, `low`, `close`, `volume`  
Dates: `YYYY-MM-DD` (MT5 `YYYY.MM.DD` also accepted).

## Notes

- Requires HTTP server (not file://) for fetch of these files.
- Manual prices stay in browser localStorage; they do not rewrite these CSVs.
- Calendar day index merges historical + manual per symbol×timeframe.
- When analyzing 1D, 4H is also loaded for multi-timeframe agreement.
