// military.js - Military system

function updateMilitaryPowers(state) {
  const mil = state.military;
  const techBonus = (state.tech.level - 40) * 0.25;
  const readinessFactor = mil.readiness / 100;

  mil.attackPower = Math.round(
    (mil.army * 0.4 + mil.airForce * 0.35 + mil.navy * 0.25 + techBonus) * readinessFactor
  );
  mil.defensePower = Math.round(
    (mil.army * 0.3 + mil.defenseSystems * 0.4 + mil.airForce * 0.2 + techBonus) * readinessFactor
  );
  return state;
}

function processMilitaryTick(state) {
  const mil = state.military;
  // Readiness slowly decays if underfunded
  if (mil.budgetAmount < 10) {
    mil.readiness = Math.max(20, mil.readiness - 0.4);
  } else if (mil.budgetAmount > 20) {
    mil.readiness = Math.min(95, mil.readiness + 0.25);
  }

  // Manpower linked to population & unemployment mildly
  mil.manpower = Math.round(state.country.population * 0.0065 * (1 - state.economy.unemployment / 100));

  updateMilitaryPowers(state);

  // Process active projects of type military
  state.projects = state.projects.filter(p => {
    if (p.type === 'military' || p.type === 'defense') {
      p.remaining -= 1;
      if (p.remaining <= 0) {
        if (p.effect.army) mil.army = Math.min(95, mil.army + p.effect.army);
        if (p.effect.airForce) mil.airForce = Math.min(95, mil.airForce + p.effect.airForce);
        if (p.effect.navy) mil.navy = Math.min(95, mil.navy + p.effect.navy);
        if (p.effect.defenseSystems) mil.defenseSystems = Math.min(95, mil.defenseSystems + p.effect.defenseSystems);
        if (p.effect.technology) mil.technology = Math.min(95, mil.technology + p.effect.technology);
        if (p.effect.readiness) mil.readiness = Math.min(95, mil.readiness + p.effect.readiness);
        logAction(state, `پروژه نظامی «${p.name}» تکمیل شد`);
        return false;
      }
    }
    return true;
  });

  return state;
}

function developForce(state, forceType, amount) {
  const m = getDifficultyMultipliers();
  const cost = Math.round(amount * 2.8 * m.militaryCost);
  if (state.economy.budget < cost) {
    return { success: false, message: 'بودجه کافی برای توسعه نیرو وجود ندارد' };
  }
  state.economy.budget -= cost;

  const duration = Math.max(2, Math.round(3 + amount / 8));
  const effect = {};
  effect[forceType] = Math.round(amount * 0.4);

  state.projects.push({
    id: 'mil_' + forceType + '_' + Date.now(),
    type: 'military',
    name: `توسعه ${forceType === 'army' ? 'ارتش' : forceType === 'airForce' ? 'نیروی هوایی' : forceType === 'navy' ? 'نیروی دریایی' : 'سامانه دفاعی'}`,
    remaining: duration,
    total: duration,
    effect
  });

  // Political cost: slight satisfaction drop for high spending
  if (amount > 15) {
    state.population.satisfaction = Math.max(5, state.population.satisfaction - 1.5);
  }

  logAction(state, `توسعه ${forceType} با هزینه ${cost} آغاز شد`);
  updateMilitaryPowers(state);
  return { success: true, state };
}

function researchMilitaryTech(state, points) {
  const m = getDifficultyMultipliers();
  const cost = Math.round(points * 1.8 * m.techCost);
  if (state.economy.budget < cost) {
    return { success: false, message: 'بودجه تحقیق کافی نیست' };
  }
  state.economy.budget -= cost;
  state.military.technology = Math.min(95, state.military.technology + Math.round(points * 0.35));
  state.tech.level = Math.min(95, state.tech.level + Math.round(points * 0.15));
  state.tech.researchPoints += points;

  logAction(state, `تحقیق فناوری نظامی: +${points} امتیاز`);
  updateMilitaryPowers(state);
  return { success: true, state };
}

function setReadinessFocus(state, focus) {
  // focus: 'train' increases readiness faster but costs more
  if (focus === 'train') {
    if (state.economy.budget < 5) return { success: false, message: 'بودجه ناکافی' };
    state.economy.budget -= 5;
    state.military.readiness = Math.min(98, state.military.readiness + 4);
    logAction(state, 'تمرینات نظامی فشرده انجام شد');
  }
  updateMilitaryPowers(state);
  return { success: true, state };
}

function launchAttack(state, targetId) {
  // Simplified combat resolution for V1
  const target = COUNTRIES.find(c => c.id === targetId);
  if (!target || target.isPlayer) return { success: false, message: 'هدف نامعتبر' };

  const mil = state.military;
  if (mil.readiness < 40) {
    return { success: false, message: 'آمادگی نیروها برای حمله کافی نیست' };
  }

  const cost = Math.round(18 + mil.attackPower * 0.15);
  if (state.economy.budget < cost) {
    return { success: false, message: 'هزینه عملیات نظامی تأمین نشده' };
  }

  state.economy.budget -= cost;
  mil.readiness = Math.max(25, mil.readiness - 8);
  state.population.satisfaction = Math.max(5, state.population.satisfaction - 4);

  // Success chance based on power difference + difficulty
  const m = getDifficultyMultipliers();
  const powerDiff = mil.attackPower - (target.militaryPower || 50);
  let successChance = 0.45 + powerDiff * 0.008 + m.covertSuccessBonus;
  successChance = Math.max(0.15, Math.min(0.85, successChance));

  const success = Math.random() < successChance;

  if (success) {
    // Improve relations with allies? For V1 just log and slight gain
    state.diplomacy.relations[targetId] = Math.max(5, (state.diplomacy.relations[targetId] || 40) - 25);
    logAction(state, `حمله به ${target.name} موفقیت‌آمیز بود (روابط به شدت آسیب دید)`);
    state.alerts.push({ type: 'warning', text: `حمله به ${target.name} انجام شد. پیامدهای دیپلماتیک سنگین.` });
  } else {
    state.diplomacy.relations[targetId] = Math.max(5, (state.diplomacy.relations[targetId] || 40) - 15);
    mil.readiness = Math.max(15, mil.readiness - 6);
    logAction(state, `حمله به ${target.name} ناموفق بود`);
    state.alerts.push({ type: 'danger', text: `عملیات نظامی علیه ${target.name} شکست خورد.` });
  }

  updateMilitaryPowers(state);
  return { success: true, combatSuccess: success, state };
}
