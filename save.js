// save.js - LocalStorage Save / Load / New Game

const SAVE_KEY = 'president_sim_v1_save';
const META_KEY = 'president_sim_v1_meta';

function saveGame() {
  const state = getState();
  if (!state) return { success: false, message: 'هیچ بازی فعالی وجود ندارد' };

  try {
    state.meta.lastSaved = Date.now();
    const data = JSON.stringify(state);
    localStorage.setItem(SAVE_KEY, data);
    localStorage.setItem(META_KEY, JSON.stringify({
      difficulty: state.meta.difficulty,
      year: state.time.year,
      month: state.time.month,
      day: state.time.day,
      countryName: state.country.name,
      savedAt: state.meta.lastSaved
    }));
    return { success: true, message: 'بازی با موفقیت ذخیره شد' };
  } catch (err) {
    console.error('Save failed', err);
    return { success: false, message: 'خطا در ذخیره‌سازی (احتمالاً حجم داده)' };
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { success: false, message: 'هیچ ذخیره قبلی یافت نشد' };

    const state = JSON.parse(raw);
    // Basic validation
    if (!state.meta || !state.economy || !state.time) {
      return { success: false, message: 'فایل ذخیره نامعتبر است' };
    }

    setState(state);
    return { success: true, state, message: 'بازی بارگذاری شد' };
  } catch (err) {
    console.error('Load failed', err);
    return { success: false, message: 'خطا در بارگذاری ذخیره' };
  }
}

function hasSave() {
  return !!localStorage.getItem(SAVE_KEY);
}

function getSaveMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function deleteSave() {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(META_KEY);
}

function newGame(difficultyId) {
  // Completely clear previous state
  deleteSave();
  const state = resetState(difficultyId);
  // Also clear any residual
  setState(state);
  return state;
}

// Auto-save every few ticks (called from game loop)
function autoSaveIfNeeded(state) {
  if (!state || !state.meta) return;
  const now = Date.now();
  if (!state.meta.lastSaved || (now - state.meta.lastSaved) > 120000) { // every ~2 min
    saveGame();
  }
}
