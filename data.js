// data.js - Mock data, difficulty configs, initial country setup

const DIFFICULTY = {
  easy: {
    id: 'easy',
    name: 'Easy Mode',
    comfort: 10,
    description: 'منابع فراوان، اقتصاد پایدار، بحران‌های کمتر',
    multipliers: {
      startingResources: 1.8,
      startingBudget: 1.6,
      taxEfficiency: 1.3,
      inflationRate: 0.4,
      unemploymentBase: 0.6,
      satisfactionGain: 1.5,
      infrastructureCost: 0.6,
      infrastructureSpeed: 1.5,
      crisisChance: 0.3,
      sanctionImpact: 0.4,
      militaryCost: 0.7,
      techCost: 0.65,
      mistakePenalty: 0.4,
      growthPotential: 1.4,
      advisorRisk: 0.5,
      covertSuccessBonus: 0.15,
      aiAggressiveness: 0.6
    }
  },
  medium: {
    id: 'medium',
    name: 'Medium Mode',
    comfort: 5,
    description: 'تعادل بین سرگرمی و چالش',
    multipliers: {
      startingResources: 1.0,
      startingBudget: 1.0,
      taxEfficiency: 1.0,
      inflationRate: 1.0,
      unemploymentBase: 1.0,
      satisfactionGain: 1.0,
      infrastructureCost: 1.0,
      infrastructureSpeed: 1.0,
      crisisChance: 1.0,
      sanctionImpact: 1.0,
      militaryCost: 1.0,
      techCost: 1.0,
      mistakePenalty: 1.0,
      growthPotential: 1.0,
      advisorRisk: 1.0,
      covertSuccessBonus: 0.0,
      aiAggressiveness: 1.0
    }
  },
  realistic: {
    id: 'realistic',
    name: 'Realistic Mode',
    comfort: 1,
    description: 'شبیه‌سازی واقع‌گرایانه، چالش بالا، پیامدهای سنگین',
    multipliers: {
      startingResources: 0.7,
      startingBudget: 0.75,
      taxEfficiency: 0.85,
      inflationRate: 1.6,
      unemploymentBase: 1.3,
      satisfactionGain: 0.7,
      infrastructureCost: 1.4,
      infrastructureSpeed: 0.7,
      crisisChance: 1.8,
      sanctionImpact: 1.7,
      militaryCost: 1.3,
      techCost: 1.4,
      mistakePenalty: 1.8,
      growthPotential: 0.75,
      advisorRisk: 1.5,
      covertSuccessBonus: -0.1,
      aiAggressiveness: 1.4
    }
  }
};

const COUNTRIES = [
  {
    id: 'player',
    name: 'کشور شما',
    flag: '🏳️',
    isPlayer: true,
    economyPower: 55,
    militaryPower: 48,
    techLevel: 45,
    stability: 60
  },
  {
    id: 'northalia',
    name: 'نورثالیا',
    flag: '🟦',
    economyPower: 72,
    militaryPower: 65,
    techLevel: 70,
    stability: 68,
    interests: ['trade', 'energy', 'tech'],
    attitude: 45
  },
  {
    id: 'eastoria',
    name: 'ایستوریا',
    flag: '🟥',
    economyPower: 58,
    militaryPower: 78,
    techLevel: 55,
    stability: 52,
    interests: ['military', 'resources'],
    attitude: 30
  },
  {
    id: 'westland',
    name: 'وست‌لند',
    flag: '🟩',
    economyPower: 85,
    militaryPower: 60,
    techLevel: 82,
    stability: 75,
    interests: ['trade', 'tech', 'finance'],
    attitude: 55
  },
  {
    id: 'southmere',
    name: 'ساوث‌میر',
    flag: '🟨',
    economyPower: 42,
    militaryPower: 35,
    techLevel: 38,
    stability: 48,
    interests: ['resources', 'agriculture'],
    attitude: 60
  },
  {
    id: 'centara',
    name: 'سنتارا',
    flag: '🟪',
    economyPower: 63,
    militaryPower: 55,
    techLevel: 60,
    stability: 58,
    interests: ['energy', 'trade'],
    attitude: 40
  }
];

const RESOURCE_TYPES = [
  { id: 'oil', name: 'نفت', basePrice: 75, volatility: 0.15 },
  { id: 'gas', name: 'گاز', basePrice: 45, volatility: 0.12 },
  { id: 'minerals', name: 'معادن', basePrice: 30, volatility: 0.08 },
  { id: 'agriculture', name: 'کشاورزی', basePrice: 20, volatility: 0.06 },
  { id: 'rare_earth', name: 'خاک‌های نادر', basePrice: 120, volatility: 0.2 }
];

const EVENT_TEMPLATES = [
  {
    id: 'economic_crisis',
    title: 'بحران اقتصادی',
    description: 'رکود جهانی یا داخلی باعث کاهش تولید و افزایش بیکاری شده است.',
    type: 'negative',
    conditions: (s) => s.economy.gdpGrowth < 0.5 || s.economy.inflation > 8,
    effects: { gdpGrowth: -1.5, unemployment: 1.2, satisfaction: -4, budget: -800 },
    probabilityBase: 0.08
  },
  {
    id: 'resource_discovery',
    title: 'کشف منابع جدید',
    description: 'منابع طبیعی جدیدی در کشور کشف شده است.',
    type: 'positive',
    conditions: () => true,
    effects: { resources: 12, gdpGrowth: 0.8, satisfaction: 3 },
    probabilityBase: 0.05
  },
  {
    id: 'energy_price_spike',
    title: 'افزایش قیمت انرژی',
    description: 'قیمت جهانی انرژی به شدت افزایش یافته است.',
    type: 'mixed',
    conditions: () => true,
    effects: { inflation: 1.5, exports: 4, satisfaction: -2 },
    probabilityBase: 0.07
  },
  {
    id: 'diplomatic_crisis',
    title: 'بحران دیپلماتیک',
    description: 'تنش با یکی از کشورهای همسایه افزایش یافته است.',
    type: 'negative',
    conditions: (s) => Object.values(s.diplomacy.relations).some(r => r < 35),
    effects: { relationsPenalty: 8, satisfaction: -3 },
    probabilityBase: 0.06
  },
  {
    id: 'protests',
    title: 'اعتراضات مردمی',
    description: 'مردم به دلیل شرایط اقتصادی یا سیاسی اعتراض می‌کنند.',
    type: 'negative',
    conditions: (s) => s.population.satisfaction < 40 || s.economy.unemployment > 12,
    effects: { satisfaction: -6, stability: -5, production: -3 },
    probabilityBase: 0.09
  },
  {
    id: 'investment_opportunity',
    title: 'فرصت سرمایه‌گذاری خارجی',
    description: 'سرمایه‌گذاران خارجی علاقه به ورود به بازار کشور نشان داده‌اند.',
    type: 'positive',
    conditions: (s) => s.economy.stability > 50 && s.diplomacy.sanctions.length === 0,
    effects: { foreignInvestment: 15, gdpGrowth: 0.6, satisfaction: 2 },
    probabilityBase: 0.06
  },
  {
    id: 'military_threat',
    title: 'تهدید نظامی',
    description: 'فعالیت‌های نظامی مشکوک در مرزها گزارش شده است.',
    type: 'negative',
    conditions: (s) => s.military.readiness < 50,
    effects: { readinessNeeded: true, satisfaction: -2 },
    probabilityBase: 0.05
  },
  {
    id: 'tech_breakthrough',
    title: 'پیشرفت فناوری',
    description: 'دانشمندان کشور به پیشرفت مهمی دست یافته‌اند.',
    type: 'positive',
    conditions: (s) => s.tech.researchPoints > 30,
    effects: { techLevel: 3, production: 4, satisfaction: 3 },
    probabilityBase: 0.04
  },
  {
    id: 'global_crisis',
    title: 'بحران جهانی',
    description: 'یک بحران بین‌المللی تجارت و سرمایه‌گذاری را مختل کرده است.',
    type: 'negative',
    conditions: () => true,
    effects: { exports: -8, foreignInvestment: -10, inflation: 1.2 },
    probabilityBase: 0.04
  },
  {
    id: 'corruption_scandal',
    title: 'رسوایی فساد',
    description: 'یک رسوایی فساد در سطوح دولتی افشا شده است.',
    type: 'negative',
    conditions: (s) => s.difficulty === 'realistic' || Math.random() < 0.3,
    effects: { satisfaction: -5, budget: -400, stability: -4 },
    probabilityBase: 0.05
  }
];

const INITIAL_PLAYER_STATE = {
  name: 'جمهوری آزاد',
  population: 42000000,
  year: 2026,
  month: 1,
  day: 1,
  dayOfYear: 1
};
