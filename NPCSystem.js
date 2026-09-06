/**
 * NPC System - Manages all characters
 */
import { NPC } from './NPC.js';

const NAMES = {
  male: ['آریا', 'کاوه', 'رستم', 'بهرام', 'سیاوش', 'داریوش', 'فرهاد', 'کیان', 'آرش', 'پدرام', 'نیما', 'سامان', 'هومن', 'بابک', 'فریدون'],
  female: ['آتنا', 'سارا', 'مینا', 'لیلا', 'نسترن', 'پریسا', 'الناز', 'شیوا', 'یاسمن', 'گلناز', 'مهسا', 'نیلوفر', 'فرشته', 'آیدا', 'زهرا']
};

export class NPCSystem {
  constructor() {
    this.npcs = [];
    this.nextId = 1;
  }

  generateForTribe(tribe, count = 12) {
    const generated = [];
    for (let i = 0; i < count; i++) {
      const isMale = Math.random() > 0.45;
      const nameList = isMale ? NAMES.male : NAMES.female;
      const name = nameList[Math.floor(Math.random() * nameList.length)] + (Math.random() > 0.7 ? ' ' + (isMale ? 'فرزند' : 'دخت') + ' ' + nameList[Math.floor(Math.random() * 5)] : '');

      const angle = Math.random() * Math.PI * 2;
      const dist = 20 + Math.random() * 50;
      const x = tribe.startX + Math.cos(angle) * dist;
      const y = tribe.startY + Math.sin(angle) * dist;

      const npc = new NPC({
        id: this.nextId++,
        name,
        tribeId: tribe.id,
        x,
        y,
        faith: tribe.faith + (Math.random() - 0.5) * 20,
        happiness: tribe.happiness + (Math.random() - 0.5) * 20,
        wealth: tribe.wealth + (Math.random() - 0.5) * 25
      });
      npc.color = tribe.color;
      npc.homeX = x;
      npc.homeY = y;

      this.npcs.push(npc);
      tribe.addMember(npc.id);
      generated.push(npc);
    }
    return generated;
  }

  update(dt, world) {
    for (const npc of this.npcs) {
      npc.update(dt, world);
    }
  }

  getById(id) {
    return this.npcs.find(n => n.id === id);
  }

  getByTribe(tribeId) {
    return this.npcs.filter(n => n.tribeId === tribeId);
  }

  getNear(x, y, radius) {
    return this.npcs.filter(n => {
      const dx = n.x - x;
      const dy = n.y - y;
      return dx * dx + dy * dy <= radius * radius;
    });
  }

  getAt(x, y, threshold = 12) {
    return this.npcs.find(n => {
      const dx = n.x - x;
      const dy = n.y - y;
      return dx * dx + dy * dy <= threshold * threshold;
    });
  }

  render(ctx) {
    for (const npc of this.npcs) {
      // Body
      ctx.beginPath();
      ctx.arc(npc.x, npc.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = npc.color || '#888';
      ctx.fill();

      // Outline
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Status indicators
      if (npc.status === 'blessed' || npc.blessings.some(b => b.active)) {
        ctx.beginPath();
        ctx.arc(npc.x, npc.y - 10, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fdcb6e';
        ctx.fill();
      }
      if (npc.temptations.some(t => t.active && t.accepted)) {
        ctx.beginPath();
        ctx.arc(npc.x + 7, npc.y - 5, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#e17055';
        ctx.fill();
      }
      if (npc.fear > 60) {
        ctx.fillStyle = 'rgba(225, 112, 85, 0.6)';
        ctx.beginPath();
        ctx.arc(npc.x, npc.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Religion symbol
      if (npc.religionId) {
        ctx.fillStyle = '#a29bfe';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✦', npc.x, npc.y + 3);
      }
    }
  }

  getStats() {
    const total = this.npcs.length;
    const happy = this.npcs.filter(n => n.happiness >= 60).length;
    const blessed = this.npcs.filter(n => n.blessings.some(b => b.active)).length;
    const tempted = this.npcs.filter(n => n.temptations.some(t => t.accepted)).length;
    return { total, happy, blessed, tempted };
  }

  toJSON() {
    return {
      npcs: this.npcs.map(n => n.toJSON()),
      nextId: this.nextId
    };
  }

  fromJSON(data) {
    this.npcs = (data.npcs || []).map(d => NPC.fromJSON(d));
    this.nextId = data.nextId || (this.npcs.length + 1);
  }
}
