// events.js - Dynamic Event System

function processEvents(state) {
  const m = getDifficultyMultipliers();
  const chanceMultiplier = m.crisisChance || 1;

  // Chance to trigger a new event each tick (month)
  if (Math.random() < 0.22 * chanceMultiplier) {
    const possible = EVENT_TEMPLATES.filter(t => {
      try {
        return t.conditions(state);
      } catch {
        return true;
      }
    });

    if (possible.length > 0) {
      // Weight by probabilityBase
      const totalWeight = possible.reduce((s, e) => s + (e.probabilityBase || 0.05), 0);
      let r = Math.random() * totalWeight;
      let chosen = possible[0];
      for (const e of possible) {
        r -= (e.probabilityBase || 0.05);
        if (r <= 0) {
          chosen = e;
          break;
        }
      }
      triggerEvent(state, chosen);
    }
  }

  // Clear old alerts (keep last 8)
  if (state.alerts && state.alerts.length > 8) {
    state.alerts = state.alerts.slice(0, 8);
  }

  return state;
}

function triggerEvent(state, template) {
  const event = {
    id: template.id + '_' + Date.now(),
    title: template.title,
    description: template.description,
    type: template.type,
    day: state.time.totalDays,
    effects: { ...template.effects }
  };

  // Apply effects
  applyEventEffects(state, event.effects);

  state.events.unshift(event);
  if (state.events.length > 15) state.events.pop();

  state.alerts.unshift({
    type: template.type === 'positive' ? 'success' : template.type === 'negative' ? 'danger' : 'warning',
    text: `رویداد: ${template.title}`
  });

  if (!state.history.events) state.history.events = [];
  state.history.events.push({ title: template.title, day: state.time.totalDays });

  logAction(state, `رویداد رخ داد: ${template.title}`);
  return state;
}

function applyEventEffects(state, effects) {
  if (!effects) return;

  if (effects.gdpGrowth) state.economy.gdpGrowth += effects.gdpGrowth;
  if (effects.unemployment) state.economy.unemployment = Math.max(2, state.economy.unemployment + effects.unemployment);
  if (effects.satisfaction) state.population.satisfaction = Math.max(5, Math.min(98, state.population.satisfaction + effects.satisfaction));
  if (effects.budget) state.economy.budget += effects.budget;
  if (effects.inflation) state.economy.inflation = Math.max(0.1, state.economy.inflation + effects.inflation);
  if (effects.exports) state.economy.exports = Math.max(10, state.economy.exports + effects.exports);
  if (effects.foreignInvestment) state.economy.foreignInvestment = Math.max(0, state.economy.foreignInvestment + effects.foreignInvestment);
  if (effects.production) state.economy.industrialProduction = Math.max(15, Math.min(95, state.economy.industrialProduction + effects.production));
  if (effects.resources) {
    state.economy.naturalResources = Math.min(95, state.economy.naturalResources + effects.resources);
    // Distribute a bit
    state.resources.oil += effects.resources * 0.3;
    state.resources.gas += effects.resources * 0.2;
  }
  if (effects.techLevel) state.tech.level = Math.min(95, state.tech.level + effects.techLevel);
  if (effects.stability) state.economy.stability = Math.max(10, Math.min(95, state.economy.stability + effects.stability));
  if (effects.relationsPenalty) {
    Object.keys(state.diplomacy.relations).forEach(k => {
      state.diplomacy.relations[k] = Math.max(5, state.diplomacy.relations[k] - effects.relationsPenalty * 0.6);
    });
  }
}

// Manual trigger for testing / special
function forceEvent(state, eventId) {
  const template = EVENT_TEMPLATES.find(e => e.id === eventId);
  if (template) triggerEvent(state, template);
  return state;
}
