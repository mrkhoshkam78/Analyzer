// advisor.js - Presidential Advisor System (always exactly 3 suggestions)

function generateAdvisorSuggestions(state) {
  const m = getDifficultyMultipliers();
  const suggestions = [];
  const e = state.economy;
  const pop = state.population;
  const mil = state.military;
  const intel = state.intelligence;

  // Helper to create suggestion object
  function make(title, description, reason, pros, risks, impact, priority = 1) {
    return { title, description, reason, pros, risks, impact, priority };
  }

  // === Priority based on current problems ===

  // High inflation
  if (e.inflation > 7) {
    suggestions.push(make(
      'کنترل تورم',
      'تورم بالا قدرت خرید مردم را کاهش داده است. کاهش کسری بودجه و کنترل نقدینگی توصیه می‌شود.',
      `تورم فعلی ${e.inflation.toFixed(1)}٪ است`,
      'کاهش تورم، افزایش رضایت در میان‌مدت، ثبات ارز',
      'ممکن است رشد کوتاه‌مدت کاهش یابد',
      'تورم ↓ ، رضایت ↑ ، رشد کمی ↓',
      10
    ));
  }

  // High unemployment
  if (e.unemployment > 10) {
    suggestions.push(make(
      'کاهش بیکاری',
      'سرمایه‌گذاری در زیرساخت و تولید صنعتی می‌تواند شغل ایجاد کند.',
      `بیکاری ${e.unemployment.toFixed(1)}٪ است`,
      'کاهش بیکاری، افزایش تولید، رضایت بیشتر',
      'هزینه بودجه در کوتاه‌مدت',
      'بیکاری ↓ ، تولید ↑ ، بودجه ↓',
      9
    ));
  }

  // Budget deficit
  if (e.deficit > 8 || e.budget < 10) {
    suggestions.push(make(
      'تعادل بودجه',
      'کسری بودجه در حال افزایش بدهی ملی است. افزایش مالیات یا کاهش هزینه‌های غیرضروری را بررسی کنید.',
      `کسری فعلی ${e.deficit.toFixed(1)} و بودجه ${e.budget.toFixed(1)}`,
      'کاهش بدهی، ثبات مالی، کاهش تورم آینده',
      'افزایش مالیات باعث نارضایتی می‌شود',
      'بدهی ↓ ، رضایت ممکن است ↓',
      9
    ));
  }

  // Low satisfaction
  if (pop.satisfaction < 38) {
    suggestions.push(make(
      'افزایش رضایت عمومی',
      'مردم ناراضی هستند. کاهش مالیات، بهبود خدمات یا سرمایه‌گذاری اجتماعی می‌تواند کمک کند.',
      `رضایت عمومی ${pop.satisfaction.toFixed(1)} است`,
      'جلوگیری از اعتراضات، ثبات سیاسی',
      'هزینه بودجه یا کاهش درآمد مالیاتی',
      'رضایت ↑ ، بودجه ↓',
      10
    ));
  }

  // Weak military
  if (mil.readiness < 45 || mil.attackPower < 40) {
    suggestions.push(make(
      'تقویت آمادگی نظامی',
      'آمادگی یا قدرت نظامی پایین است. افزایش بودجه یا تمرینات توصیه می‌شود.',
      `آمادگی ${mil.readiness} و قدرت حمله ${mil.attackPower}`,
      'افزایش امنیت ملی، بازدارندگی',
      'هزینه اقتصادی و احتمالاً نارضایتی',
      'آمادگی ↑ ، بودجه ↓',
      7
    ));
  }

  // Sanctions
  if (state.diplomacy.sanctions.length > 0) {
    suggestions.push(make(
      'مذاکره برای رفع تحریم',
      'تحریم‌ها اقتصاد را تحت فشار قرار داده‌اند. بهبود روابط با کشورهای تحریم‌کننده اولویت دارد.',
      `${state.diplomacy.sanctions.length} تحریم فعال`,
      'بهبود تجارت، سرمایه‌گذاری و رشد',
      'ممکن است امتیاز سیاسی نیاز باشد',
      'تجارت ↑ ، رشد ↑',
      9
    ));
  }

  // Low exports / trade
  if (e.tradeBalance < -5) {
    suggestions.push(make(
      'بهبود تراز تجاری',
      'تراز تجاری منفی است. حمایت از صادرات و توافق‌های تجاری جدید مفید خواهد بود.',
      `تراز تجاری ${e.tradeBalance.toFixed(1)}`,
      'تقویت ارز، رشد اقتصادی',
      'ممکن است واردات ضروری گران‌تر شود',
      'صادرات ↑ ، ارز ↑',
      6
    ));
  }

  // Low infrastructure
  if (e.infrastructure < 45) {
    suggestions.push(make(
      'سرمایه‌گذاری در زیرساخت',
      'زیرساخت ضعیف مانع رشد است. پروژه‌های عمرانی را آغاز کنید.',
      `سطح زیرساخت ${e.infrastructure}`,
      'رشد بلندمدت، اشتغال، رضایت',
      'هزینه اولیه بالا',
      'زیرساخت ↑ ، تولید ↑',
      6
    ));
  }

  // Intelligence opportunity
  if (intel.level < 45) {
    suggestions.push(make(
      'تقویت سازمان اطلاعات',
      'سطح اطلاعات پایین است. افزایش بودجه یا عملیات جمع‌آوری اطلاعات توصیه می‌شود.',
      `سطح اطلاعات ${intel.level}`,
      'شناسایی تهدیدات، مزیت دیپلماتیک',
      'هزینه و ریسک افشای عملیات',
      'اطلاعات ↑',
      5
    ));
  }

  // Opportunity: high growth potential
  if (e.gdpGrowth > 3.5 && e.budget > 30) {
    suggestions.push(make(
      'سرمایه‌گذاری در فناوری',
      'اقتصاد در وضعیت خوبی است. حالا زمان مناسبی برای سرمایه‌گذاری در تحقیق و فناوری است.',
      `رشد ${e.gdpGrowth.toFixed(1)}٪ و بودجه مناسب`,
      'رشد پایدارتر در آینده، مزیت رقابتی',
      'بازده کوتاه‌مدت محدود',
      'فناوری ↑ ، رشد بلندمدت ↑',
      4
    ));
  }

  // Good relations opportunity
  const goodRel = Object.entries(state.diplomacy.relations).find(([_, v]) => v >= 60);
  if (goodRel && state.diplomacy.agreements.filter(a => a.targetId === goodRel[0]).length < 2) {
    suggestions.push(make(
      'گسترش توافق‌های تجاری',
      `روابط با ${getCountryName(goodRel[0])} خوب است. فرصت مناسبی برای توافق تجاری یا اقتصادی وجود دارد.`,
      `روابط ${goodRel[1].toFixed(0)} با ${getCountryName(goodRel[0])}`,
      'افزایش صادرات و سرمایه‌گذاری',
      'وابستگی بیشتر به آن کشور',
      'تجارت ↑ ، روابط ↑',
      5
    ));
  }

  // Default / filler suggestions if not enough
  const defaults = [
    make(
      'حفظ ثبات اقتصادی',
      'وضعیت کلی قابل قبول است. ادامه سیاست‌های متعادل توصیه می‌شود.',
      'هیچ بحران فوری وجود ندارد',
      'پایداری',
      'فرصت‌های رشد ممکن است از دست برود',
      'ثبات',
      1
    ),
    make(
      'نظارت بر روابط خارجی',
      'روابط دیپلماتیک را به‌طور منظم بررسی و در صورت نیاز بهبود دهید.',
      'حفظ تعادل قدرت منطقه‌ای',
      'کاهش احتمال بحران',
      'هزینه دیپلماسی',
      'روابط پایدار',
      1
    ),
    make(
      'بهینه‌سازی مالیات',
      'نرخ مالیات فعلی را با توجه به رشد و رضایت مردم بازنگری کنید.',
      `نرخ مالیات ${e.taxRate}٪`,
      'تعادل درآمد و انگیزه سرمایه‌گذاری',
      'تغییرات می‌تواند نارضایتی ایجاد کند',
      'درآمد یا رضایت',
      2
    ),
    make(
      'تقویت تولید صنعتی',
      'حمایت از بخش تولید می‌تواند اشتغال و صادرات را افزایش دهد.',
      `تولید صنعتی ${e.industrialProduction}`,
      'رشد GDP و کاهش بیکاری',
      'نیاز به سرمایه‌گذاری',
      'تولید ↑',
      3
    )
  ];

  // Sort by priority and take unique top ones
  suggestions.sort((a, b) => b.priority - a.priority);

  // Ensure exactly 3
  let final = [];
  const usedTitles = new Set();
  for (const s of suggestions) {
    if (!usedTitles.has(s.title) && final.length < 3) {
      final.push(s);
      usedTitles.add(s.title);
    }
  }
  // Fill with defaults if needed
  for (const d of defaults) {
    if (final.length >= 3) break;
    if (!usedTitles.has(d.title)) {
      final.push(d);
      usedTitles.add(d.title);
    }
  }

  // Adjust risk wording based on difficulty
  if (m.advisorRisk > 1.2) {
    final = final.map(s => ({
      ...s,
      risks: s.risks + ' (در حالت واقع‌گرایانه پیامدها می‌توانند شدیدتر باشند)'
    }));
  } else if (m.advisorRisk < 0.7) {
    final = final.map(s => ({
      ...s,
      risks: s.risks.replace('ممکن است', 'احتمال کمی وجود دارد که')
    }));
  }

  state.advisorSuggestions = final.slice(0, 3);
  return state;
}

function getCountryName(id) {
  const c = COUNTRIES.find(x => x.id === id);
  return c ? c.name : id;
}
