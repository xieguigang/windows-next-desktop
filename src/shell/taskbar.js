import { getIcon } from '../ui/icons.js';

/**
 * 任务栏：pin 区 + 活动区 + 居中按钮 + 托盘 + 时钟
 */
export class Taskbar {
  constructor(wm, settings, apps, bus) {
    this.wm = wm;
    this.settings = settings;
    this.apps = apps;
    this.bus = bus;

    this.el = document.getElementById('taskbar');
    this.pinsEl = document.getElementById('taskbar-pins');
    this.activeEl = document.getElementById('taskbar-active');
    this.clockTime = document.getElementById('clock-time');
    this.clockDate = document.getElementById('clock-date');

    this.overviewEl = document.getElementById('window-overview');
    this.overviewGrid = document.getElementById('overview-grid');
    this.startMenu = document.getElementById('start-menu');
    this.searchOverlay = document.getElementById('search-overlay');
    this.powerMenu = document.getElementById('power-menu');

    this.state = null;

    this._renderPins();
    this._bindActions();
    this._bindBus();
    this._tickClock();
    setInterval(() => this._tickClock(), 1000);
  }

  _renderPins() {
    const pins = this.settings.get('pins') || [];
    this.pinsEl.innerHTML = '';
    for (const id of pins) {
      const app = this.apps[id];
      if (!app) continue;
      const btn = this._makeItem(id, app.icon, app.name);
      btn.dataset.pin = id;
      btn.addEventListener('click', () => this._activate(id));
      this.pinsEl.appendChild(btn);
    }
    if (this.state) this._onState(this.state);
  }

  _makeItem(id, icon, title) {
    const el = document.createElement('div');
    el.className = 'taskbar-item';
    el.dataset.app = id;
    el.title = title;
    el.innerHTML = getIcon(icon, 24);
    return el;
  }

  _onState(s) {
    this.state = s;
    this.activeEl.innerHTML = '';
    const seen = new Set();
    for (const w of s.windows) {
      if (w.minimized || seen.has(w.appId)) continue;
      seen.add(w.appId);
      const app = this.apps[w.appId];
      const btn = this._makeItem(w.appId, w.icon, w.title);
      btn.dataset.win = w.id;
      if (w.id === s.activeId) btn.classList.add('active');
      btn.addEventListener('click', () => this._activate(w.appId, w.id));
      this.activeEl.appendChild(btn);
    }
    const focusedApp = s.windows.find(w => w.id === s.activeId)?.appId;
    this.pinsEl.querySelectorAll('.taskbar-item').forEach(el => {
      const id = el.dataset.pin;
      el.classList.toggle('active', id === focusedApp);
    });
  }

  _activate(appId, winId) {
    if (winId && this.wm.windows.has(winId)) {
      const w = this.wm.windows.get(winId);
      if (w.minimized) { this.wm.focus(winId); return; }
      this.wm.focus(winId); return;
    }
    const existing = this.state?.windows.find(w => w.appId === appId && !w.minimized);
    if (existing) { this.wm.focus(existing.id); return; }
    const app = this.apps[appId];
    if (app) this.wm.open({ appId, ...app.open() });
  }

  _bindActions() {
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'start') this._toggle(this.startMenu);
      else if (action === 'search') this._toggle(this.searchOverlay);
      else if (action === 'overview') this._openOverview();
      else if (action === 'show-desktop') {
        for (const w of this.wm.windows.values()) if (!w.minimized) w.minimize();
      }
    });
  }

  _toggle(el) {
    const was = !el.classList.contains('hidden');
    this.startMenu.classList.add('hidden');
    this.searchOverlay.classList.add('hidden');
    this.powerMenu.classList.add('hidden');
    if (!was) el.classList.remove('hidden');
  }

  _openOverview() {
    this.startMenu.classList.add('hidden');
    this.searchOverlay.classList.add('hidden');
    this.overviewGrid.innerHTML = '';
    const wins = this.state?.windows?.filter(w => !w.minimized) || [];
    for (const w of wins) {
      const card = document.createElement('div');
      card.className = 'overview-card';
      if (w.id === this.state?.activeId) card.classList.add('active');
      const node = document.getElementById(w.id);
      const thumb = document.createElement('div');
      thumb.className = 'overview-thumb';
      thumb.textContent = w.title;
      card.innerHTML = `<div class="overview-title">${getIcon(w.icon, 18)} ${w.title}</div>`;
      card.appendChild(thumb);
      card.addEventListener('click', () => {
        this.wm.focus(w.id);
        this.overviewEl.classList.add('hidden');
      });
      this.overviewGrid.appendChild(card);
    }
    this.overviewEl.classList.remove('hidden');
  }

  _bindBus() {
    this.bus.on('win:state', s => this._onState(s));
    this.bus.on('win:maximize-changed', ({ any }) => this.el.classList.toggle('solid', !!any));
    this.bus.on('settings:changed', s => { if (s.pins) this._renderPins(); });
  }

  _tickClock() {
    const now = new Date();
    this.clockTime.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    this.clockDate.textContent = now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    const lockTime = document.getElementById('lock-time');
    const lockDate = document.getElementById('lock-date');
    if (lockTime) lockTime.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (lockDate) lockDate.textContent = now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric' });
  }
}
