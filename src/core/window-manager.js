import { EventBus } from './event-bus.js';
import { getIcon } from '../ui/icons.js';

const MIN_W = 240, MIN_H = 160;
let WIN_ID = 0;

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function lineIcon(name) {
  if (name === 'minimize') return `<svg viewBox="0 0 24 24" width="12" height="12"><rect x="4" y="11" width="16" height="2" rx="1" fill="currentColor"/></svg>`;
  if (name === 'maximize') return `<svg viewBox="0 0 24 24" width="12" height="12"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  if (name === 'restore') return `<svg viewBox="0 0 24 24" width="12" height="12"><rect x="7" y="3" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  if (name === 'close') return `<svg viewBox="0 0 24 24" width="12" height="12"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  return '';
}

class WinInstance {
  constructor(wm, opts) {
    this.wm = wm;
    this.id = `win-${++WIN_ID}`;
    this.appId = opts.appId;
    this.title = opts.title || 'Window';
    this.icon = opts.icon || 'window';
    this.tabs = [];
    this.activeTab = null;
    this.maximized = false;
    this.minimized = false;
    this.prevRect = null;

    const sw = window.innerWidth;
    const sh = window.innerHeight - 60;
    const w = clamp(opts.width || 800, MIN_W, sw);
    const h = clamp(opts.height || 520, MIN_H, sh);
    this.rect = {
      x: clamp((opts.x == null ? (sw - w) / 2 : opts.x), 0, sw - w),
      y: clamp((opts.y == null ? (sh - h) / 2 : opts.y), 0, sh - h),
      w, h,
    };

    this.el = document.createElement('div');
    this.el.className = 'window';
    this.el.id = this.id;
    this.el.innerHTML = `
      <div class="win-titlebar" data-drag="1">
        <div class="win-tabs"></div>
        <div class="win-controls">
          <button class="win-btn minimize" data-act="minimize">${lineIcon('minimize')}</button>
          <button class="win-btn maximize" data-act="maximize">${lineIcon('maximize')}</button>
          <button class="win-btn close" data-act="close">${lineIcon('close')}</button>
        </div>
      </div>
      <div class="win-body"></div>
      <div class="resize-handle resize-n" data-r="n"></div>
      <div class="resize-handle resize-s" data-r="s"></div>
      <div class="resize-handle resize-w" data-r="w"></div>
      <div class="resize-handle resize-e" data-r="e"></div>
      <div class="resize-handle resize-nw" data-r="nw"></div>
      <div class="resize-handle resize-ne" data-r="ne"></div>
      <div class="resize-handle resize-sw" data-r="sw"></div>
      <div class="resize-handle resize-se" data-r="se"></div>
    `;
    this.bodyEl = this.el.querySelector('.win-body');
    this.tabsEl = this.el.querySelector('.win-tabs');
    this.controlsEl = this.el.querySelector('.win-controls');

    this._applyRect();
    this._bindEvents();
  }

  setContent(node) {
    this.bodyEl.innerHTML = '';
    if (node) this.bodyEl.appendChild(node);
  }

  addTab(tab) {
    if (!tab.id) tab.id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.tabs.push(tab);
    if (!this.activeTab) this.activeTab = tab.id;
    this._renderTabs();
    if (this.activeTab === tab.id) {
      this.setContent(tab.content);
      this.title = tab.title;
    }
  }

  removeTab(tabId) {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    this.tabs.splice(idx, 1);
    if (this.activeTab === tabId) {
      this.activeTab = this.tabs[idx] ? this.tabs[idx].id : (this.tabs[this.tabs.length - 1]?.id || null);
    }
    if (!this.activeTab && this.tabs.length) this.activeTab = this.tabs[0].id;
    this._renderTabs();
    const active = this.tabs.find(t => t.id === this.activeTab);
    if (active) this.setContent(active.content);
    if (!this.tabs.length) this.wm.close(this.id);
  }

  _renderTabs() {
    this.tabsEl.innerHTML = '';
    for (const t of this.tabs) {
      const isActive = this.activeTab === t.id;
      const tabEl = document.createElement('div');
      tabEl.className = `win-tab ${isActive ? 'active' : ''}`;
      tabEl.dataset.tab = t.id;
      tabEl.innerHTML = `
        <span class="win-tab-icon">${getIcon(t.icon || this.icon, 14)}</span>
        <span class="win-tab-title">${t.title}</span>
        ${this.tabs.length > 1 ? `<span class="win-tab-close" data-close-tab="${t.id}">×</span>` : ''}
      `;
      tabEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.win-tab-close')) return;
        this.activateTab(t.id);
        this.wm.focus(this.id);
      });
      this.tabsEl.appendChild(tabEl);
    }
    const closeBtns = this.tabsEl.querySelectorAll('[data-close-tab]');
    closeBtns.forEach(btn => btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.removeTab(btn.dataset.closeTab);
    }));
  }

  activateTab(id) {
    this.activeTab = id;
    this._renderTabs();
    const active = this.tabs.find(t => t.id === id);
    if (active) {
      this.setContent(active.content);
      this.title = active.title;
    }
  }

  focus() {
    this.el.classList.add('active');
    this._applyRect();
  }
  blur() { this.el.classList.remove('active'); }

  _applyRect() {
    if (this.maximized) return;
    this.el.style.left = `${this.rect.x}px`;
    this.el.style.top = `${this.rect.y}px`;
    this.el.style.width = `${this.rect.w}px`;
    this.el.style.height = `${this.rect.h}px`;
    this.el.style.transform = '';
  }

  toggleMaximize() {
    if (this.maximized) {
      this.maximized = false;
      if (this.prevRect) this.rect = { ...this.prevRect };
      this.el.classList.remove('maximized');
      this.controlsEl.querySelector('[data-act="maximize"]').innerHTML = lineIcon('maximize');
      this._applyRect();
    } else {
      this.prevRect = { ...this.rect };
      this.maximized = true;
      this.el.classList.add('maximized');
      this.el.style.left = '0';
      this.el.style.top = '0';
      this.el.style.width = '100vw';
      this.el.style.height = `calc(100vh - var(--wn-taskbar-height))`;
      this.controlsEl.querySelector('[data-act="maximize"]').innerHTML = lineIcon('restore');
    }
    this.wm._notifyMaximized();
  }

  minimize() {
    this.minimized = true;
    this.el.classList.add('minimized');
    this.wm._emitState();
  }
  restore() {
    this.minimized = false;
    this.el.classList.remove('minimized');
    this.wm.focus(this.id);
    this.wm._emitState();
  }

  _bindEvents() {
    this.el.addEventListener('pointerdown', () => this.wm.focus(this.id));

    this.controlsEl.addEventListener('pointerdown', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      e.stopPropagation();
      if (act === 'minimize') this.minimize();
      else if (act === 'maximize') this.toggleMaximize();
      else if (act === 'close') this.wm.close(this.id);
    });

    const titlebar = this.el.querySelector('.win-titlebar');
    this._drag(titlebar);

    this.el.querySelectorAll('.resize-handle').forEach(h => {
      this._resize(h, h.dataset.r);
    });

    this.el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.win-titlebar')) this.toggleMaximize();
    });
  }

  _drag(el) {
    let startX, startY, sx, sy;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.win-tab-close') || e.target.closest('.win-controls')) return;
      this.wm.focus(this.id);
      if (this.maximized) {
        this.toggleMaximize();
        this.rect.x = e.clientX - this.rect.w / 2;
        this.rect.y = e.clientY - 16;
        this._applyRect();
      }
      startX = e.clientX; startY = e.clientY;
      sx = this.rect.x; sy = this.rect.y;
      el.setPointerCapture(e.pointerId);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);

      function move(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        this.rect.x = clamp(sx + dx, 0, window.innerWidth - this.rect.w);
        this.rect.y = clamp(sy + dy, 0, window.innerHeight - this.rect.h - 48);
        this._applyRect();
      }
      function up() {
        el.releasePointerCapture(e.pointerId);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      }
      move = move.bind(this);
      up = up.bind(this);
    });
  }

  _resize(handle, dir) {
    let startX, startY, sr;
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.maximized) return;
      this.wm.focus(this.id);
      startX = e.clientX; startY = e.clientY;
      sr = { ...this.rect };
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);

      function move(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (dir.includes('e')) this.rect.w = clamp(sr.w + dx, MIN_W, window.innerWidth - this.rect.x);
        if (dir.includes('s')) this.rect.h = clamp(sr.h + dy, MIN_H, window.innerHeight - this.rect.y - 72);
        if (dir.includes('w')) {
          const nx = clamp(sr.x + dx, 0, sr.x + sr.w - MIN_W);
          this.rect.w = sr.w + sr.x - nx;
          this.rect.x = nx;
        }
        if (dir.includes('n')) {
          const ny = clamp(sr.y + dy, 0, sr.y + sr.h - MIN_H);
          this.rect.h = sr.h + sr.y - ny;
          this.rect.y = ny;
        }
        this._applyRect();
      }
      function up() {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      }
      move = move.bind(this);
      up = up.bind(this);
    });
  }
}

export class WindowManager {
  constructor(bus) {
    this.bus = bus;
    this.layer = document.getElementById('window-layer');
    this.windows = new Map();
    this.order = [];
    this.activeId = null;
    this.baseZ = 200;
    this._maximizedSet = new Set();

    window.addEventListener('resize', () => this._onResize());
  }

  open(opts = {}) {
    const win = new WinInstance(this, opts);
    this.windows.set(win.id, win);
    this.order.push(win.id);
    this.layer.appendChild(win.el);
    this.focus(win.id);
    this._emitState();
    if (opts.tabs) {
      opts.tabs.forEach(t => win.addTab(t));
    } else if (opts.content) {
      win.addTab({ title: opts.title, icon: opts.icon, content: opts.content });
    }
    this.bus.emit('win:opened', { id: win.id, appId: win.appId, title: win.title });
    return win;
  }

  close(id) {
    const win = this.windows.get(id);
    if (!win) return;
    win.el.remove();
    this.windows.delete(id);
    this.order = this.order.filter(x => x !== id);
    this._maximizedSet.delete(id);
    if (this.activeId === id) {
      this.activeId = this.order[this.order.length - 1] || null;
      if (this.activeId) this.focus(this.activeId);
    }
    this._notifyMaximized();
    this._emitState();
    this.bus.emit('win:closed', { id });
  }

  focus(id) {
    const win = this.windows.get(id);
    if (!win) return;
    if (win.minimized) win.restore();
    for (const [wid, w] of this.windows) w.blur();
    this.order = this.order.filter(x => x !== id);
    this.order.push(id);
    this.activeId = id;
    this._reorderZ();
    win.focus();
    this._emitState();
    this.bus.emit('win:focused', { id, appId: win.appId, title: win.title });
  }

  minimize(id) { this.windows.get(id)?.minimize(); }
  toggleMaximize(id) { this.windows.get(id)?.toggleMaximize(); }

  _reorderZ() {
    this.order.forEach((id, i) => {
      const w = this.windows.get(id);
      if (w) w.el.style.zIndex = this.baseZ + i;
    });
  }

  _emitState() {
    this.bus.emit('win:state', {
      activeId: this.activeId,
      windows: [...this.windows.values()].map(w => ({
        id: w.id, appId: w.appId, title: w.title, icon: w.icon,
        minimized: w.minimized, maximized: w.maximized,
      })),
    });
  }

  _notifyMaximized() {
    let any = false;
    this._maximizedSet.clear();
    for (const w of this.windows.values()) {
      if (w.maximized) { any = true; this._maximizedSet.add(w.id); }
    }
    this.bus.emit('win:maximize-changed', { any });
  }

  _onResize() {
    for (const w of this.windows.values()) {
      if (w.maximized) continue;
      w.rect.x = clamp(w.rect.x, 0, window.innerWidth - w.rect.w);
      w.rect.y = clamp(w.rect.y, 0, window.innerHeight - w.rect.h - 72);
      w._applyRect();
    }
  }
}
