Analyzer v11.0.1 — Offline Market Analyst (debugged)

تغییرات اصلی:
1) فاندامنتال V6.0 کاملاً آفلاین
   - محرک‌های اختصاصی هر نماد + Z-Score + وزن رژیم‌محور
   - فرم ورود دستی در صفحه بنیادی
   - بدون وابستگی اجباری به API خارجی

2) موتور ورود V10.0
   - هم‌گرایی چندعاملی، EV سخت‌تر، ابطال نرم

3) UI نقطه ورود سلسله‌مراتبی + برداشت پیشنهادی حرفه‌ای‌تر

4) فونت Vazirmatn + پوسته Zen Calm

دیباگ‌های فاندامنتال (v11.0.1):
- جلوگیری از بارگذاری خاموش store وقتی toggle خاموش است (snapshot null)
- استراتژی Fundamental فقط با snapshot صریح فعال می‌شود
- در حالت Live فیلتر as-of روی تاریخ دادهٔ دستی اعمال نمی‌شود (look-ahead فقط در backtestMode)
- reasoning استراتژی خوانا (nameFa/dir) به‌جای [object Object]
- برداشت پیشنهادی لایه فاندامنتال را در No Trade و Wait-for-Entry هم نشان می‌دهد
- مسیر تحلیل: اولویت با store محلی آفلاین

Auto Debugger v1.3.0 (دیباگ‌شده):
- حذف false-positive فرمول ترکیبی tech+fund (ensemble واقعی است)
- اعتبارسنجی Entry V10 (هندسه، RR، EV، confluence)
- اعتبارسنجی لایه Fundamental
- نرمال‌سازی OHLC (close/open ↔ c/o)
- severity رگرسیون تطبیقی + fingerprint شامل fund
- APP_VERSION = V11.0.1

v11.0.1 offline polish:
- Fundamental: variable list UI + pure offline (no EODHD / backend message)
- Data paths: only data/{SYM}/{sym}-{tf}.csv (xauusd-1d, brent-4h, …)
- Asset delete SVG on every symbol (core symbols protected)
- Animations: fadeSlideIn, softGlow, gentleFloat
- MPB loads OHLCV from data/ via ensureProjectData
