/**
 * Save / Load System using localStorage
 */
const SAVE_KEY = 'godworld_v1_save';

export class SaveSystem {
  save(worldState) {
    try {
      const json = JSON.stringify(worldState);
      localStorage.setItem(SAVE_KEY, json);
      return true;
    } catch (e) {
      console.error('Save failed:', e);
      return false;
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('Load failed:', e);
      return null;
    }
  }

  hasSave() {
    return !!localStorage.getItem(SAVE_KEY);
  }

  clear() {
    localStorage.removeItem(SAVE_KEY);
  }
}
