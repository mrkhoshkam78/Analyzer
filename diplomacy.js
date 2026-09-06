// diplomacy.js - Diplomacy, Agreements, Sanctions

function processDiplomacyTick(state) {
  // Mild natural drift of relations based on relative power & interests
  const m = getDifficultyMultipliers();
  Object.keys(state.diplomacy.relations).forEach(cid => {
    let rel = state.diplomacy.relations[cid];
    const country = COUNTRIES.find(c => c.id === cid);
    if (!country) return;

    // Drift toward neutral slightly
    if (rel > 55) rel -= 0.08;
    if (rel < 40) rel += 0.06;

    // AI aggressiveness affects negative drift
    if (country.militaryPower > state.military.attackPower + 15) {
      rel -= 0.05 * m.aiAggressiveness;
    }

    state.diplomacy.relations[cid] = Math.round(Math.max(5, Math.min(95, rel)) * 10) / 10;
  });

  // Process sanction duration (simple: last until lifted or 18+ months)
  state.diplomacy.sanctions = state.diplomacy.sanctions.filter(s => {
    const age = state.time.totalDays - (s.startDay || 0);
    if (age > 540) return false; // ~18 months auto expire for V1
    return true;
  });

  return state;
}

function improveRelations(state, targetId, amount = 5) {
  const cost = Math.round(4 + amount * 0.8);
  if (state.economy.budget < cost) {
    return { success: false, message: 'بودجه دیپلماسی کافی نیست' };
  }
  if (!state.diplomacy.relations[targetId]) {
    return { success: false, message: 'کشور هدف یافت نشد' };
  }

  state.economy.budget -= cost;
  state.diplomacy.relations[targetId] = Math.min(95,
    state.diplomacy.relations[targetId] + amount
  );
  logAction(state, `روابط با ${getCountryName(targetId)} بهبود یافت (+${amount})`);
  return { success: true, state };
}

function proposeAgreement(state, targetId, agreementType) {
  const costMap = {
    trade: 8,
    economic: 12,
    energy: 10,
    defense: 15,
    military: 18
  };
  const cost = costMap[agreementType] || 10;
  const requiredRelation = agreementType === 'military' || agreementType === 'defense' ? 55 : 40;

  if (state.economy.budget < cost) {
    return { success: false, message: 'بودجه مذاکره کافی نیست' };
  }
  if ((state.diplomacy.relations[targetId] || 0) < requiredRelation) {
    return { success: false, message: 'سطح روابط برای این توافق کافی نیست' };
  }

  // Check existing
  const exists = state.diplomacy.agreements.find(a => a.targetId === targetId && a.type === agreementType);
  if (exists) {
    return { success: false, message: 'این توافق قبلاً وجود دارد' };
  }

  state.economy.budget -= cost;

  // Success chance based on relations + difficulty
  const m = getDifficultyMultipliers();
  const rel = state.diplomacy.relations[targetId] || 40;
  let chance = 0.35 + (rel / 100) * 0.5;
  chance -= (m.aiAggressiveness - 1) * 0.1;
  chance = Math.max(0.2, Math.min(0.9, chance));

  if (Math.random() < chance) {
    state.diplomacy.agreements.push({
      id: 'agr_' + Date.now(),
      targetId,
      targetName: getCountryName(targetId),
      type: agreementType,
      startDay: state.time.totalDays,
      benefits: getAgreementBenefits(agreementType)
    });
    state.diplomacy.relations[targetId] = Math.min(95, rel + 6);
    applyAgreementEffects(state, agreementType, 1);
    logAction(state, `توافق ${agreementType} با ${getCountryName(targetId)} امضا شد`);
    state.alerts.push({ type: 'success', text: `توافق ${getAgreementName(agreementType)} با ${getCountryName(targetId)} نهایی شد.` });
    return { success: true, agreed: true, state };
  } else {
    state.diplomacy.relations[targetId] = Math.max(5, rel - 3);
    logAction(state, `پیشنهاد توافق ${agreementType} با ${getCountryName(targetId)} رد شد`);
    return { success: true, agreed: false, state };
  }
}

function getAgreementBenefits(type) {
  switch (type) {
    case 'trade': return { exports: 3, imports: -1, growth: 0.3 };
    case 'economic': return { foreignInvestment: 4, growth: 0.4 };
    case 'energy': return { resources: 5, inflation: -0.3 };
    case 'defense': return { readiness: 3, defensePower: 4 };
    case 'military': return { attackPower: 3, readiness: 2 };
    default: return {};
  }
}

function getAgreementName(type) {
  const names = {
    trade: 'تجاری',
    economic: 'اقتصادی',
    energy: 'انرژی',
    defense: 'دفاعی',
    military: 'نظامی'
  };
  return names[type] || type;
}

function applyAgreementEffects(state, type, direction = 1) {
  const benefits = getAgreementBenefits(type);
  if (benefits.exports) state.economy.exports += benefits.exports * direction;
  if (benefits.foreignInvestment) state.economy.foreignInvestment += benefits.foreignInvestment * direction;
  if (benefits.growth) state.economy.gdpGrowth += benefits.growth * direction;
  if (benefits.resources) state.economy.naturalResources += benefits.resources * direction;
  if (benefits.inflation) state.economy.inflation += benefits.inflation * direction;
  if (benefits.readiness) state.military.readiness = Math.min(95, state.military.readiness + benefits.readiness * direction);
  if (benefits.defensePower) state.military.defensePower += benefits.defensePower * direction;
  if (benefits.attackPower) state.military.attackPower += benefits.attackPower * direction;
}

function liftSanction(state, fromId) {
  const idx = state.diplomacy.sanctions.findIndex(s => s.from === fromId);
  if (idx === -1) return { success: false, message: 'تحریم یافت نشد' };

  const cost = 20;
  if (state.economy.budget < cost) {
    return { success: false, message: 'هزینه مذاکره برای رفع تحریم بالا است' };
  }
  if ((state.diplomacy.relations[fromId] || 0) < 35) {
    return { success: false, message: 'روابط برای مذاکره رفع تحریم کافی نیست' };
  }

  state.economy.budget -= cost;
  const removed = state.diplomacy.sanctions.splice(idx, 1)[0];
  state.diplomacy.relations[fromId] = Math.min(90, (state.diplomacy.relations[fromId] || 40) + 8);
  logAction(state, `تحریم از سوی ${removed.fromName || fromId} رفع شد`);
  state.alerts.push({ type: 'success', text: `تحریم ${removed.fromName} لغو شد.` });
  return { success: true, state };
}

function imposeSanction(state, targetId, severity = 1) {
  // Player imposing sanction (rare in V1, mostly AI does it)
  if (state.diplomacy.sanctions.some(s => s.from === 'player' && s.target === targetId)) {
    return { success: false, message: 'قبلاً تحریم اعمال شده' };
  }
  state.diplomacy.relations[targetId] = Math.max(5, (state.diplomacy.relations[targetId] || 40) - 15);
  // For V1 we mainly track incoming sanctions
  logAction(state, `تحریم علیه ${getCountryName(targetId)} اعلام شد`);
  return { success: true, state };
}

function getCountryName(id) {
  const c = COUNTRIES.find(x => x.id === id);
  return c ? c.name : id;
}

function getRelationStatus(value) {
  if (value >= 75) return { text: 'عالی', class: 'rel-excellent' };
  if (value >= 55) return { text: 'خوب', class: 'rel-good' };
  if (value >= 40) return { text: 'خنثی', class: 'rel-neutral' };
  if (value >= 25) return { text: 'تنش', class: 'rel-tense' };
  return { text: 'خصمانه', class: 'rel-hostile' };
}
