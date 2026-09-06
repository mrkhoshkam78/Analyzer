/**
 * Blessing System
 */
export class BlessingSystem {
  constructor() {
    this.nextId = 1;
  }

  bless(target, type = 'all', worldTime = 0) {
    const blessing = {
      id: this.nextId++,
      type, // happiness, faith, wealth, loyalty, all
      active: true,
      createdAt: worldTime,
      strength: 1
    };

    if (Array.isArray(target)) {
      // Multiple NPCs
      for (const npc of target) {
        npc.applyBlessing({ ...blessing });
      }
    } else if (target.applyBlessing) {
      // Single NPC
      target.applyBlessing(blessing);
    } else if (target.memberIds) {
      // Tribe - applied later via members
      target.applyBlessing(blessing);
    }

    return blessing;
  }
}
