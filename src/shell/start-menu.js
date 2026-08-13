import { getIcon } from '../ui/icons.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export class StartMenu {
  constructor(wm, settings, apps, bus) {
    this.wm = wm;
    this.settings = settings;
    this.apps = apps;
    this.bus = bus;

    this.el = document.getElementById('start-menu');
    this.pinnedRow = document.getElementById('start-pinned-row');
    this.mostUsedEl = document.getElementById('start-most-used');
    this.recentlyEl = document.getElementById('start-recently');
    this.productivityEl = document.getElementById('start-productivity');
    this.weatherDays = document.getElementById('weather-days');
    this.appsList = document.getElementById('start-apps-list');
    this.usernameEl = document.getElementById('start-username');
    this.emailEl = document.getElementById('start-email');

    this.powerMenu = document.getElementById('power-menu');

    this._renderWeather();
    this._renderPinned();
    this._renderApps();
    this._updateUser();
    this._bindActions();

    bus.on('settings:changed', s => {
      if (s.pins) this._renderPinned();
      if (s.username || s.email) this._updateUser();
    });

    document.addEventListener('click', (e) => {
      if (this.el.contains(e.target) || e.target.closest('[data-action="start"]')) return;
      this.close();
    });
  }

  open() { this.el.classList.remove('hidden'); }
  close() { this.el.classList.add('hidden'); }
  toggle() { this.el.classList.toggle('hidden'); }

  _renderWeather() {
    const icons = ['☀', '⛅', '☁', '☁', '🌧'];
    const temps = ['24°', '26°', '27°', '25°', '23°'];
    this.weatherDays.innerHTML = DAYS.map((d, i) =>
      `<div><div>${d}</div><div style="margin:4px 0">${icons[i]}</div><div>${temps[i]}</div></div>`
    ).join('');
  }

  _renderPinned() {
    const pins = this.settings.get('pins') || [];
    this.pinnedRow.innerHTML = '';
    for (const id of pins) {
      const app = this.apps[id]; if (!app) continue;
      const el = document.createElement('div');
      el.className = 'app-tile';
      el.title = app.name;
      el.innerHTML = `<div class="tile-icon">${getIcon(app.icon, 32)}</div>`;
      el.addEventListener('click', () => { this.wm.open({ appId: id, ...app.open() }); this.close(); });
      this.pinnedRow.appendChild(el);
    }
  }

  _renderApps() {
    const list = Object.entries(this.apps).map(([id, a]) => ({ id, ...a }));
    this.mostUsedEl.innerHTML = '';
    this.recentlyEl.innerHTML = '';
    this.productivityEl.innerHTML = '';

    const makeTile = (app) => {
      const el = document.createElement('div');
      el.className = 'app-tile';
      el.innerHTML = `<div class="tile-icon">${getIcon(app.icon, 32)}</div><div class="tile-label">${app.name}</div>`;
      el.addEventListener('click', () => { this.wm.open({ appId: app.id, ...app.open() }); this.close(); });
      return el;
    };

    const most = list.filter(a => ['explorer', 'settings', 'music', 'video'].includes(a.id));
    most.forEach(a => this.mostUsedEl.appendChild(makeTile(a)));

    const recent = list.filter(a => ['image-viewer', 'notepad'].includes(a.id));
    recent.forEach(a => this.recentlyEl.appendChild(makeTile(a)));

    const prod = list.filter(a => ['notepad', 'settings', 'explorer', 'music'].includes(a.id));
    prod.forEach(a => this.productivityEl.appendChild(makeTile(a)));

    // All apps alphabetical
    this.appsList.innerHTML = '';
    const byLetter = {};
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const app of list) {
      const L = app.name[0].toUpperCase();
      if (!byLetter[L]) byLetter[L] = [];
      byLetter[L].push(app);
    }
    for (const L of Object.keys(byLetter).sort()) {
      const letter = document.createElement('div');
      letter.className = 'app-letter'; letter.textContent = L;
      this.appsList.appendChild(letter);
      for (const app of byLetter[L]) {
        const row = document.createElement('div');
        row.className = 'app-row';
        row.innerHTML = `${getIcon(app.icon, 18)} <span>${app.name}</span>`;
        row.addEventListener('click', () => { this.wm.open({ appId: app.id, ...app.open() }); this.close(); });
        this.appsList.appendChild(row);
      }
    }
  }

  _updateUser() {
    this.usernameEl.textContent = this.settings.get('username');
    this.emailEl.textContent = this.settings.get('email');
  }

  _bindActions() {
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('.icon-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'settings') {
        this.wm.open({ appId: 'settings', ...this.apps.settings.open() });
        this.close();
      } else if (action === 'power') {
        this.powerMenu.classList.toggle('hidden');
      }
    });
  }
}
