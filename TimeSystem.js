/**
 * Time System - Controls game time flow and speed
 */
export class TimeSystem {
  constructor() {
    this.day = 1;
    this.hour = 0;
    this.minute = 0;
    this.speed = 1; // 0 = paused, 1 = normal, 2, 4, ...
    this.tickAccumulator = 0;
    this.minutesPerTick = 1; // at speed 1, each tick advances 1 minute
    this.listeners = [];
  }

  setSpeed(speed) {
    this.speed = Math.max(0, speed);
  }

  isPaused() {
    return this.speed === 0;
  }

  update(realDt) {
    if (this.speed === 0) return 0;

    // Convert real delta to game delta
    const gameDt = realDt * this.speed;
    this.tickAccumulator += gameDt;

    // Advance time (every ~1 second of game time at speed 1 = 1 minute)
    while (this.tickAccumulator >= 1) {
      this.tickAccumulator -= 1;
      this.minute += this.minutesPerTick;

      if (this.minute >= 60) {
        this.minute = 0;
        this.hour += 1;
        if (this.hour >= 24) {
          this.hour = 0;
          this.day += 1;
          this._emit('newDay', { day: this.day });
        }
        this._emit('newHour', { day: this.day, hour: this.hour });
      }
    }

    return gameDt;
  }

  getTimeString() {
    const h = String(this.hour).padStart(2, '0');
    const m = String(this.minute).padStart(2, '0');
    return `روز ${this.day} • ساعت ${h}:${m}`;
  }

  getSpeedLabel() {
    if (this.speed === 0) return '⏸';
    if (this.speed === 1) return '▶';
    return `×${this.speed}`;
  }

  on(event, cb) {
    this.listeners.push({ event, cb });
  }

  _emit(event, data) {
    for (const l of this.listeners) {
      if (l.event === event) l.cb(data);
    }
  }

  toJSON() {
    return {
      day: this.day,
      hour: this.hour,
      minute: this.minute,
      speed: this.speed
    };
  }

  fromJSON(data) {
    this.day = data.day ?? 1;
    this.hour = data.hour ?? 0;
    this.minute = data.minute ?? 0;
    this.speed = data.speed ?? 1;
  }
}
