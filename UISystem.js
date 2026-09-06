/**
 * UI System - Handles all interface interactions
 */
export class UISystem {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.selectedNPC = null;
    this.activePower = null;
    this.selectingTarget = false;
    this.selectionMode = null; // 'point', 'area', 'npc', 'tribe'
    this.pendingAction = null;

    this._bindElements();
    this._bindEvents();
    this._createLegend();
  }

  _bindElements() {
    this.els = {
      population: document.getElementById('stat-population'),
      tribes: document.getElementById('stat-tribes'),
      religions: document.getElementById('stat-religions'),
      happy: document.getElementById('stat-happy'),
      blessed: document.getElementById('stat-blessed'),
      tempted: document.getElementById('stat-tempted'),
      timeLabel: document.getElementById('time-label'),
      speedIndicator: document.getElementById('speed-indicator'),
      infoPanel: document.getElementById('info-panel'),
      infoTitle: document.getElementById('info-title'),
      infoContent: document.getElementById('info-content'),
      historyList: document.getElementById('history-list'),
      modalOverlay: document.getElementById('modal-overlay'),
      modalTitle: document.getElementById('modal-title'),
      modalBody: document.getElementById('modal-body'),
      modalConfirm: document.getElementById('modal-confirm'),
      modalCancel: document.getElementById('modal-cancel'),
      closeModal: document.getElementById('close-modal'),
      closeInfo: document.getElementById('close-info'),
      toastContainer: document.getElementById('toast-container'),
      selectionOverlay: document.getElementById('selection-overlay')
    };
  }

  _bindEvents() {
    // Power buttons
    document.querySelectorAll('.power-btn[data-power]').forEach(btn => {
      btn.addEventListener('click', () => this._onPowerClick(btn.dataset.power));
    });

    // Time buttons
    document.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseInt(btn.dataset.speed, 10);
        this.world.time.setSpeed(speed);
        document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.toast(speed === 0 ? 'زمان متوقف شد' : `سرعت زمان: ×${speed}`, 'success');
      });
    });

    // Canvas click
    this.canvas.addEventListener('click', (e) => this._onCanvasClick(e));

    // Modal
    this.els.closeModal.addEventListener('click', () => this.hideModal());
    this.els.modalCancel.addEventListener('click', () => this.hideModal());
    this.els.closeInfo.addEventListener('click', () => {
      this.els.infoPanel.classList.add('hidden');
      this.selectedNPC = null;
    });
  }

  _createLegend() {
    const legend = document.createElement('div');
    legend.className = 'tribe-legend';
    legend.innerHTML = this.world.tribes.map(t => `
      <div class="tribe-legend-item">
        <span class="tribe-dot" style="background:${t.color}"></span>
        <span>${t.name}</span>
      </div>
    `).join('');
    document.getElementById('map-container').appendChild(legend);
  }

  _onPowerClick(power) {
    // Clear previous
    document.querySelectorAll('.power-btn[data-power]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.power-btn[data-power="${power}"]`);
    if (btn) btn.classList.add('active');

    this.activePower = power;

    switch (power) {
      case 'rain':
      case 'lightning':
      case 'snow':
        this.selectingTarget = true;
        this.selectionMode = 'point';
        this.toast('روی نقشه کلیک کنید تا قدرت اعمال شود', 'warning');
        break;

      case 'religion':
        this._showReligionModal();
        break;

      case 'blessing':
        this._showBlessingModal();
        break;

      case 'temptation':
        this._showTemptationModal();
        break;

      case 'save':
        if (this.world.save()) {
          this.toast('جهان با موفقیت ذخیره شد', 'success');
        } else {
          this.toast('خطا در ذخیره‌سازی', 'danger');
        }
        this.activePower = null;
        if (btn) btn.classList.remove('active');
        break;

      case 'load':
        if (this.world.load()) {
          this.toast('جهان بارگذاری شد', 'success');
          this._refreshHistory();
          this.updateStats();
        } else {
          this.toast('ذخیره‌ای یافت نشد', 'warning');
        }
        this.activePower = null;
        if (btn) btn.classList.remove('active');
        break;
    }
  }

  _onCanvasClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (this.selectingTarget && this.activePower) {
      this._applyPowerAt(x, y);
      return;
    }

    // Select NPC
    const npc = this.world.npcs.getAt(x, y, 14);
    if (npc) {
      this.selectedNPC = npc;
      this._showNPCInfo(npc);
    }
  }

  _applyPowerAt(x, y) {
    switch (this.activePower) {
      case 'rain':
        this.world.castRain(x, y);
        this.toast('باران نازل شد 🌧', 'success');
        break;
      case 'lightning':
        this.world.castLightning(x, y);
        this.toast('رعد و برق فرود آمد ⚡', 'warning');
        break;
      case 'snow':
        this.world.castSnow(x, y);
        this.toast('برف بارید ❄', 'success');
        break;
    }

    this.selectingTarget = false;
    this.activePower = null;
    document.querySelectorAll('.power-btn[data-power]').forEach(b => b.classList.remove('active'));
    this._refreshHistory();
  }

  _showNPCInfo(npc) {
    const tribe = this.world.tribes.find(t => t.id === npc.tribeId);
    const religion = npc.religionId ? this.world.religions.getById(npc.religionId) : null;

    this.els.infoTitle.textContent = npc.name;
    this.els.infoContent.innerHTML = `
      <div class="info-section">
        <h4>اطلاعات پایه</h4>
        <div class="info-row"><span>قوم</span><span class="value">${tribe ? tribe.name : '—'}</span></div>
        <div class="info-row"><span>سن</span><span class="value">${npc.age}</span></div>
        <div class="info-row"><span>شخصیت</span><span class="value">${this._personalityFa(npc.personality)}</span></div>
        <div class="info-row"><span>وضعیت</span><span class="value">${this._statusFa(npc.status)}</span></div>
        <div class="info-row"><span>دین</span><span class="value">${religion ? religion.name : 'بدون دین'}</span></div>
      </div>
      <div class="info-section">
        <h4>ایمان ${Math.round(npc.faith)}</h4>
        <div class="progress-bar"><div class="progress-fill faith" style="width:${npc.faith}%"></div></div>
      </div>
      <div class="info-section">
        <h4>خوشحالی ${Math.round(npc.happiness)}</h4>
        <div class="progress-bar"><div class="progress-fill happiness" style="width:${npc.happiness}%"></div></div>
      </div>
      <div class="info-section">
        <h4>ترس ${Math.round(npc.fear)}</h4>
        <div class="progress-bar"><div class="progress-fill fear" style="width:${npc.fear}%"></div></div>
      </div>
      <div class="info-section">
        <h4>ثروت ${Math.round(npc.wealth)}</h4>
        <div class="progress-bar"><div class="progress-fill wealth" style="width:${npc.wealth}%"></div></div>
      </div>
      <div class="info-section">
        <h4>وفاداری ${Math.round(npc.loyalty)}</h4>
        <div class="progress-bar"><div class="progress-fill faith" style="width:${npc.loyalty}%"></div></div>
      </div>
      ${npc.blessings.length ? `<div class="info-section"><h4>برکت‌های فعال: ${npc.blessings.filter(b=>b.active).length}</h4></div>` : ''}
      ${npc.temptations.some(t=>t.accepted) ? `<div class="info-section"><h4 style="color:var(--danger)">تحت تأثیر وسوسه</h4></div>` : ''}
    `;
    this.els.infoPanel.classList.remove('hidden');
  }

  _personalityFa(p) {
    const map = {
      brave: 'شجاع', cautious: 'محتاط', curious: 'کنجکاو',
      loyal: 'وفادار', ambitious: 'جاه‌طلب', peaceful: 'صلح‌جو'
    };
    return map[p] || p;
  }

  _statusFa(s) {
    const map = {
      idle: 'آرام', moving: 'در حال حرکت', scared: 'ترسیده',
      blessed: 'مبارک', tempted: 'وسوسه‌شده', interacting: 'در تعامل'
    };
    return map[s] || s;
  }

  _showReligionModal() {
    this.els.modalTitle.textContent = 'ایجاد دین جدید';
    this.els.modalBody.innerHTML = `
      <div class="form-group">
        <label>نام دین</label>
        <input type="text" id="rel-name" placeholder="مثلاً: آیین نور">
      </div>
      <div class="form-group">
        <label>آموزه اصلی</label>
        <input type="text" id="rel-doctrine" placeholder="مثلاً: صلح و همدلی">
      </div>
      <div class="form-group">
        <label>رنگ</label>
        <div class="color-options" id="rel-colors">
          ${['#a29bfe','#fd79a8','#00b894','#fdcb6e','#74b9ff','#e17055'].map((c,i) =>
            `<div class="color-option ${i===0?'selected':''}" data-color="${c}" style="background:${c}"></div>`
          ).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>انتخاب بنیان‌گذار (روی نقشه فرد را انتخاب کنید یا از لیست)</label>
        <select id="rel-founder">
          <option value="">— بدون بنیان‌گذار —</option>
          ${this.world.npcs.npcs.slice(0, 40).map(n =>
            `<option value="${n.id}">${n.name} (${this.world.tribes.find(t=>t.id===n.tribeId)?.name || ''})</option>`
          ).join('')}
        </select>
      </div>
    `;

    // Color select
    setTimeout(() => {
      document.querySelectorAll('#rel-colors .color-option').forEach(el => {
        el.addEventListener('click', () => {
          document.querySelectorAll('#rel-colors .color-option').forEach(c => c.classList.remove('selected'));
          el.classList.add('selected');
        });
      });
    }, 50);

    this.els.modalConfirm.onclick = () => {
      const name = document.getElementById('rel-name').value.trim();
      const doctrine = document.getElementById('rel-doctrine').value.trim();
      const colorEl = document.querySelector('#rel-colors .color-option.selected');
      const color = colorEl ? colorEl.dataset.color : '#a29bfe';
      const founderId = parseInt(document.getElementById('rel-founder').value, 10) || null;

      if (!name || !doctrine) {
        this.toast('نام و آموزه الزامی است', 'warning');
        return;
      }

      this.world.createReligion({ name, doctrine, color, founderId });
      this.toast(`دین «${name}» ایجاد شد 🕊`, 'success');
      this.hideModal();
      this._refreshHistory();
      this.updateStats();
      this.activePower = null;
      document.querySelectorAll('.power-btn[data-power]').forEach(b => b.classList.remove('active'));
    };

    this.showModal();
  }

  _showBlessingModal() {
    this.els.modalTitle.textContent = 'اعطای برکت';
    this.els.modalBody.innerHTML = `
      <div class="form-group">
        <label>هدف</label>
        <div class="target-options" id="bless-target-type">
          <button class="target-btn selected" data-type="npc">فرد</button>
          <button class="target-btn" data-type="tribe">قوم</button>
        </div>
      </div>
      <div class="form-group" id="bless-npc-group">
        <label>انتخاب فرد</label>
        <select id="bless-npc">
          ${this.world.npcs.npcs.map(n =>
            `<option value="${n.id}">${n.name}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group hidden" id="bless-tribe-group">
        <label>انتخاب قوم</label>
        <select id="bless-tribe">
          ${this.world.tribes.map(t =>
            `<option value="${t.id}">${t.name}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>نوع برکت</label>
        <select id="bless-type">
          <option value="all">همه چیز</option>
          <option value="happiness">خوشحالی</option>
          <option value="faith">ایمان</option>
          <option value="wealth">ثروت</option>
          <option value="loyalty">وفاداری</option>
        </select>
      </div>
    `;

    setTimeout(() => {
      document.querySelectorAll('#bless-target-type .target-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#bless-target-type .target-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          const type = btn.dataset.type;
          document.getElementById('bless-npc-group').classList.toggle('hidden', type !== 'npc');
          document.getElementById('bless-tribe-group').classList.toggle('hidden', type !== 'tribe');
        });
      });
    }, 50);

    this.els.modalConfirm.onclick = () => {
      const targetType = document.querySelector('#bless-target-type .target-btn.selected')?.dataset.type || 'npc';
      const blessType = document.getElementById('bless-type').value;

      if (targetType === 'npc') {
        const id = parseInt(document.getElementById('bless-npc').value, 10);
        const npc = this.world.npcs.getById(id);
        if (npc) {
          this.world.blessTarget(npc, blessType);
          this.toast(`برکت بر ${npc.name} نازل شد ✨`, 'success');
        }
      } else {
        const tid = parseInt(document.getElementById('bless-tribe').value, 10);
        const members = this.world.npcs.getByTribe(tid);
        this.world.blessTarget(members, blessType);
        const tribe = this.world.tribes.find(t => t.id === tid);
        this.toast(`برکت بر قوم ${tribe?.name} نازل شد ✨`, 'success');
      }

      this.hideModal();
      this._refreshHistory();
      this.updateStats();
      this.activePower = null;
      document.querySelectorAll('.power-btn[data-power]').forEach(b => b.classList.remove('active'));
    };

    this.showModal();
  }

  _showTemptationModal() {
    this.els.modalTitle.textContent = 'ایجاد نیروی وسوسه‌گر';
    this.els.modalBody.innerHTML = `
      <div class="form-group">
        <label>هدف</label>
        <div class="target-options" id="tempt-target-type">
          <button class="target-btn selected" data-type="npc">فرد</button>
          <button class="target-btn" data-type="multi">چند فرد</button>
          <button class="target-btn" data-type="tribe">قوم</button>
        </div>
      </div>
      <div class="form-group" id="tempt-npc-group">
        <label>انتخاب فرد</label>
        <select id="tempt-npc">
          ${this.world.npcs.npcs.map(n =>
            `<option value="${n.id}">${n.name} (ایمان: ${Math.round(n.faith)})</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group hidden" id="tempt-multi-group">
        <label>انتخاب افراد (Ctrl برای چندتایی)</label>
        <select id="tempt-multi" multiple size="6" style="height:120px">
          ${this.world.npcs.npcs.map(n =>
            `<option value="${n.id}">${n.name} (ایمان: ${Math.round(n.faith)})</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group hidden" id="tempt-tribe-group">
        <label>انتخاب قوم</label>
        <select id="tempt-tribe">
          ${this.world.tribes.map(t =>
            `<option value="${t.id}">${t.name}</option>`
          ).join('')}
        </select>
      </div>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px">
        نتیجه قطعی نیست. ایمان، خوشحالی و وفاداری فرد بر احتمال پذیرش تأثیر می‌گذارد.
      </p>
    `;

    setTimeout(() => {
      document.querySelectorAll('#tempt-target-type .target-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#tempt-target-type .target-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          const type = btn.dataset.type;
          document.getElementById('tempt-npc-group').classList.toggle('hidden', type !== 'npc');
          document.getElementById('tempt-multi-group').classList.toggle('hidden', type !== 'multi');
          document.getElementById('tempt-tribe-group').classList.toggle('hidden', type !== 'tribe');
        });
      });
    }, 50);

    this.els.modalConfirm.onclick = () => {
      const targetType = document.querySelector('#tempt-target-type .target-btn.selected')?.dataset.type || 'npc';
      let targets = [];

      if (targetType === 'npc') {
        const id = parseInt(document.getElementById('tempt-npc').value, 10);
        const npc = this.world.npcs.getById(id);
        if (npc) targets = [npc];
      } else if (targetType === 'multi') {
        const select = document.getElementById('tempt-multi');
        const ids = Array.from(select.selectedOptions).map(o => parseInt(o.value, 10));
        targets = ids.map(id => this.world.npcs.getById(id)).filter(Boolean);
      } else {
        const tid = parseInt(document.getElementById('tempt-tribe').value, 10);
        targets = this.world.npcs.getByTribe(tid);
      }

      if (targets.length === 0) {
        this.toast('هدفی انتخاب نشده', 'warning');
        return;
      }

      const result = this.world.temptTarget(targets);
      this.toast(
        `وسوسه اعمال شد: ${result.accepted} پذیرفتند، ${result.resisted} مقاومت کردند ☠`,
        result.accepted > 0 ? 'warning' : 'success'
      );

      this.hideModal();
      this._refreshHistory();
      this.updateStats();
      this.activePower = null;
      document.querySelectorAll('.power-btn[data-power]').forEach(b => b.classList.remove('active'));
    };

    this.showModal();
  }

  showModal() {
    this.els.modalOverlay.classList.remove('hidden');
  }

  hideModal() {
    this.els.modalOverlay.classList.add('hidden');
  }

  toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    this.els.toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  updateStats() {
    const s = this.world.getStats();
    this.els.population.textContent = s.population;
    this.els.tribes.textContent = s.tribes;
    this.els.religions.textContent = s.religions;
    this.els.happy.textContent = s.happy;
    this.els.blessed.textContent = s.blessed;
    this.els.tempted.textContent = s.tempted;
    this.els.timeLabel.textContent = this.world.time.getTimeString();
    this.els.speedIndicator.textContent = this.world.time.getSpeedLabel();
  }

  _refreshHistory() {
    const events = this.world.history.getRecent(30);
    this.els.historyList.innerHTML = events.map(e => `
      <div class="history-item">
        <div class="time">${e.time}</div>
        <div>${e.text}</div>
      </div>
    `).join('');
  }

  render() {
    // Clear
    this.ctx.fillStyle = '#0d1220';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Map
    this.world.map.render(this.ctx);

    // NPCs
    this.world.npcs.render(this.ctx);

    // Highlight selected
    if (this.selectedNPC) {
      this.ctx.beginPath();
      this.ctx.arc(this.selectedNPC.x, this.selectedNPC.y, 12, 0, Math.PI * 2);
      this.ctx.strokeStyle = '#6c5ce7';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }
  }
}
