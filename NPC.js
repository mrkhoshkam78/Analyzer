/**
 * NPC Entity - Individual character in the world
 */
export class NPC {
  constructor({
    id,
    name,
    tribeId,
    x,
    y,
    age = 20 + Math.floor(Math.random() * 40),
    faith = 30 + Math.floor(Math.random() * 40),
    happiness = 40 + Math.floor(Math.random() * 30),
    fear = 10 + Math.floor(Math.random() * 20),
    wealth = 20 + Math.floor(Math.random() * 40),
    loyalty = 50 + Math.floor(Math.random() * 30),
    personality = null,
    religionId = null
  }) {
    this.id = id;
    this.name = name;
    this.tribeId = tribeId;
    this.x = x;
    this.y = y;
    this.age = age;
    this.faith = Math.max(0, Math.min(100, faith));
    this.happiness = Math.max(0, Math.min(100, happiness));
    this.fear = Math.max(0, Math.min(100, fear));
    this.wealth = Math.max(0, Math.min(100, wealth));
    this.loyalty = Math.max(0, Math.min(100, loyalty));
    this.personality = personality || this._randomPersonality();
    this.religionId = religionId;
    this.blessings = [];
    this.temptations = [];
    this.status = 'idle'; // idle, moving, interacting, scared, blessed
    this.targetX = null;
    this.targetY = null;
    this.speed = 0.3 + Math.random() * 0.4;
    this.vx = 0;
    this.vy = 0;
    this.lastDecision = 0;
    this.decisionCooldown = 60 + Math.floor(Math.random() * 120);
    this.homeX = x;
    this.homeY = y;
    this.color = null; // set by tribe
  }

  _randomPersonality() {
    const types = ['brave', 'cautious', 'curious', 'loyal', 'ambitious', 'peaceful'];
    return types[Math.floor(Math.random() * types.length)];
  }

  update(dt, world) {
    // Apply status effects
    this._applyEffects(dt);

    // Decision making
    this.lastDecision += dt;
    if (this.lastDecision >= this.decisionCooldown) {
      this.lastDecision = 0;
      this._makeDecision(world);
    }

    // Movement
    if (this.targetX !== null && this.targetY !== null) {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        this.targetX = null;
        this.targetY = null;
        this.status = 'idle';
        this.vx = 0;
        this.vy = 0;
      } else {
        this.vx = (dx / dist) * this.speed;
        this.vy = (dy / dist) * this.speed;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.status = 'moving';
      }
    }

    // Clamp to map bounds (will be set by world)
    if (world && world.map) {
      this.x = Math.max(5, Math.min(world.map.width - 5, this.x));
      this.y = Math.max(5, Math.min(world.map.height - 5, this.y));
    }
  }

  _makeDecision(world) {
    // Simple decision system based on state
    if (this.fear > 70) {
      // Flee toward home
      this.targetX = this.homeX + (Math.random() - 0.5) * 30;
      this.targetY = this.homeY + (Math.random() - 0.5) * 30;
      this.status = 'scared';
      return;
    }

    if (this.happiness > 70 && Math.random() < 0.3) {
      // Wander near home happily
      this.targetX = this.homeX + (Math.random() - 0.5) * 60;
      this.targetY = this.homeY + (Math.random() - 0.5) * 60;
      return;
    }

    if (Math.random() < 0.4) {
      // Random wander
      this.targetX = this.x + (Math.random() - 0.5) * 80;
      this.targetY = this.y + (Math.random() - 0.5) * 80;
    }
  }

  _applyEffects(dt) {
    // Blessings slowly increase happiness/faith
    for (const b of this.blessings) {
      if (b.active) {
        this.happiness = Math.min(100, this.happiness + 0.01 * dt);
        if (b.type === 'faith') this.faith = Math.min(100, this.faith + 0.015 * dt);
        if (b.type === 'wealth') this.wealth = Math.min(100, this.wealth + 0.01 * dt);
      }
    }

    // Fear decays over time
    if (this.fear > 0) {
      this.fear = Math.max(0, this.fear - 0.02 * dt);
    }

    // Temptation effects
    for (const t of this.temptations) {
      if (t.active && !t.resolved) {
        // Subtle negative influence
        if (Math.random() < 0.001 * dt) {
          this.faith = Math.max(0, this.faith - 1);
          this.loyalty = Math.max(0, this.loyalty - 0.5);
        }
      }
    }
  }

  applyBlessing(blessing) {
    this.blessings.push(blessing);
    this.status = 'blessed';
    if (blessing.type === 'happiness' || blessing.type === 'all') {
      this.happiness = Math.min(100, this.happiness + 15);
    }
    if (blessing.type === 'faith' || blessing.type === 'all') {
      this.faith = Math.min(100, this.faith + 10);
    }
    if (blessing.type === 'wealth' || blessing.type === 'all') {
      this.wealth = Math.min(100, this.wealth + 12);
    }
    if (blessing.type === 'loyalty' || blessing.type === 'all') {
      this.loyalty = Math.min(100, this.loyalty + 10);
    }
  }

  applyTemptation(temptation) {
    this.temptations.push(temptation);
    // Probability based on traits
    const resistChance = (this.faith * 0.5 + this.loyalty * 0.3 + this.happiness * 0.2) / 100;
    const fearBonus = this.fear * 0.002;
    const acceptChance = 1 - resistChance + fearBonus;

    if (Math.random() < acceptChance) {
      temptation.accepted = true;
      temptation.resolved = true;
      this.faith = Math.max(0, this.faith - 20);
      this.happiness = Math.max(0, this.happiness - 10);
      this.loyalty = Math.max(0, this.loyalty - 15);
      this.status = 'tempted';
      return 'accepted';
    } else {
      temptation.accepted = false;
      temptation.resolved = true;
      this.faith = Math.min(100, this.faith + 5); // resistance strengthens faith
      return 'resisted';
    }
  }

  setReligion(religionId) {
    this.religionId = religionId;
    this.faith = Math.min(100, this.faith + 15);
  }

  reactToWeather(type, intensity = 1) {
    if (type === 'rain') {
      this.happiness = Math.min(100, this.happiness + 5 * intensity);
      this.fear = Math.max(0, this.fear - 3);
    } else if (type === 'lightning') {
      this.fear = Math.min(100, this.fear + 25 * intensity);
      this.happiness = Math.max(0, this.happiness - 10);
      // Flee a bit
      this.targetX = this.x + (Math.random() - 0.5) * 40;
      this.targetY = this.y + (Math.random() - 0.5) * 40;
      this.status = 'scared';
    } else if (type === 'snow') {
      // Depends on location preference later
      this.happiness = Math.max(0, this.happiness - 3 * intensity);
      this.fear = Math.min(100, this.fear + 5);
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      tribeId: this.tribeId,
      x: this.x,
      y: this.y,
      age: this.age,
      faith: this.faith,
      happiness: this.happiness,
      fear: this.fear,
      wealth: this.wealth,
      loyalty: this.loyalty,
      personality: this.personality,
      religionId: this.religionId,
      blessings: this.blessings,
      temptations: this.temptations,
      status: this.status,
      homeX: this.homeX,
      homeY: this.homeY,
      color: this.color
    };
  }

  static fromJSON(data) {
    const npc = new NPC(data);
    npc.blessings = data.blessings || [];
    npc.temptations = data.temptations || [];
    npc.status = data.status || 'idle';
    npc.homeX = data.homeX ?? data.x;
    npc.homeY = data.homeY ?? data.y;
    npc.color = data.color;
    return npc;
  }
}
