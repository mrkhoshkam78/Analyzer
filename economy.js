// economy.js - Dynamic Economic Engine with causal relationships

function getDifficultyMultipliers() {
  const diffId = getState()?.meta?.difficulty || 'medium';
  return DIFFICULTY[diffId]?.multipliers || DIFFICULTY.medium.multipliers;
}

function calculateRevenue(state) {
  const m = getDifficultyMultipliers();
  const e = state.economy;
  const taxBase = e.gdp * (e.taxRate / 100) * 0.28 * m.taxEfficiency;
  const resourceRevenue = (state.resources.oil * 0.12 + state.resources.gas * 0.08 +
    state.resources.minerals * 0.05 + state.resources.agriculture * 0.03 +
    state.resources.rare_earth * 0.18) * (e.currencyStrength / 100);
  const investmentRevenue = e.foreignInvestment * 0.04;
  const tradeRevenue = Math.max(0, e.exports - e.imports) * 0.15;

  return Math.round((taxBase + resourceRevenue + investmentRevenue + tradeRevenue) * 10) / 10;
}

function calculateSpending(state) {
  const mil = state.military.budgetAmount;
  const intel = state.intelligence.budget;
  const research = state.tech.researchBudget;
  const infra = state.economy.infrastructure * 0.08;
  const social = state.population.satisfaction < 40 ? 18 : 12;
  const debtInterest = state.economy.nationalDebt * 0.035;
  const baseAdmin = 22;

  return Math.round((mil + intel + research + infra + social + debtInterest + baseAdmin) * 10) / 10;
}

function processEconomyTick(state) {
  const m = getDifficultyMultipliers();
  const e = { ...state.economy };
  const pop = { ...state.population };

  // 1. Revenue & Spending
  e.revenue = calculateRevenue(state);
  e.spending = calculateSpending(state);
  e.deficit = Math.round((e.spending - e.revenue) * 10) / 10;
  e.budget = Math.round((e.budget - e.deficit) * 10) / 10;

  // 2. Debt
  if (e.deficit > 0) {
    e.nationalDebt = Math.round((e.nationalDebt + e.deficit * 0.85) * 10) / 10;
  } else {
    e.nationalDebt = Math.max(0, Math.round((e.nationalDebt + e.deficit * 0.4) * 10) / 10);
  }

  // 3. GDP Growth calculation (causal)
  let growth = 1.2 * m.growthPotential;

  // Positive factors
  growth += (e.industrialProduction - 50) * 0.025;
  growth += (e.foreignInvestment - 15) * 0.02;
  growth += (e.infrastructure - 45) * 0.015;
  growth += (state.tech.level - 40) * 0.02;
  growth += Math.max(-1.5, Math.min(2, e.tradeBalance * 0.08));
  growth += (e.naturalResources - 50) * 0.01;

  // Negative factors
  growth -= Math.max(0, e.inflation - 3) * 0.35 * m.inflationRate;
  growth -= Math.max(0, e.unemployment - 6) * 0.28;
  growth -= Math.max(0, e.nationalDebt - 200) * 0.008;
  if (e.budget < 0) growth -= 0.6;
  if (state.diplomacy.sanctions.length > 0) {
    const sanctionImpact = state.diplomacy.sanctions.reduce((sum, s) => sum + (s.severity || 1), 0);
    growth -= sanctionImpact * 0.7 * m.sanctionImpact;
  }

  // Tax rate effect: high tax reduces investment & growth
  if (e.taxRate > 28) growth -= (e.taxRate - 28) * 0.06;
  if (e.taxRate < 15) growth += 0.3;

  // Stability & satisfaction feedback
  growth += (pop.satisfaction - 50) * 0.015;
  growth += (e.stability - 50) * 0.012;

  e.gdpGrowth = Math.round(Math.max(-4.5, Math.min(8.5, growth)) * 100) / 100;

  // Apply GDP change (monthly approximation: growth/12)
  const monthlyGrowthFactor = 1 + (e.gdpGrowth / 100) / 12;
  e.gdp = Math.round(e.gdp * monthlyGrowthFactor * 10) / 10;

  // 4. Inflation
  let inflation = 2.0 * m.inflationRate;
  inflation += Math.max(0, e.deficit) * 0.04;
  inflation += Math.max(0, e.gdpGrowth - 3) * 0.15; // overheating
  if (e.budget < -20) inflation += 0.8;
  inflation -= Math.max(0, e.unemployment - 8) * 0.08; // slack
  inflation += (100 - e.currencyStrength) * 0.03;
  if (state.diplomacy.sanctions.length > 0) inflation += 0.6 * m.sanctionImpact;

  // Money printing simulation (if big deficit)
  if (e.deficit > 15) inflation += (e.deficit - 15) * 0.07 * m.inflationRate;

  e.inflation = Math.round(Math.max(0.2, Math.min(25, inflation)) * 10) / 10;

  // 5. Unemployment
  let unemp = 5.5 * m.unemploymentBase;
  unemp -= e.gdpGrowth * 0.35;
  unemp += Math.max(0, e.inflation - 5) * 0.15;
  unemp -= (e.industrialProduction - 50) * 0.04;
  unemp -= (e.infrastructure - 45) * 0.03;
  if (e.taxRate > 30) unemp += 0.5;
  if (state.diplomacy.sanctions.length > 0) unemp += 0.8 * m.sanctionImpact;

  e.unemployment = Math.round(Math.max(2.5, Math.min(28, unemp)) * 10) / 10;

  // 6. Currency Strength
  let currency = e.currencyStrength;
  currency += e.tradeBalance * 0.15;
  currency += e.gdpGrowth * 0.4;
  currency -= e.inflation * 0.6;
  currency -= Math.max(0, e.nationalDebt - 250) * 0.02;
  if (state.diplomacy.sanctions.length > 0) currency -= 3 * m.sanctionImpact;
  e.currencyStrength = Math.round(Math.max(40, Math.min(160, currency)));

  // 7. Trade
  let exports = e.exports;
  exports += e.gdpGrowth * 0.2;
  exports += (e.industrialProduction - 50) * 0.08;
  exports -= Math.max(0, e.inflation - 4) * 0.3;
  if (state.diplomacy.sanctions.length > 0) {
    exports -= 4 * m.sanctionImpact * state.diplomacy.sanctions.length;
  }
  e.exports = Math.round(Math.max(20, exports) * 10) / 10;

  let imports = e.imports;
  imports += e.gdp * 0.002;
  imports -= (e.industrialProduction - 50) * 0.05;
  if (e.taxRate < 18) imports += 1.2;
  e.imports = Math.round(Math.max(25, imports) * 10) / 10;

  e.tradeBalance = Math.round((e.exports - e.imports) * 10) / 10;

  // 8. Production & Resources
  e.industrialProduction = Math.round(Math.max(20, Math.min(95,
    e.industrialProduction + e.gdpGrowth * 0.4 + (state.tech.level - 40) * 0.08 - e.unemployment * 0.15
  )));

  // Resource depletion/gain mild
  const resKeys = ['oil', 'gas', 'minerals', 'agriculture', 'rare_earth'];
  resKeys.forEach(k => {
    if (state.resources[k] > 5) {
      state.resources[k] = Math.max(5, state.resources[k] - 0.08 + (Math.random() * 0.2 - 0.05));
    }
  });
  e.naturalResources = Math.round(
    (state.resources.oil + state.resources.gas + state.resources.minerals +
     state.resources.agriculture + state.resources.rare_earth) / 5
  );

  // 9. Public Satisfaction (strong causal links)
  let sat = pop.satisfaction;
  sat += e.gdpGrowth * 0.6 * m.satisfactionGain;
  sat -= Math.max(0, e.inflation - 3.5) * 0.7;
  sat -= Math.max(0, e.unemployment - 7) * 0.55;
  sat -= Math.max(0, e.taxRate - 25) * 0.25;
  sat += (e.infrastructure - 45) * 0.08;
  sat += (state.military.readiness > 60 ? 0.3 : -0.4);
  if (e.budget < -10) sat -= 1.2;
  if (state.diplomacy.sanctions.length > 0) sat -= 1.5 * m.sanctionImpact;
  // Stability feedback
  e.stability = Math.round(Math.max(15, Math.min(95,
    e.stability + (sat - 50) * 0.08 + e.gdpGrowth * 0.3 - Math.max(0, e.unemployment - 10) * 0.4
  )));

  pop.satisfaction = Math.round(Math.max(5, Math.min(98, sat)) * 10) / 10;
  pop.happiness = Math.round((pop.satisfaction * 0.7 + (100 - e.unemployment * 2) * 0.3));
  pop.povertyRate = Math.round(Math.max(3, Math.min(40, 8 + e.unemployment * 0.7 - e.gdpGrowth * 0.5)));

  // 10. Population growth mild monthly
  const monthlyPopGrowth = (state.country.populationGrowth / 100) / 12;
  state.country.population = Math.round(state.country.population * (1 + monthlyPopGrowth));

  // Foreign investment dynamics
  let fi = e.foreignInvestment;
  fi += e.gdpGrowth * 0.5;
  fi += (e.stability - 50) * 0.15;
  fi -= Math.max(0, e.taxRate - 26) * 0.4;
  if (state.diplomacy.sanctions.length > 0) fi -= 3 * m.sanctionImpact;
  e.foreignInvestment = Math.round(Math.max(2, Math.min(80, fi)) * 10) / 10;

  state.economy = e;
  state.population = pop;

  // History for charts (keep last 24 months)
  if (!state.history) state.history = { gdp: [], satisfaction: [], debt: [], events: [] };
  state.history.gdp.push(e.gdp);
  state.history.satisfaction.push(pop.satisfaction);
  state.history.debt.push(e.nationalDebt);
  if (state.history.gdp.length > 24) {
    state.history.gdp.shift();
    state.history.satisfaction.shift();
    state.history.debt.shift();
  }

  return state;
}

// Player actions affecting economy
function changeTaxRate(state, newRate) {
  newRate = Math.max(8, Math.min(45, newRate));
  const old = state.economy.taxRate;
  state.economy.taxRate = newRate;
  // Immediate satisfaction hit/gain
  const delta = newRate - old;
  state.population.satisfaction = Math.max(5, Math.min(98,
    state.population.satisfaction - delta * 0.4
  ));
  logAction(state, `نرخ مالیات به ${newRate}% تغییر کرد`);
  return state;
}

function investInfrastructure(state, amount) {
  const m = getDifficultyMultipliers();
  const cost = Math.round(amount * m.infrastructureCost);
  if (state.economy.budget < cost) {
    return { success: false, message: 'بودجه کافی نیست' };
  }
  state.economy.budget -= cost;
  state.economy.spending += cost;
  // Project
  const duration = Math.max(2, Math.round(4 / m.infrastructureSpeed));
  state.projects.push({
    id: 'infra_' + Date.now(),
    type: 'infrastructure',
    name: 'توسعه زیرساخت',
    remaining: duration,
    total: duration,
    effect: { infrastructure: Math.round(amount * 0.35), production: Math.round(amount * 0.12) }
  });
  logAction(state, `سرمایه‌گذاری ${cost} واحد در زیرساخت آغاز شد`);
  return { success: true, state };
}

function adjustMilitaryBudget(state, newAmount) {
  const m = getDifficultyMultipliers();
  newAmount = Math.max(3, Math.min(45, newAmount));
  state.military.budgetAmount = Math.round(newAmount * m.militaryCost * 10) / 10;
  logAction(state, `بودجه نظامی به ${state.military.budgetAmount} تنظیم شد`);
  return state;
}

function logAction(state, text) {
  if (!state.actionsLog) state.actionsLog = [];
  state.actionsLog.unshift({
    time: `${state.time.year}/${state.time.month}/${state.time.day}`,
    text
  });
  if (state.actionsLog.length > 50) state.actionsLog.pop();
}
