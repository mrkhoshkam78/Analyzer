// ui.js - UI updates and event bindings

let currentPanel = 'dashboard';

function $(id) {
  return document.getElementById(id);
}

function showPanel(panelId) {
  currentPanel = panelId;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const panel = $(panelId);
  if (panel) panel.classList.add('active');
  const btn = document.querySelector(`[data-panel="${panelId}"]`);
  if (btn) btn.classList.add('active');
  refreshUI();
}

function refreshUI() {
  const state = getState();
  if (!state) return;

  updateHeader(state);
  updateDashboard(state);
  updateEconomyPanel(state);
  updateMilitaryPanel(state);
  updateIntelPanel(state);
  updateDiplomacyPanel(state);
  updateAdvisorPanel(state);
  updateResourcesPanel(state);
  updatePopulationPanel(state);
  updateAlerts(state);
  updateTimeControls(state);
}

function updateHeader(state) {
  const e = state.economy;
  const pop = state.population;
  $('hdr-country').textContent = state.country.name;
  $('hdr-date').textContent = `${state.time.year}/${String(state.time.month).padStart(2, '0')}/${String(state.time.day).padStart(2, '0')}`;
  $('hdr-diff').textContent = state.meta.difficultyName;
  $('hdr-gdp').textContent = e.gdp.toFixed(1);
  $('hdr-growth').textContent = (e.gdpGrowth >= 0 ? '+' : '') + e.gdpGrowth.toFixed(1) + '%';
  $('hdr-growth').className = e.gdpGrowth >= 0 ? 'positive' : 'negative';
  $('hdr-inflation').textContent = e.inflation.toFixed(1) + '%';
  $('hdr-unemp').textContent = e.unemployment.toFixed(1) + '%';
  $('hdr-sat').textContent = pop.satisfaction.toFixed(0);
  $('hdr-budget').textContent = e.budget.toFixed(1);

  // Color coding
  $('hdr-sat').className = pop.satisfaction >= 55 ? 'positive' : pop.satisfaction < 35 ? 'negative' : '';
  $('hdr-budget').className = e.budget >= 0 ? 'positive' : 'negative';
}

function updateDashboard(state) {
  const e = state.economy;
  const mil = state.military;
  const pop = state.population;

  setText('dash-gdp', e.gdp.toFixed(1) + ' B');
  setText('dash-growth', (e.gdpGrowth >= 0 ? '+' : '') + e.gdpGrowth.toFixed(2) + '%');
  setText('dash-inflation', e.inflation.toFixed(1) + '%');
  setText('dash-unemp', e.unemployment.toFixed(1) + '%');
  setText('dash-debt', e.nationalDebt.toFixed(1));
  setText('dash-deficit', e.deficit.toFixed(1));
  setText('dash-sat', pop.satisfaction.toFixed(1));
  setText('dash-stability', e.stability);
  setText('dash-currency', e.currencyStrength);
  setText('dash-trade', e.tradeBalance.toFixed(1));
  setText('dash-attack', mil.attackPower);
  setText('dash-defense', mil.defensePower);
  setText('dash-readiness', mil.readiness);
  setText('dash-intel', state.intelligence.level);
  setText('dash-tech', state.tech.level);
  setText('dash-infra', e.infrastructure);
  setText('dash-pop', formatNumber(state.country.population));

  // Simple bars
  setBar('bar-sat', pop.satisfaction);
  setBar('bar-readiness', mil.readiness);
  setBar('bar-stability', e.stability);

  // Advisor preview on dashboard
  const preview = $('advisor-preview');
  if (preview && state.advisorSuggestions && state.advisorSuggestions.length) {
    preview.innerHTML = state.advisorSuggestions.map((s, i) => `
      <div class="advisor-card">
        <div class="adv-num">${i + 1}</div>
        <h4>${s.title}</h4>
        <p class="adv-desc">${s.description}</p>
      </div>
    `).join('');
  }
}

function updateEconomyPanel(state) {
  const e = state.economy;
  setText('eco-gdp', e.gdp.toFixed(1));
  setText('eco-growth', e.gdpGrowth.toFixed(2) + '%');
  setText('eco-inflation', e.inflation.toFixed(1) + '%');
  setText('eco-unemp', e.unemployment.toFixed(1) + '%');
  setText('eco-budget', e.budget.toFixed(1));
  setText('eco-revenue', e.revenue.toFixed(1));
  setText('eco-spending', e.spending.toFixed(1));
  setText('eco-deficit', e.deficit.toFixed(1));
  setText('eco-debt', e.nationalDebt.toFixed(1));
  setText('eco-tax', e.taxRate + '%');
  setText('eco-exports', e.exports.toFixed(1));
  setText('eco-imports', e.imports.toFixed(1));
  setText('eco-trade', e.tradeBalance.toFixed(1));
  setText('eco-currency', e.currencyStrength);
  setText('eco-fi', e.foreignInvestment.toFixed(1));
  setText('eco-prod', e.industrialProduction);
  setText('eco-resources', e.naturalResources);
  setText('eco-infra', e.infrastructure);

  // Tax slider value
  const taxSlider = $('tax-slider');
  if (taxSlider) taxSlider.value = e.taxRate;
  setText('tax-value', e.taxRate + '%');
}

function updateMilitaryPanel(state) {
  const mil = state.military;
  setText('mil-army', mil.army);
  setText('mil-air', mil.airForce);
  setText('mil-navy', mil.navy);
  setText('mil-defsys', mil.defenseSystems);
  setText('mil-budget', mil.budgetAmount.toFixed(1));
  setText('mil-tech', mil.technology);
  setText('mil-ready', mil.readiness);
  setText('mil-attack', mil.attackPower);
  setText('mil-defense', mil.defensePower);
  setText('mil-manpower', formatNumber(mil.manpower));

  setBar('bar-army', mil.army);
  setBar('bar-air', mil.airForce);
  setBar('bar-navy', mil.navy);
  setBar('bar-ready', mil.readiness);
}

function updateIntelPanel(state) {
  const intel = state.intelligence;
  setText('int-budget', intel.budget.toFixed(1));
  setText('int-level', intel.level.toFixed(0));
  setText('int-domestic', intel.domestic.toFixed(0));
  setText('int-foreign', intel.foreign.toFixed(0));
  setText('int-counter', intel.counter.toFixed(0));

  // Operations list
  const opList = $('intel-ops-list');
  if (opList) {
    if (intel.operations.length === 0) {
      opList.innerHTML = '<p class="muted">هیچ عملیات فعالی وجود ندارد</p>';
    } else {
      opList.innerHTML = intel.operations.map(op => `
        <div class="op-item">
          <strong>${op.type}</strong> → ${op.targetName}
          <span class="muted">(${op.remaining} ماه باقی‌مانده | شانس ${(op.successChance * 100).toFixed(0)}%)</span>
        </div>
      `).join('');
    }
  }

  // Threats
  const threatList = $('intel-threats');
  if (threatList) {
    if (!intel.discoveredThreats || intel.discoveredThreats.length === 0) {
      threatList.innerHTML = '<p class="muted">تهدید شناسایی‌شده‌ای نیست</p>';
    } else {
      threatList.innerHTML = intel.discoveredThreats.map(t => `
        <div class="threat-item">⚠ ${t.text}</div>
      `).join('');
    }
  }
}

function updateDiplomacyPanel(state) {
  const relContainer = $('relations-list');
  if (relContainer) {
    relContainer.innerHTML = Object.entries(state.diplomacy.relations).map(([id, val]) => {
      const status = getRelationStatus(val);
      const country = COUNTRIES.find(c => c.id === id);
      return `
        <div class="relation-row">
          <span class="flag">${country?.flag || '🏳️'}</span>
          <span class="name">${country?.name || id}</span>
          <span class="value ${status.class}">${val.toFixed(0)} — ${status.text}</span>
          <button class="btn-sm" onclick="actionImproveRelation('${id}')">بهبود</button>
        </div>
      `;
    }).join('');
  }

  // Agreements
  const agrList = $('agreements-list');
  if (agrList) {
    if (state.diplomacy.agreements.length === 0) {
      agrList.innerHTML = '<p class="muted">هیچ توافقی وجود ندارد</p>';
    } else {
      agrList.innerHTML = state.diplomacy.agreements.map(a => `
        <div class="agr-item">${getAgreementName(a.type)} با ${a.targetName}</div>
      `).join('');
    }
  }

  // Sanctions
  const sanList = $('sanctions-list');
  if (sanList) {
    if (state.diplomacy.sanctions.length === 0) {
      sanList.innerHTML = '<p class="muted positive">هیچ تحریمی فعال نیست</p>';
    } else {
      sanList.innerHTML = state.diplomacy.sanctions.map(s => `
        <div class="san-item negative">
          تحریم از ${s.fromName || s.from} (شدت ${s.severity})
          <button class="btn-sm" onclick="actionLiftSanction('${s.from}')">مذاکره رفع</button>
        </div>
      `).join('');
    }
  }
}

function updateAdvisorPanel(state) {
  const container = $('advisor-cards');
  if (!container) return;
  const suggestions = state.advisorSuggestions || [];
  if (suggestions.length === 0) {
    container.innerHTML = '<p class="muted">در حال تحلیل...</p>';
    return;
  }
  container.innerHTML = suggestions.map((s, i) => `
    <div class="advisor-card">
      <div class="adv-num">${i + 1}</div>
      <h4>${s.title}</h4>
      <p class="adv-desc">${s.description}</p>
      <p class="adv-reason"><strong>دلیل:</strong> ${s.reason}</p>
      <p class="adv-pros"><strong>مزایا:</strong> ${s.pros}</p>
      <p class="adv-risks"><strong>ریسک/هزینه:</strong> ${s.risks}</p>
      <p class="adv-impact"><strong>تأثیر احتمالی:</strong> ${s.impact}</p>
    </div>
  `).join('');
}

function updateResourcesPanel(state) {
  const res = state.resources;
  setText('res-oil', res.oil.toFixed(1));
  setText('res-gas', res.gas.toFixed(1));
  setText('res-minerals', res.minerals.toFixed(1));
  setText('res-agri', res.agriculture.toFixed(1));
  setText('res-rare', res.rare_earth.toFixed(1));
}

function updatePopulationPanel(state) {
  const pop = state.population;
  setText('pop-total', formatNumber(state.country.population));
  setText('pop-sat', pop.satisfaction.toFixed(1));
  setText('pop-happy', pop.happiness);
  setText('pop-health', pop.health);
  setText('pop-edu', pop.education);
  setText('pop-poverty', pop.povertyRate + '%');
  setBar('bar-pop-sat', pop.satisfaction);
}

function updateAlerts(state) {
  const box = $('alerts-box');
  if (!box) return;
  const alerts = state.alerts || [];
  if (alerts.length === 0) {
    box.innerHTML = '<p class="muted">هشداری وجود ندارد</p>';
    return;
  }
  box.innerHTML = alerts.slice(0, 6).map(a => `
    <div class="alert alert-${a.type || 'info'}">${a.text}</div>
  `).join('');
}

function updateTimeControls(state) {
  const speed = state.meta.speed;
  document.querySelectorAll('.speed-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.speed) === speed);
  });
  $('btn-pause').classList.toggle('active', speed === 0);
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function setBar(id, value) {
  const el = $(id);
  if (el) el.style.width = Math.max(0, Math.min(100, value)) + '%';
}

function formatNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  return n.toString();
}

function showToast(msg, type = 'info') {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show toast-' + type;
  setTimeout(() => toast.classList.remove('show'), 3200);
}

function showModal(title, bodyHtml, onConfirm) {
  const modal = $('modal');
  const titleEl = $('modal-title');
  const bodyEl = $('modal-body');
  if (!modal) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;
  modal.classList.add('show');
  $('modal-confirm').onclick = () => {
    modal.classList.remove('show');
    if (onConfirm) onConfirm();
  };
  $('modal-cancel').onclick = () => modal.classList.remove('show');
}

// ===== Action handlers (called from HTML) =====

function actionChangeTax() {
  const val = parseInt($('tax-slider').value);
  let state = getState();
  state = changeTaxRate(state, val);
  setState(state);
  refreshUI();
  showToast('نرخ مالیات به ' + val + '% تغییر کرد', 'info');
}

function actionInvestInfra() {
  const amount = parseInt($('infra-amount').value) || 10;
  let state = getState();
  const result = investInfrastructure(state, amount);
  if (!result.success) {
    showToast(result.message, 'danger');
    return;
  }
  setState(result.state);
  refreshUI();
  showToast('پروژه زیرساخت آغاز شد', 'success');
}

function actionMilBudget() {
  const val = parseFloat($('mil-budget-input').value) || 12;
  let state = getState();
  state = adjustMilitaryBudget(state, val);
  setState(state);
  refreshUI();
  showToast('بودجه نظامی تنظیم شد', 'info');
}

function actionDevelopForce(type) {
  const amount = parseInt($('force-amount').value) || 8;
  let state = getState();
  const result = developForce(state, type, amount);
  if (!result.success) {
    showToast(result.message, 'danger');
    return;
  }
  setState(result.state);
  refreshUI();
  showToast('توسعه نیرو آغاز شد', 'success');
}

function actionResearchMil() {
  const points = parseInt($('research-points').value) || 5;
  let state = getState();
  const result = researchMilitaryTech(state, points);
  if (!result.success) {
    showToast(result.message, 'danger');
    return;
  }
  setState(result.state);
  refreshUI();
  showToast('تحقیق نظامی انجام شد', 'success');
}

function actionTrain() {
  let state = getState();
  const result = setReadinessFocus(state, 'train');
  if (!result.success) {
    showToast(result.message, 'danger');
    return;
  }
  setState(result.state);
  refreshUI();
  showToast('تمرینات نظامی انجام شد', 'success');
}

function actionIntelBudget() {
  const val = parseFloat($('intel-budget-input').value) || 4;
  let state = getState();
  state = setIntelligenceBudget(state, val);
  setState(state);
  refreshUI();
  showToast('بودجه اطلاعات تنظیم شد', 'info');
}

function actionGatherIntel() {
  let state = getState();
  const result = gatherIntel(state);
  if (!result.success) {
    showToast(result.message, 'danger');
    return;
  }
  setState(result.state);
  refreshUI();
  showToast('اطلاعات جمع‌آوری شد', 'success');
}

function actionStartCovert(type) {
  const targetId = $('covert-target').value;
  if (!targetId) {
    showToast('هدف را انتخاب کنید', 'warning');
    return;
  }
  let state = getState();
  const result = startCovertOperation(state, type, targetId);
  if (!result.success) {
    showToast(result.message, 'danger');
    return;
  }
  setState(result.state);
  refreshUI();
  showToast('عملیات مخفی آغاز شد', 'success');
}

function actionImproveRelation(targetId) {
  let state = getState();
  const result = improveRelations(state, targetId, 6);
  if (!result.success) {
    showToast(result.message, 'danger');
    return;
  }
  setState(result.state);
  refreshUI();
  showToast('روابط بهبود یافت', 'success');
}

function actionProposeAgreement(type) {
  const targetId = $('agree-target').value;
  if (!targetId) {
    showToast('کشور هدف را انتخاب کنید', 'warning');
    return;
  }
  let state = getState();
  const result = proposeAgreement(state, targetId, type);
  if (!result.success) {
    showToast(result.message, 'danger');
    return;
  }
  setState(result.state);
  refreshUI();
  if (result.agreed) showToast('توافق امضا شد!', 'success');
  else showToast('پیشنهاد رد شد', 'warning');
}

function actionLiftSanction(fromId) {
  let state = getState();
  const result = liftSanction(state, fromId);
  if (!result.success) {
    showToast(result.message, 'danger');
    return;
  }
  setState(result.state);
  refreshUI();
  showToast('تحریم رفع شد', 'success');
}

function actionSave() {
  const result = saveGame();
  showToast(result.message, result.success ? 'success' : 'danger');
}

function actionLoad() {
  const result = loadGame();
  if (result.success) {
    showToast(result.message, 'success');
    refreshUI();
    startGameLoop();
  } else {
    showToast(result.message, 'danger');
  }
}
