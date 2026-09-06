/**
 * Religion Entity
 */
export class Religion {
  constructor({
    id,
    name,
    doctrine,
    color = '#a29bfe',
    symbol = '✦',
    founderId = null,
    followerIds = [],
    createdAt = 0
  }) {
    this.id = id;
    this.name = name;
    this.doctrine = doctrine;
    this.color = color;
    this.symbol = symbol;
    this.founderId = founderId;
    this.followerIds = followerIds;
    this.createdAt = createdAt;
    this.spreadRate = 0.002; // base chance per tick to convert nearby
  }

  addFollower(npcId) {
    if (!this.followerIds.includes(npcId)) {
      this.followerIds.push(npcId);
    }
  }

  removeFollower(npcId) {
    this.followerIds = this.followerIds.filter(id => id !== npcId);
  }

  get followerCount() {
    return this.followerIds.length;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      doctrine: this.doctrine,
      color: this.color,
      symbol: this.symbol,
      founderId: this.founderId,
      followerIds: this.followerIds,
      createdAt: this.createdAt,
      spreadRate: this.spreadRate
    };
  }

  static fromJSON(data) {
    const r = new Religion(data);
    r.followerIds = data.followerIds || [];
    r.spreadRate = data.spreadRate ?? 0.002;
    return r;
  }
}
