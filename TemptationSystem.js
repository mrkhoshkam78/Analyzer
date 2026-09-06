/**
 * Temptation System - Non-deterministic temptation force
 */
export class TemptationSystem {
  constructor() {
    this.nextId = 1;
  }

  tempt(targets, worldTime = 0) {
    const results = [];
    const list = Array.isArray(targets) ? targets : [targets];

    for (const npc of list) {
      if (!npc || !npc.applyTemptation) continue;

      const temptation = {
        id: this.nextId++,
        active: true,
        accepted: false,
        resolved: false,
        createdAt: worldTime
      };

      const outcome = npc.applyTemptation(temptation);
      results.push({ npc, outcome, temptation });
    }

    return results;
  }
}
