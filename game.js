// game.js - Main game loop, time simulation, orchestration

let gameInterval = null;
const TICK_MS = 2200; // base ms per month at speed 1

function startNewGame(difficultyId) {
  newGame(difficultyId);
  const state = getState();
  state.meta.isRunning = true;
  state.meta.speed = 1;
  generateAdvisorSuggestions(state);
  setState(state);
  hideStartScreen();
  refreshUI();
  startGameLoop();
  showToast('بازی جدید آغاز شد — ' + DIFFICULTY[difficultyId].name, 'success');
}

function hideStartScreen() {
  const start = $('start-screen');
  const game = $('game-container');
  if (start) start.style.display = 'none';
  if (game) game.style.display = 'flex';
}

function showStartScreen() {
  const start = $('start-screen');
  const game = $('game-container');
  if (start) start.style.display = 'flex';
  if (game) game.style.display = 'none';
  stopGameLoop();
}

function startGameLoop() {
  stopGameLoop();
  const state = getState();
  if (!state) return;
  state.meta.isRunning = true;
  setState(state);

  gameInterval = setInterval(() => {
    const s = getState();
    if (!s || s.meta.speed === 0 || s.meta.gameOver) return;

    // Run multiple ticks for fast speed
    const ticks = s.meta.speed === 3 ? 3 : 1;
    for (let i = 0; i < ticks; i++) {
      processTick();
    }
    refreshUI();
  }, TICK_MS);
}

function stopGameLoop() {
  if (gameInterval) {
    clearInterval(gameInterval);
    gameInterval = null;
  }
}

function setSpeed(speed) {
  const state = getState();
  if (!state) return;
  state.meta.speed = speed;
  setState(state);
  updateTimeControls(state);
  if (speed > 0 && !gameInterval) startGameLoop();
}

function processTick() {
  let state = getState();
  if (!state || state.meta.gameOver) return;

  // Advance time (1 month per tick for simplicity in V1)
  state.time.month += 1;
  if (state.time.month > 12) {
    state.time.month = 1;
    state.time.year += 1;
  }
  state.time.day = 1;
  state.time.totalDays += 30;
  state.meta.tickCount += 1;

  // Core systems in order
  state = processEconomyTick(state);
  state = processMilitaryTick(state);
  state = processIntelligenceTick(state);
  state = processDiplomacyTick(state);
  state = processEvents(state);

  // Progress general projects
  state.projects = state.projects.filter(p => {
    if (p.type === 'infrastructure') {
      p.remaining -= 1;
      if (p.remaining <= 0) {
        if (p.effect.infrastructure) state.economy.infrastructure = Math.min(95, state.economy.infrastructure + p.effect.infrastructure);
        if (p.effect.production) state.economy.industrialProduction = Math.min(95, state.economy.industrialProduction + p.effect.production);
        logAction(state, `پروژه زیرساخت تکمیل شد`);
        state.alerts.push({ type: 'success', text: 'پروژه زیرساخت به پایان رسید.' });
        return false;
      }
    }
    return true;
  });

  // Advisor refresh every tick
  generateAdvisorSuggestions(state);

  // Check game over conditions (Realistic especially)
  checkGameOver(state);

  // Auto save occasionally
  if (state.meta.tickCount % 6 === 0) {
    autoSaveIfNeeded(state);
  }

  setState(state);
}

function checkGameOver(state) {
  if (state.population.satisfaction < 8 && state.economy.stability < 15) {
    state.meta.gameOver = true;
    state.meta.gameOverReason = 'سقوط محبوبیت و بی‌ثباتی شدید منجر به فروپاشی حکومت شد.';
    stopGameLoop();
    showToast('بازی تمام شد: ' + state.meta.gameOverReason, 'danger');
  }
  if (state.economy.nationalDebt > 900 && state.economy.gdp < 200) {
    state.meta.gameOver = true;
    state.meta.gameOverReason = 'بحران بدهی ملی غیرقابل کنترل.';
    stopGameLoop();
    showToast('بازی تمام شد: ' + state.meta.gameOverReason, 'danger');
  }
}

// Called on page load
function initApp() {
  // Check for existing save
  const meta = getSaveMeta();
  if (meta) {
    const loadBtn = $('btn-continue');
    if (loadBtn) {
      loadBtn.style.display = 'inline-block';
      loadBtn.textContent = `ادامه بازی (${meta.year}/${meta.month} — ${meta.difficulty})`;
    }
  }

  // Bind speed buttons
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = parseInt(btn.dataset.speed);
      setSpeed(speed);
    });
  });

  // Nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showPanel(btn.dataset.panel);
    });
  });
}

// Global helpers used by HTML onclick
window.startNewGame = startNewGame;
window.setSpeed = setSpeed;
window.actionChangeTax = actionChangeTax;
window.actionInvestInfra = actionInvestInfra;
window.actionMilBudget = actionMilBudget;
window.actionDevelopForce = actionDevelopForce;
window.actionResearchMil = actionResearchMil;
window.actionTrain = actionTrain;
window.actionIntelBudget = actionIntelBudget;
window.actionGatherIntel = actionGatherIntel;
window.actionStartCovert = actionStartCovert;
window.actionImproveRelation = actionImproveRelation;
window.actionProposeAgreement = actionProposeAgreement;
window.actionLiftSanction = actionLiftSanction;
window.actionSave = actionSave;
window.actionLoad = actionLoad;
window.showPanel = showPanel;
window.showStartScreen = showStartScreen;

document.addEventListener('DOMContentLoaded', initApp);
