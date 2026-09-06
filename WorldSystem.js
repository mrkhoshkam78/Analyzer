/**
 * World System - Central world state & coordination
 */
import { Tribe } from './Tribe.js';
import { MapSystem } from './MapSystem.js';
import { NPCSystem } from './NPCSystem.js';
import { ReligionSystem } from './ReligionSystem.js';
import { WeatherSystem } from './WeatherSystem.js';
import { BlessingSystem } from './BlessingSystem.js';
import { TemptationSystem } from './TemptationSystem.js';
import { TimeSystem } from './TimeSystem.js';
import { HistorySystem } from './HistorySystem.js';
import { SaveSystem } from './SaveSystem.js';

const TRIBES_CONFIG = [
  {
    id: 1,
    name: 'قوم آریایی',
    color: '#e74c3c',
    startXRatio: 0.15,
    startYRatio: 0.25,
    region: 'forest',
    population: 14,
    faith: 55,
    happiness: 50,
    wealth: 45
  },
  {
    id: 2,
    name: 'قوم پارس',
    color: '#3498db',
    startXRatio: 0.78,
    startYRatio: 0.22,
    region: 'mountain',
    population: 12,
    faith: 45,
    happiness: 55,
    wealth: 55
  },
  {
    id: 3,
    name: 'قوم کویری',
    color: '#f39c12',
    startXRatio: 0.72,
    startYRatio: 0.75,
    region: 'desert',
    population: 11,
    faith: 35,
    happiness: 40,
    wealth: 30
  },
  {
    id: 4,
    name: 'قوم برفی',
    color: '#9b59b6',
    startXRatio: 0.18,
    startYRatio: 0.78,
    region: 'snow',
    population: 13,
    faith: 60,
    happiness: 45,
    wealth: 35
  }
];

export class WorldSystem {
  constructor(canvasWidth = 1200, canvasHeight = 700) {
    this.map = new MapSystem(canvasWidth, canvasHeight);
    this.npcs = new NPCSystem();
    this.religions = new ReligionSystem();
    this.weather = new WeatherSystem(this.map);
    this.blessings = new BlessingSystem();
    this.temptations = new TemptationSystem();
    this.time = new TimeSystem();
    this.history = new HistorySystem();
    this.saveSystem = new SaveSystem();
    this.tribes = [];
    this.initialized = false;
  }

  init() {
    this.map.generate();
    const w = this.map.width;
    const h = this.map.height;
    this.tribes = TRIBES_CONFIG.map(cfg => {
      const tribe = new Tribe({
        ...cfg,
        startX: cfg.startXRatio * w,
        startY: cfg.startYRatio * h
      });
      return tribe;
    });

    // Initialize relations
    for (const t of this.tribes) {
      for (const other of this.tribes) {
        if (t.id !== other.id) {
          t.setRelation(other.id, -10 + Math.floor(Math.random() * 30));
        }
      }
    }

    // Generate NPCs
    for (const tribe of this.tribes) {
      this.npcs.generateForTribe(tribe, tribe.population);
    }

    this.history.add('جهان آفریده شد. چهار قوم در سرزمین‌های خود ساکن شدند.', 'world', this.time.getTimeString());
    this.initialized = true;
  }

  update(realDt) {
    if (!this.initialized) return;

    const gameDt = this.time.update(realDt);
    if (gameDt === 0) return; // paused

    this.npcs.update(gameDt, this);
    this.weather.update(gameDt);
    this.religions.update(gameDt, this.npcs);

    // Update tribe stats periodically
    for (const tribe of this.tribes) {
      tribe.updateStats(this.npcs.npcs);
    }
  }

  // --- God Powers ---

  castRain(x, y) {
    const event = this.weather.createRain(x, y);
    const affected = this.weather.applyToNPCs(this.npcs, event);
    this.history.add(
      `باران الهی در منطقه فرود آمد. ${affected.length} نفر تحت تأثیر قرار گرفتند.`,
      'weather',
      this.time.getTimeString()
    );
    return affected;
  }

  castLightning(x, y) {
    const event = this.weather.createLightning(x, y);
    const affected = this.weather.applyToNPCs(this.npcs, { ...event, radius: 70 });
    this.history.add(
      `رعد و برق آسمانی فرود آمد! ${affected.length} نفر وحشت‌زده شدند.`,
      'weather',
      this.time.getTimeString()
    );
    return affected;
  }

  castSnow(x, y) {
    const event = this.weather.createSnow(x, y);
    const affected = this.weather.applyToNPCs(this.npcs, event);
    this.history.add(
      `برف الهی منطقه را پوشاند. ${affected.length} نفر تحت تأثیر قرار گرفتند.`,
      'weather',
      this.time.getTimeString()
    );
    return affected;
  }

  createReligion({ name, doctrine, color, founderId }) {
    const religion = this.religions.create({
      name,
      doctrine,
      color,
      founderId,
      worldTime: this.time.day
    });

    if (founderId) {
      const founder = this.npcs.getById(founderId);
      if (founder) {
        founder.setReligion(religion.id);
      }
    }

    this.history.add(
      `دین جدید «${name}» با آموزه «${doctrine}» ایجاد شد.`,
      'religion',
      this.time.getTimeString()
    );
    return religion;
  }

  blessTarget(targets, type = 'all') {
    const list = Array.isArray(targets) ? targets : [targets];
    this.blessings.bless(list, type, this.time.day);

    const names = list.map(t => t.name || t.id).join('، ');
    this.history.add(
      `برکت الهی بر ${names} نازل شد.`,
      'blessing',
      this.time.getTimeString()
    );
  }

  temptTarget(targets) {
    const results = this.temptations.tempt(targets, this.time.day);
    let accepted = 0;
    let resisted = 0;

    for (const r of results) {
      if (r.outcome === 'accepted') {
        accepted++;
        this.history.add(
          `${r.npc.name} وسوسه را پذیرفت و ایمانش سست شد.`,
          'temptation',
          this.time.getTimeString()
        );
      } else {
        resisted++;
        this.history.add(
          `${r.npc.name} در برابر وسوسه مقاومت کرد و ایمانش قوی‌تر شد.`,
          'temptation',
          this.time.getTimeString()
        );
      }
    }

    return { accepted, resisted, results };
  }

  getStats() {
    const npcStats = this.npcs.getStats();
    return {
      population: npcStats.total,
      tribes: this.tribes.length,
      religions: this.religions.religions.length,
      happy: npcStats.happy,
      blessed: npcStats.blessed,
      tempted: npcStats.tempted
    };
  }

  // --- Save / Load ---

  serialize() {
    return {
      version: '1.0',
      time: this.time.toJSON(),
      map: this.map.toJSON(),
      tribes: this.tribes.map(t => t.toJSON()),
      npcs: this.npcs.toJSON(),
      religions: this.religions.toJSON(),
      history: this.history.toJSON()
    };
  }

  deserialize(data) {
    if (!data || data.version !== '1.0') return false;

    this.time.fromJSON(data.time);
    this.map.fromJSON(data.map);
    this.tribes = (data.tribes || []).map(d => Tribe.fromJSON(d));
    this.npcs.fromJSON(data.npcs);
    this.religions.fromJSON(data.religions);
    this.history.fromJSON(data.history);
    this.initialized = true;
    return true;
  }

  save() {
    return this.saveSystem.save(this.serialize());
  }

  load() {
    const data = this.saveSystem.load();
    if (!data) return false;
    return this.deserialize(data);
  }
}
