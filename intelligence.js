// intelligence.js - Intelligence & Covert Operations

function processIntelligenceTick(state) {
  const intel = state.intelligence;

  // Level slowly improves with budget
  if (intel.budget > 6) {
    intel.level = Math.min(90, intel.level + 0.15);
    intel.foreign = Math.min(90, intel.foreign + 0.12);
    intel.domestic = Math.min(90, intel.domestic + 0.1);
    intel.counter = Math.min(90, intel.counter + 0.1);
  } else if (intel.budget < 3) {
    intel.level = Math.max(15, intel.level - 0.2);
  }

  // Process ongoing operations
  state.intelligence.operations = state.intelligence.operations.filter(op => {
    op.remaining -= 1;
    if (op.remaining <= 0) {
      resolveCovertOperation(state, op);
      return false;
    }
    return true;
  });

  return state;
}

function setIntelligenceBudget(state, amount) {
  amount = Math.max(1, Math.min(20, amount));
  state.intelligence.budget = amount;
  logAction(state, `بودجه سازمان اطلاعات به ${amount} تنظیم شد`);
  return state;
}

function startCovertOperation(state, type, targetId) {
  const m = getDifficultyMultipliers();
  const intel = state.intelligence;
  const target = COUNTRIES.find(c => c.id === targetId);

  if (!target || target.isPlayer) {
    return { success: false, message: 'هدف نامعتبر است' };
  }

  const costs = {
    spy: 6,
    sabotage: 12,
    infiltrate: 9,
    targeted: 15
  };
  const cost = costs[type] || 8;
  const duration = type === 'spy' ? 2 : type === 'sabotage' ? 4 : 3;

  if (state.economy.budget < cost) {
    return { success: false, message: 'بودجه عملیات مخفی کافی نیست' };
  }
  if (intel.operations.length >= 3) {
    return { success: false, message: 'حداکثر ۳ عملیات همزمان مجاز است' };
  }

  state.economy.budget -= cost;

  // Success base chance
  let baseChance = 0.4 + (intel.foreign / 100) * 0.35 + (intel.level / 100) * 0.2;
  baseChance += m.covertSuccessBonus;
  baseChance -= (target.stability || 50) / 300;
  baseChance = Math.max(0.12, Math.min(0.82, baseChance));

  const op = {
    id: 'op_' + Date.now(),
    type,
    targetId,
    targetName: target.name,
    remaining: duration,
    total: duration,
    successChance: baseChance,
    cost
  };

  intel.operations.push(op);
  logAction(state, `عملیات مخفی (${type}) علیه ${target.name} آغاز شد`);
  return { success: true, state, operation: op };
}

function resolveCovertOperation(state, op) {
  const success = Math.random() < op.successChance;
  const m = getDifficultyMultipliers();
  const targetId = op.targetId;

  if (success) {
    switch (op.type) {
      case 'spy':
        // Gain intel, slight relation drop if discovered later but for now pure gain
        state.intelligence.level = Math.min(92, state.intelligence.level + 3);
        state.intelligence.foreign = Math.min(92, state.intelligence.foreign + 4);
        state.alerts.push({ type: 'success', text: `جاسوسی از ${op.targetName} موفقیت‌آمیز بود. اطلاعات ارزشمند کسب شد.` });
        break;
      case 'sabotage':
        // Hurt target economy/military mildly (simulated)
        state.alerts.push({ type: 'success', text: `خرابکاری در ${op.targetName} انجام شد. زیرساخت‌های دشمن آسیب دید.` });
        state.diplomacy.relations[targetId] = Math.max(5, (state.diplomacy.relations[targetId] || 40) - 8);
        break;
      case 'infiltrate':
        state.intelligence.foreign = Math.min(92, state.intelligence.foreign + 5);
        state.intelligence.level = Math.min(92, state.intelligence.level + 2);
        state.alerts.push({ type: 'success', text: `نفوذ اطلاعاتی در ${op.targetName} برقرار شد.` });
        break;
      case 'targeted':
        state.diplomacy.relations[targetId] = Math.max(5, (state.diplomacy.relations[targetId] || 40) - 18);
        state.alerts.push({ type: 'warning', text: `عملیات هدفمند علیه ${op.targetName} اجرا شد. تنش دیپلماتیک افزایش یافت.` });
        break;
    }
    logAction(state, `عملیات ${op.type} علیه ${op.targetName} موفق بود`);
  } else {
    // Failure + exposure risk
    const exposureChance = 0.35 + (1 - op.successChance) * 0.3;
    const exposed = Math.random() < exposureChance * (m.advisorRisk || 1);

    state.diplomacy.relations[targetId] = Math.max(5, (state.diplomacy.relations[targetId] || 40) - 12);

    if (exposed) {
      // Severe consequences
      state.population.satisfaction = Math.max(5, state.population.satisfaction - 4);
      state.alerts.push({
        type: 'danger',
        text: `عملیات مخفی علیه ${op.targetName} افشا شد! بحران دیپلماتیک و احتمال تحریم.`
      });

      // Chance of new sanction
      if (Math.random() < 0.45 * m.sanctionImpact) {
        const existing = state.diplomacy.sanctions.find(s => s.from === targetId);
        if (!existing) {
          state.diplomacy.sanctions.push({
            from: targetId,
            fromName: op.targetName,
            severity: 1 + Math.floor(Math.random() * 2),
            startDay: state.time.totalDays,
            reason: 'عملیات مخفی افشا شده'
          });
          state.alerts.push({ type: 'danger', text: `${op.targetName} تحریم‌هایی علیه کشور اعمال کرد.` });
        }
      }
      logAction(state, `عملیات ${op.type} علیه ${op.targetName} شکست خورد و افشا شد`);
    } else {
      state.alerts.push({ type: 'warning', text: `عملیات مخفی علیه ${op.targetName} ناموفق بود (بدون افشا).` });
      logAction(state, `عملیات ${op.type} علیه ${op.targetName} ناموفق بود`);
    }
  }
}

function gatherIntel(state) {
  const cost = 3;
  if (state.economy.budget < cost) return { success: false, message: 'بودجه ناکافی' };
  state.economy.budget -= cost;
  state.intelligence.level = Math.min(90, state.intelligence.level + 1.5);
  state.intelligence.domestic = Math.min(90, state.intelligence.domestic + 1);
  state.intelligence.foreign = Math.min(90, state.intelligence.foreign + 1.2);

  // Discover random threat chance
  if (Math.random() < 0.25) {
    state.intelligence.discoveredThreats.push({
      id: 'threat_' + Date.now(),
      text: 'فعالیت مشکوک در مرز شرقی شناسایی شد',
      severity: 1 + Math.floor(Math.random() * 2)
    });
    if (state.intelligence.discoveredThreats.length > 5) {
      state.intelligence.discoveredThreats.shift();
    }
  }

  logAction(state, 'جمع‌آوری اطلاعات انجام شد');
  return { success: true, state };
}
