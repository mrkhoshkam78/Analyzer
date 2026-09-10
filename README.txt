Offline Market Analyst V4
=========================

Lightweight, fast, international-only technical analysis tool.

Architecture
------------
index.html   – UI only
styles.css   – all styles
app.js       – UI interactions, symbol search, worker orchestration
analysis.js  – pure analysis engine (indicators + decision)
worker.js    – Web Worker for parse + analyze (keeps UI responsive)

Principles
----------
• Only online feature: Symbol / asset search (Yahoo Finance search endpoint).
• All OHLCV data comes from the user’s CSV or paste.
• No price, candle, RSI, MACD or any market-data API is ever called.
• Analysis is fully deterministic and runs offline (in a Worker when possible).

Supported assets (via search)
-----------------------------
US Stocks, ETFs, Indices, Forex, Commodities, Crypto, International stocks.

CSV requirements
----------------
Header row with at least Open, High, Low, Close (case-insensitive).
Volume optional. Extra columns ignored. Date column optional.
Minimum 30 valid candles recommended.

Indicators (price source)
-------------------------
RSI, SMA, EMA, MACD, Momentum, Trend → Close
Support / Resistance → High / Low
ATR → True Range (OHLC)
Volume Analysis → Volume

Decision
--------
Multi-factor score 0–100 → BUY / HOLD / SELL
Thresholds and weights live in analysis.js CONFIG and can be tuned without touching the rest of the engine.
