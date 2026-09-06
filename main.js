/**
 * GodWorld V1.0 - Main Entry Point
 */
import { WorldSystem } from './WorldSystem.js';
import { UISystem } from './UISystem.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('world-canvas');
    // Use a solid logical map size for consistency
    const mapW = 1100;
    const mapH = 620;
    this.canvas.width = mapW;
    this.canvas.height = mapH;

    window.addEventListener('resize', () => this.fitCanvas());

    this.world = new WorldSystem(mapW, mapH);
    this.world.init();

    this.ui = new UISystem(this.world, this.canvas);
    this.fitCanvas();

    this.lastTime = performance.now();
    this.running = true;

    // Initial UI update
    this.ui.updateStats();
    this.ui._refreshHistory();

    // Start loop
    requestAnimationFrame((t) => this.loop(t));
  }

  fitCanvas() {
    // CSS handles display size; canvas internal resolution is fixed for stable sim
    const container = document.getElementById('map-container');
    // Keep internal resolution fixed
  }

  loop(timestamp) {
    if (!this.running) return;

    const realDt = Math.min((timestamp - this.lastTime) / 16.67, 3); // normalize ~60fps, cap
    this.lastTime = timestamp;

    // Update world
    this.world.update(realDt);

    // Render
    this.ui.render();

    // UI stats (throttle a bit)
    if (Math.floor(timestamp / 500) !== Math.floor((timestamp - realDt * 16.67) / 500)) {
      this.ui.updateStats();
    }

    requestAnimationFrame((t) => this.loop(t));
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
  console.log('GodWorld V1.0 started');
});
