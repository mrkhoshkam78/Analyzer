/**
 * Religion System
 */
import { Religion } from './Religion.js';

export class ReligionSystem {
  constructor() {
    this.religions = [];
    this.nextId = 1;
  }

  create({ name, doctrine, color, symbol, founderId, worldTime }) {
    const religion = new Religion({
      id: this.nextId++,
      name,
      doctrine,
      color: color || '#a29bfe',
      symbol: symbol || '✦',
      founderId,
      followerIds: founderId ? [founderId] : [],
      createdAt: worldTime
    });
    this.religions.push(religion);
    return religion;
  }

  getById(id) {
    return this.religions.find(r => r.id === id);
  }

  update(dt, npcSystem) {
    // Spread religion to nearby NPCs with low faith or no religion
    for (const religion of this.religions) {
      if (religion.followerIds.length === 0) continue;

      const followers = religion.followerIds
        .map(id => npcSystem.getById(id))
        .filter(Boolean);

      for (const follower of followers) {
        if (!follower) continue;
        const nearby = npcSystem.getNear(follower.x, follower.y, 40);
        for (const other of nearby) {
          if (other.id === follower.id) continue;
          if (other.religionId === religion.id) continue;

          // Chance based on follower faith and target openness
          const chance = religion.spreadRate * dt * (follower.faith / 100) * ((100 - other.faith) / 100 + 0.2);
          if (Math.random() < chance) {
            // Convert
            if (other.religionId) {
              const oldRel = this.getById(other.religionId);
              if (oldRel) oldRel.removeFollower(other.id);
            }
            other.setReligion(religion.id);
            religion.addFollower(other.id);
          }
        }
      }
    }
  }

  toJSON() {
    return {
      religions: this.religions.map(r => r.toJSON()),
      nextId: this.nextId
    };
  }

  fromJSON(data) {
    this.religions = (data.religions || []).map(d => Religion.fromJSON(d));
    this.nextId = data.nextId || (this.religions.length + 1);
  }
}
