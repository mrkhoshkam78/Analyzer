// state.js - Central Game State Management

let GameState = null;

function createInitialState(difficultyId) {
  const diff = DIFFICULTY[difficultyId] || DIFFICULTY.medium;
  const m = diff.multipliers;

  const baseGDP = 480; // billion
  const baseBudget = 95;

  return {
    meta: {
      difficulty: difficultyId,
      difficultyName: diff.name,
      startedAt: Date.now(),
      lastSaved: null,
      version: '1.0',
      isRunning: false,
      speed: 1, // 0=pause, 1=normal, 3=fast
      tickCount: 0,
      gameOver: false,
      gameOverReason: null
    },

    time: {
      year: 2026,
      month: 1,
      day: 1,
      totalDays: 0
    },

    country: {
      name: 'جمهوری آزاد',
      population: Math.round(42000000 * (0.9 + m.startingResources * 0.1)),
      populationGrowth: 0.9 // % per year
    },

    economy: {
      gdp: Math.round(baseGDP * m.startingResources * 10) / 10,
      gdpGrowth: 2.1 * m.growthPotential,
      inflation: 3.2 * m.inflationRate,
      unemployment: 7.5 * m.unemploymentBase,
      budget: Math.round(baseBudget * m.startingBudget),
      revenue: 0,
      spending: 0,
      deficit: 0,
      nationalDebt: Math.round(180 * m.startingBudget),
      taxRate: 22, // %
      tradeBalance: 4.5,
      imports: 62,
      exports: 66.5,
      currencyStrength: 100,
      foreignInvestment: 18 * m.startingResources,
      industrialProduction: 55 * m.startingResources,
      naturalResources: Math.round(65 * m.startingResources),
      resourceIncome: 12,
      infrastructure: 48,
      stability: 58
    },

    population: {
      satisfaction: 52,
      happiness: 50,
      health: 62,
      education: 58,
      povertyRate: 14
    },

    military: {
      army: 45,
      airForce: 38,
      navy: 32,
      defenseSystems: 40,
      budget: 18, // % of government spending or absolute for simplicity
      budgetAmount: 12,
      technology: 42,
      readiness: 55,
      attackPower: 48,
      defensePower: 52,
      manpower: 280000,
      activeOperations: []
    },

    intelligence: {
      budget: 4.5,
      level: 40,
      domestic: 45,
      foreign: 38,
      counter: 42,
      operations: [],
      discoveredThreats: []
    },

    tech: {
      level: 44,
      researchPoints: 20,
      researchBudget: 6,
      focus: 'general' // general, military, economic, cyber
    },

    diplomacy: {
      relations: {
        northalia: 48,
        eastoria: 32,
        westland: 55,
        southmere: 62,
        centara: 41
      },
      agreements: [],
      sanctions: [], // { from: 'countryId', severity: 1-3, effects: {} }
      treaties: [],
      alliances: [],
      activeNegotiations: []
    },

    resources: {
      oil: Math.round(40 * m.startingResources),
      gas: Math.round(35 * m.startingResources),
      minerals: Math.round(50 * m.startingResources),
      agriculture: Math.round(60 * m.startingResources),
      rare_earth: Math.round(15 * m.startingResources)
    },

    projects: [], // ongoing infrastructure/military/tech projects
    events: [], // active or recent events
    alerts: [],
    advisorSuggestions: [],
    history: {
      gdp: [],
      satisfaction: [],
      debt: [],
      events: []
    },

    actionsLog: []
  };
}

function getState() {
  return GameState;
}

function setState(newState) {
  GameState = newState;
}

function updateState(updater) {
  if (typeof updater === 'function') {
    GameState = updater(GameState);
  } else {
    GameState = { ...GameState, ...updater };
  }
  return GameState;
}

function resetState(difficultyId) {
  GameState = createInitialState(difficultyId);
  return GameState;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Helper to safely get nested values
function get(path, defaultValue = 0) {
  if (!GameState) return defaultValue;
  const keys = path.split('.');
  let val = GameState;
  for (const k of keys) {
    if (val == null) return defaultValue;
    val = val[k];
  }
  return val !== undefined ? val : defaultValue;
}

function setPath(path, value) {
  if (!GameState) return;
  const keys = path.split('.');
  let obj = GameState;
  for (let i = 0; i < keys.length - 1; i++) {
    if (obj[keys[i]] === undefined) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
}
