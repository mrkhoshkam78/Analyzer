تحلیل‌گر بازار آفلاین — هسته تصمیم‌گیری ترکیبی
==============================================

ساختار
------
index.html / styles.css / app.js     رابط (ریشه)
logic/
  config.js         وزن‌ها و آستانه‌ها (قابل تنظیم)
  indicators.js     SMA EMA RSI MACD ATR BB Stoch ADX ROC Momentum S/R Volume Breakout
  technical.js      امتیاز تکنیکال چندعاملی
  fundamental.js    لایه فاندامنتال (بدون حدس؛ insufficient_data)
  decision.js       موتور ترکیبی Technical + Fundamental + Learning
  prediction.js     ذخیره و ارزیابی پیش‌بینی
  learning.js       تنظیم اطمینان بر اساس سابقه (بدون تغییر فرمول)
  storage.js        حافظه محلی نسخه‌دار
  providers.js      رابط Provider (Manual فعلی)
  symbols.js        رجیستری XAUUSD / USDEUR / BRENT
  analysis.js       ارکستراتور parse + analyze
  worker.js         Web Worker

جریان داده
----------
Market Data (CSV دستی) → Validation → Technical Engine → Fundamental Engine
→ Decision Engine → Prediction → Evaluation → Learning Memory

نمادهای مجاز: فقط XAUUSD، USDEUR، BRENT — بدون API آنلاین نماد/قیمت.

Market Data — BRENT (API Ninjas)
--------------------------------
Backend: server/index.js
  API_NINJAS_KEY=<key> node server/index.js
  GET /api/market/brent  → quote استاندارد
  GET /api/health

Frontend هرگز مستقیماً به api-ninjas وصل نمی‌شود.
فقط به /api/market/brent روی سرور داخلی درخواست می‌زند.

Provider: logic/marketData.js + logic/providers.js
تاریخچه: فقط از quoteهای واقعی دریافت‌شده (بدون داده ساختگی)

فرمول‌های تکنیکال/تصمیم: بدون تغییر در این مرحله.
