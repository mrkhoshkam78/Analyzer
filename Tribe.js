/**
 * Tribe Entity - A group/nation of NPCs
 */
export class Tribe {
  constructor({
    id,
    name,
    color,
    startX,
    startY,
    region,
    population = 12,
    faith = 40,
    happiness = 50,
    wealth = 40,
    relations = {}
  }) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.startX = startX;
    this.startY = startY;
    this.region = region;
    this.population = population;
    this.faith = faith;
    this.happiness = happiness;
    this.wealth = wealth;
    this.relations = relations; // { tribeId: value -100 to 100 }
    this.memberIds = [];
    this.blessings = [];
  }

  addMember(npcId) {
    if (!this.memberIds.includes(npcId)) {
      this.memberIds.push(npcId);
      this.population = this.memberIds.length;
    }
  }

  removeMember(npcId) {
    this.memberIds = this.memberIds.filter(id => id !== npcId);
    this.population = this.memberIds.length;
  }

  updateStats(npcs) {
    const members = npcs.filter(n => n.tribeId === this.id);
    if (members.length === 0) return;

    this.population = members.length;
    this.faith = members.reduce((s, n) => s + n.faith, 0) / members.length;
    this.happiness = members.reduce((s, n) => s + n.happiness, 0) / members.length;
    this.wealth = members.reduce((s, n) => s + n.wealth, 0) / members.length;
  }

  applyBlessing(blessing) {
    this.blessings.push(blessing);
  }

  getRelation(otherTribeId) {
    return this.relations[otherTribeId] ?? 0;
  }

  setRelation(otherTribeId, value) {
    this.relations[otherTribeId] = Math.max(-100, Math.min(100, value));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      startX: this.startX,
      startY: this.startY,
      region: this.region,
      population: this.population,
      faith: this.faith,
      happiness: this.happiness,
      wealth: this.wealth,
      relations: this.relations,
      memberIds: this.memberIds,
      blessings: this.blessings
    };
  }

  static fromJSON(data) {
    const t = new Tribe(data);
    t.memberIds = data.memberIds || [];
    t.blessings = data.blessings || [];
    t.relations = data.relations || {};
    return t;
  }
}
