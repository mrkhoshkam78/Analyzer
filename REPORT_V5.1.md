# گزارش نهایی — Offline Market Analyst V5.1

## مشکلات اصلی Forecast قبل از اصلاح
1. آستانه BUY/SELL (62/38) نسبت به توزیع واقعی Score (میانگین ≈52، p90≈59) خیلی سخت بود → تقریباً همه سیگنال‌ها HOLD و قابل ارزیابی نبودند.
2. لایه Fundamental فقط stub بود.
3. UI فاقد Sidebar قابل‌استفاده و بخش Fundamental/Backtest بود (یا در layout دیده نمی‌شد).
4. هیچ موتور Backtest با جلوگیری از Look-Ahead وجود نداشت.

## Root Cause
- Score تکنیکال حول 50 متمرکز است؛ thresholdهای 62/38 تقریباً هیچ سیگنال جهتی تولید نمی‌کردند.
- Fundamental و Backtest در معماری قبلی عملیاتی نشده بودند.

## اصلاحات
| بخش | کار انجام‌شده |
|-----|----------------|
| Sidebar | منوی کامل RTL + Responsive + دکمه موبایل |
| Fundamental | ۵ متغیر + Actual/Forecast/Previous/Date + Surprise/Change + وزن Asset-aware |
| Threshold | کالیبره به 57/43 بر اساس توزیع Score روی sample_10k |
| Backtest | `logic/backtest.js` — Walk-forward، بدون look-ahead، چند افق |
| Persistence | Fundamental + نتایج Backtest در localStorage |
| UI Backtest | داشبورد Accuracy / DirAcc / Precision / Recall / F1 / False Signal / Win Rate + جدول نمونه |

## فرمول‌ها

### Technical Score
وزن‌دار میانگین زیرنمرات (trend, momentum, RSI, MACD, volatility, structure, volume) مطابق `CONFIG.techWeights`.

### Fundamental Score
```
impulse = f(surprise یا change) ∈ [-1,1]
contrib = weight[asset][var] × impact_sign[asset][var] × impulse
score = 50 + 45 × (Σcontrib / Σ|w|)
```

### Combined Score
```
combined = 0.7 × technical + 0.3 × fundamental   (فقط اگر fund.ok)
signal = BUY if combined ≥ 57 else SELL if ≤ 43 else HOLD
```

### Confidence
```
0.5 + |combined−50|/100  سپس clamp و ضریب learning
```

### Target / Stop
از Support/Resistance زمان پیش‌بینی: برای BUY هدف نزدیک/بالای مقاومت، حد ضرر زیر حمایت.

## نتایج Backtest واقعی (sample_10k.csv · Technical Only · step=15)

| Horizon | N | Accuracy% | Dir.Acc% | Precision | Recall | F1 | FalseSignal% | WinRate% |
|---------|---|-----------|----------|-----------|--------|-----|--------------|----------|
| 3 | 665 | 14.6 | 39.4 | 38.5 | 20.7 | 26.9 | 43.9 | 47.3 |
| 5 | 665 | 15.3 | 41.5 | 43.0 | 22.0 | 29.1 | 47.2 | 46.8 |
| 10 | 664 | 16.3 | 44.1 | 43.6 | 21.9 | 29.2 | 50.6 | 46.6 |
| 20 | 664 | 18.5 | 50.2 | 50.6 | 25.0 | 33.5 | 46.5 | 51.9 |

- **بهترین Horizon در این دیتاست:** 20 کندل (Dir.Acc ≈ 50%)
- Accuracy «سخت» پایین است چون HOLD وقتی بازار حرکت می‌کند غلط/خنثی شمرده می‌شود؛ **Directional Accuracy** معیار معنادارتر است (~40–50%).

## نمونه Predictionهای تاریخی (افق ۵)

| تاریخ پیش‌بینی | جهت پیش‌بینی | Score | قیمت ورود | قیمت آینده | جهت واقعی | بازده% | نتیجه |
|----------------|--------------|-------|-----------|------------|-----------|--------|--------|
| 2023-01-31 | neutral | 49 | 195.27 | 189.88 | down | -2.76 | neutral |
| (نمونه mid) | up | 57 | 286.42 | 284.23 | down | -0.76 | wrong |
| (نمونه mid) | up | 58 | 283.79 | 271.52 | down | -4.32 | wrong |
| (نمونه mid) | down | 43 | 207.25 | 211.60 | up | +2.10 | wrong |

(جزئیات کامل در UI بک‌تست پس از اجرا نمایش داده می‌شود.)

## آیا Accuracy به 90/100 رسیده؟
**خیر.**

### محدودیت‌های دقیق
1. **دیتاست sample** رفتار نزدیک random-walk / synthetic دارد؛ edge تکنیکال ضعیف است.
2. **داده Fundamental هم‌زمان تاریخی وجود ندارد** → مدل Combined روی گذشته واقعی قابل اندازه‌گیری نیست.
3. **امتیاز تکنیکال** حول خنثی متمرکز است؛ حتی با threshold کالیبره‌شده، سیگنال‌های جهتی کمی تولید می‌شود و دقت جهتی حدود شانس است.
4. رساندن مصنوعی به ۹۰ با حذف wrongها یا تغییر تعریف موفقیت **عمداً انجام نشد**.

## مسیر واقعی بهبود
- دیتاست قیمت واقعی بازار + سری زمانی Fundamental با تاریخ
- Walk-forward با train/test جدا
- فیلتر regime (فقط سیگنال وقتی ADX/روند قوی)
- Probabilistic calibration به‌جای threshold ثابت

نسخه: V5.1 · 2026-09-11
