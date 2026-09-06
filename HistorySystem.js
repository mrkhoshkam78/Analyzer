/**
 * World History System
 */
export class HistorySystem {
  constructor() {
    this.events = [];
    this.maxEvents = 200;
  }

  add(text, type = 'general', timeStr = '') {
    this.events.unshift({
      id: Date.now() + Math.random(),
      text,
      type,
      time: timeStr,
      timestamp: Date.now()
    });
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }
  }

  getRecent(count = 50) {
    return this.events.slice(0, count);
  }

  toJSON() {
    return { events: this.events };
  }

  fromJSON(data) {
    this.events = data.events || [];
  }
}
