/**
 * Map System - Generates and renders the 2D world map
 */
export class MapSystem {
  constructor(width = 1200, height = 700) {
    this.width = width;
    this.height = height;
    this.tiles = [];
    this.tileSize = 20;
    this.cols = Math.ceil(width / this.tileSize);
    this.rows = Math.ceil(height / this.tileSize);
    this.regions = {
      plains: { color: '#2d5a27', name: 'دشت' },
      forest: { color: '#1a3d1a', name: 'جنگل' },
      mountain: { color: '#5a5a5a', name: 'کوهستان' },
      water: { color: '#1a4a6e', name: 'رودخانه' },
      snow: { color: '#c8d6e5', name: 'برفی' },
      desert: { color: '#c4a35a', name: 'خشک' }
    };
    this.activeWeather = []; // { type, x, y, radius, duration, intensity }
  }

  generate() {
    this.tiles = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        const nx = c / this.cols;
        const ny = r / this.rows;
        let type = 'plains';

        // Simple procedural regions
        if (nx < 0.25 && ny < 0.45) type = 'forest';
        else if (nx > 0.7 && ny < 0.4) type = 'mountain';
        else if (nx > 0.55 && ny > 0.65) type = 'desert';
        else if (nx < 0.35 && ny > 0.6) type = 'snow';
        else if (Math.abs(nx - 0.5) < 0.08 || Math.abs(ny - 0.5) < 0.06) type = 'water';
        else if (nx > 0.4 && nx < 0.6 && ny > 0.3 && ny < 0.55) type = 'plains';

        // Noise variation
        const noise = Math.sin(c * 0.3) * Math.cos(r * 0.25) + Math.random() * 0.3;
        if (noise > 0.7 && type === 'plains') type = 'forest';
        if (noise < -0.5 && type === 'plains') type = 'desert';

        row.push({ type, fertility: type === 'plains' || type === 'forest' ? 0.7 : 0.3 });
      }
      this.tiles.push(row);
    }
  }

  getTileAt(x, y) {
    const c = Math.floor(x / this.tileSize);
    const r = Math.floor(y / this.tileSize);
    if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
      return this.tiles[r][c];
    }
    return null;
  }

  getRegionAt(x, y) {
    const tile = this.getTileAt(x, y);
    return tile ? this.regions[tile.type] : null;
  }

  addWeather(type, x, y, radius = 80, duration = 300, intensity = 1) {
    this.activeWeather.push({ type, x, y, radius, duration, intensity, age: 0 });
  }

  updateWeather(dt) {
    this.activeWeather = this.activeWeather.filter(w => {
      w.age += dt;
      return w.age < w.duration;
    });
  }

  render(ctx, camera = { x: 0, y: 0 }) {
    // Draw tiles
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tile = this.tiles[r][c];
        const region = this.regions[tile.type];
        ctx.fillStyle = region.color;
        ctx.fillRect(c * this.tileSize, r * this.tileSize, this.tileSize + 1, this.tileSize + 1);

        // Subtle variation
        if (tile.type === 'forest' && (c + r) % 3 === 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.15)';
          ctx.beginPath();
          ctx.arc(c * this.tileSize + 10, r * this.tileSize + 10, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (tile.type === 'mountain' && (c * r) % 5 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.1)';
          ctx.beginPath();
          ctx.moveTo(c * this.tileSize + 5, r * this.tileSize + 18);
          ctx.lineTo(c * this.tileSize + 10, r * this.tileSize + 4);
          ctx.lineTo(c * this.tileSize + 15, r * this.tileSize + 18);
          ctx.fill();
        }
      }
    }

    // Draw weather overlays
    for (const w of this.activeWeather) {
      const progress = w.age / w.duration;
      const alpha = Math.sin(progress * Math.PI) * 0.4 * w.intensity;

      if (w.type === 'rain') {
        ctx.fillStyle = `rgba(100, 150, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
        ctx.fill();

        // Rain drops
        ctx.strokeStyle = `rgba(180, 200, 255, ${alpha + 0.2})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 20; i++) {
          const rx = w.x + (Math.random() - 0.5) * w.radius * 1.8;
          const ry = w.y + (Math.random() - 0.5) * w.radius * 1.8;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 2, ry + 8);
          ctx.stroke();
        }
      } else if (w.type === 'snow') {
        ctx.fillStyle = `rgba(220, 230, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255,255,255,${alpha + 0.3})`;
        for (let i = 0; i < 15; i++) {
          const sx = w.x + (Math.random() - 0.5) * w.radius * 1.6;
          const sy = w.y + (Math.random() - 0.5) * w.radius * 1.6;
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (w.type === 'lightning') {
        // Flash
        if (w.age < 15) {
          ctx.fillStyle = `rgba(255, 255, 200, ${0.5 * (1 - w.age / 15)})`;
          ctx.beginPath();
          ctx.arc(w.x, w.y, w.radius * 1.5, 0, Math.PI * 2);
          ctx.fill();

          // Bolt
          ctx.strokeStyle = `rgba(255, 255, 150, ${1 - w.age / 15})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(w.x, w.y - 40);
          ctx.lineTo(w.x + 8, w.y - 10);
          ctx.lineTo(w.x - 5, w.y + 5);
          ctx.lineTo(w.x + 10, w.y + 30);
          ctx.stroke();
        }
      }
    }
  }

  toJSON() {
    return {
      width: this.width,
      height: this.height,
      tiles: this.tiles,
      activeWeather: this.activeWeather
    };
  }

  fromJSON(data) {
    this.width = data.width;
    this.height = data.height;
    this.tiles = data.tiles;
    this.activeWeather = data.activeWeather || [];
    this.cols = Math.ceil(this.width / this.tileSize);
    this.rows = Math.ceil(this.height / this.tileSize);
  }
}
