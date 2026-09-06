/**
 * Weather System - Handles rain, lightning, snow effects on world & NPCs
 */
export class WeatherSystem {
  constructor(mapSystem) {
    this.map = mapSystem;
  }

  createRain(x, y, radius = 90, duration = 400) {
    this.map.addWeather('rain', x, y, radius, duration, 1);
    return { type: 'rain', x, y, radius };
  }

  createLightning(x, y) {
    this.map.addWeather('lightning', x, y, 50, 40, 1.5);
    return { type: 'lightning', x, y };
  }

  createSnow(x, y, radius = 100, duration = 500) {
    this.map.addWeather('snow', x, y, radius, duration, 1);
    return { type: 'snow', x, y, radius };
  }

  applyToNPCs(npcSystem, event) {
    const affected = npcSystem.getNear(event.x, event.y, event.radius || 60);
    for (const npc of affected) {
      npc.reactToWeather(event.type, 1);
    }

    // Increase fertility for rain
    if (event.type === 'rain') {
      const tile = this.map.getTileAt(event.x, event.y);
      if (tile) {
        tile.fertility = Math.min(1, (tile.fertility || 0.3) + 0.15);
      }
    }

    return affected;
  }

  update(dt) {
    this.map.updateWeather(dt);
  }
}
