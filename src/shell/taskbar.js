/**
 * 任务栏
 *
 * 结构（Win11 布局）：
 *   [ 左：开始按钮 ] [ 中：应用图标区（居中，可切左对齐） ] [ 右：系统托盘 ]
 *
 * 关键设计：
 * - **按 appId 堆叠**：同一应用的多个窗口合并为一个按钮，`data-stacked` 触发层叠边缘暗示，
 *   指示条随窗口数/激活态变长；单窗口点击 = 聚焦/最小化切换；多窗口点击 = 展开缩略图预览。
 * - **增量更新**：订阅窗口事件后合帧（rAF）刷新，且只对变化的按钮做 DOM 写入。
 * - **Aero 规则二** 完全由 CSS 的 `body[data-has-maximized]` 选择器实现，
 *   任务栏本身不含任何毛玻璃相关的 JS 分支。
 */

import bus from '../core/event-bus.js';
import { createLogger } from '../core/logger.js';
import { settings } from '../core/settings-store.js';
import { windowManager } from '../core/window-manager.js';
import { appRegistry } from '../core/app-registry.js';
import { notifications } from '../core/notification.js';
import { contextMenu } from './context-menu.js';
import { taskbarPreview } from './taskbar-preview.js';
import { getIcon } from '../ui/icons.js';

const log = createLogger('Taskbar');

export class Taskbar {
  constructor() {
    /** @type {HTMLElement|null} */
    this.el = null;
    /** @type {HTMLElement|null} */
    this.appsEl = null;
    /** @type {HTMLElement|null} */
    this.startBtn = null;
    /** @type {Map<string, HTMLElement>} appId → 按钮 */
    this.buttons = new Map();
    this._clockTimer = 0;
    this._disposers = [];
    this._rafPending = false;
    this._volumeEl = null;
  }

  /** @param {HTMLElement} layer #shell-layer */
  init(layer) {
    this.el = document.createElement('div');
    this.el.className = 'taskbar';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', '任务栏');
    this.el.dataset.align = settings.get('taskbar.align') || 'center';

    this.el.innerHTML = `
      <div class="taskbar-start-zone">
        <button class="tb-btn tb-start" type="button" title="开始" aria-label="开始"
                aria-haspopup="true" aria-expanded="false">${getIcon('windows', 22)}</button>
      </div>
      <div class="taskbar-apps" role="group" aria-label="正在运行的应用"></div>
      <div class="taskbar-tray">
        <div class="tray-icons">
          <button class="tray-item" type="button" data-tray="network" title="网络" aria-label="网络">${getIcon('network', 16)}</button>
          <button class="tray-item" type="button" data-tray="volume" title="音量" aria-label="音量">${getIcon('volume', 16)}</button>
        </div>
        <button class="tray-item tray-clock" type="button" title="日期和时间" aria-label="日期和时间">
          <span class="tc-time"></span><span class="tc-date"></span>
        </button>
        <button class="tray-item" type="button" data-tray="notify" title="通知" aria-label="通知中心">${getIcon('bell', 16)}</button>
        <button class="tray-showdesktop" type="button" title="显示桌面" aria-label="显示桌面"></button>
      </div>`;

    layer.appendChild(this.el);

    this.appsEl = this.el.querySelector('.taskbar-apps');
    this.startBtn = this.el.querySelector('.tb-start');

    this._bindEvents();
    this._startClock();
    this.render();

    log.info('任务栏已就绪');
  }

  /* ==========================================================
     渲染
     ========================================================== */

  /** 计算按钮序列：固定应用在前，运行中但未固定的应用追加在后 */
  _computeEntries() {
    const pinned = settings.get('taskbar.pinned') || [];
    /** @type {Map<string, import('../core/window.js').WinWindow[]>} */
    const running = new Map();
    for (const win of windowManager.getAll()) {
      if (!running.has(win.appId)) running.set(win.appId, []);
      running.get(win.appId).push(win);
    }

    const order = [...pinned];
    for (const appId of running.keys()) {
      if (!order.includes(appId)) order.push(appId);
    }

    const entries = [];
    for (const appId of order) {
      const app = appRegistry.get(appId);
      const windows = running.get(appId) || [];
      // 既未注册也没有窗口的固定项（例如被卸载的应用）直接跳过
      if (!app && !windows.length) continue;
      entries.push({
        appId,
        name: app?.name || windows[0]?.title || appId,
        icon: app?.icon || windows[0]?.icon,
        pinned: pinned.includes(appId),
        windows,
      });
    }
    return entries;
  }

  render() {
    if (!this.appsEl) return;
    const entries = this._computeEntries();
    const seen = new Set();

    entries.forEach((entry, index) => {
      seen.add(entry.appId);
      let btn = this.buttons.get(entry.appId);
      if (!btn) {
        btn = this._createButton(entry);
        this.buttons.set(entry.appId, btn);
        this.appsEl.appendChild(btn);
      }
      this._syncButton(btn, entry);
      // 只在错位时移动，避免无谓 DOM 操作
      if (this.appsEl.children[index] !== btn) {
        this.appsEl.insertBefore(btn, this.appsEl.children[index] || null);
      }
    });

    for (const [appId, btn] of this.buttons) {
      if (!seen.has(appId)) {
        btn.remove();
        this.buttons.delete(appId);
      }
    }
  }

  /** 合帧刷新，避免连续窗口事件触发多次重排 */
  scheduleRender() {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      this.render();
    });
  }

  _createButton(entry) {
    const btn = document.createElement('button');
    btn.className = 'tb-btn tb-app';
    btn.type = 'button';
    btn.dataset.appId = entry.appId;
    btn.innerHTML = '<span class="tb-app-glyph"></span><span class="tb-indicator"></span>';

    btn.addEventListener('click', () => this._onButtonClick(entry.appId));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      taskbarPreview.hide(true);
      contextMenu.open(this._buttonMenu(entry.appId), e.clientX, e.clientY);
    });
    btn.addEventListener('pointerenter', () => {
      if (!settings.get('taskbar.showPreview')) return;
      if (windowManager.getByAppId(entry.appId).length) taskbarPreview.requestShow(btn, entry.appId);
    });
    btn.addEventListener('pointerleave', () => taskbarPreview.requestHide());
    // 中键：始终打开新实例
    btn.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      this._launch(entry.appId, {}, { forceNew: true });
    });

    return btn;
  }

  _syncButton(btn, entry) {
    const count = entry.windows.length;
    const active = entry.windows.some((w) => w === windowManager.activeWindow && w.state !== 'minimized');

    setAttr(btn, 'data-running', count > 0 ? 'true' : 'false');
    setAttr(btn, 'data-stacked', count > 1 ? 'true' : 'false');
    setAttr(btn, 'data-active', active ? 'true' : 'false');
    btn.classList.toggle('is-open', count > 0);

    const label = count > 1 ? `${entry.name}（${count} 个窗口）` : entry.name;
    if (btn.title !== label) {
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }

    const slot = btn.querySelector('.tb-app-glyph');
    const markup = iconMarkup(entry.icon, 22);
    if (slot.dataset.sig !== markup) {
      slot.dataset.sig = markup;
      slot.innerHTML = markup;
    }
  }

  /* ==========================================================
     交互
     ========================================================== */

  async _launch(appId, args = {}, opts = {}) {
    try {
      await window.WinNext?.launchApp(appId, args, opts);
    } catch (err) {
      log.error(`启动 ${appId} 失败`, err);
      notifications.toast({ title: '启动失败', body: String(err?.message || err), type: 'error' });
    }
  }

  async _onButtonClick(appId) {
    const windows = windowManager.getByAppId(appId);
    taskbarPreview.hide(true);
    bus.emit('shell:close-popups', { source: 'taskbar' });

    if (!windows.length) {
      await this._launch(appId);
      return;
    }

    if (windows.length === 1) {
      const win = windows[0];
      if (win.state === 'minimized') win.restore();
      else if (windowManager.activeWindow === win) win.minimize();
      else windowManager.focus(win);
      return;
    }

    // 多窗口：首次点击展开预览，已展开时轮转焦点
    const btn = this.buttons.get(appId);
    if (taskbarPreview.appId === appId) {
      const idx = windows.indexOf(windowManager.activeWindow);
      const next = windows[(idx + 1) % windows.length];
      if (next.state === 'minimized') next.restore();
      else windowManager.focus(next);
    } else if (btn) {
      taskbarPreview.show(btn, appId);
    }
  }

  _buttonMenu(appId) {
    const app = appRegistry.get(appId);
    const windows = windowManager.getByAppId(appId);
    const pinned = settings.get('taskbar.pinned') || [];
    const isPinned = pinned.includes(appId);

    const jumpList = windows.slice(0, 8).map((win) => ({
      id: `win-${win.id}`,
      label: win.title,
      icon: 'window',
      onClick: () => (win.state === 'minimized' ? win.restore() : windowManager.focus(win)),
    }));

    return [
      ...(jumpList.length ? [...jumpList, { separator: true }] : []),
      {
        id: 'open',
        label: windows.length ? '打开新窗口' : '打开',
        icon: 'add',
        disabled: !app,
        onClick: () => this._launch(appId, {}, { forceNew: true }),
      },
      {
        id: 'pin',
        label: isPinned ? '从任务栏取消固定' : '固定到任务栏',
        icon: isPinned ? 'unpin' : 'pin',
        onClick: () => this._togglePin(appId),
      },
      { separator: true },
      {
        id: 'close',
        label: windows.length > 1 ? `关闭所有窗口（${windows.length}）` : '关闭窗口',
        icon: 'close',
        disabled: !windows.length,
        danger: true,
        onClick: () => windowManager.closeByAppId(appId),
      },
    ];
  }

  _togglePin(appId) {
    const pinned = [...(settings.get('taskbar.pinned') || [])];
    const idx = pinned.indexOf(appId);
    if (idx >= 0) pinned.splice(idx, 1);
    else pinned.push(appId);
    settings.set('taskbar.pinned', pinned);
  }

  /* ==========================================================
     托盘
     ========================================================== */

  _startClock() {
    const timeEl = this.el.querySelector('.tc-time');
    const dateEl = this.el.querySelector('.tc-date');
    const tick = () => {
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      dateEl.textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
      // 对齐到下一分钟边界，避免每秒无谓重绘
      const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 20;
      this._clockTimer = window.setTimeout(tick, Math.max(1000, delay));
    };
    tick();
  }

  _toggleVolumeFlyout(anchor) {
    if (this._volumeEl) {
      this._closeVolumeFlyout();
      return;
    }
    bus.emit('shell:close-popups', { source: 'taskbar-volume' });

    const el = document.createElement('div');
    el.className = 'volume-flyout';
    const value = Math.round((settings.get('wallpaper.videoVolume') ?? 0.5) * 100);
    el.innerHTML = `
      <span class="vf-icon">${getIcon('volume', 18)}</span>
      <input type="range" min="0" max="100" value="${value}" aria-label="音量">
      <span class="vf-value" style="min-width:28px;text-align:right;font-variant-numeric:tabular-nums">${value}</span>`;
    document.body.appendChild(el);

    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    el.style.top = `${Math.max(8, r.top - h - 10)}px`;

    const slider = el.querySelector('input[type="range"]');
    const label = el.querySelector('.vf-value');
    slider.addEventListener('input', () => {
      label.textContent = slider.value;
      settings.set('wallpaper.videoVolume', Number(slider.value) / 100);
    });

    this._volumeEl = el;
  }

  _closeVolumeFlyout() {
    this._volumeEl?.remove();
    this._volumeEl = null;
  }

  /* ==========================================================
     事件
     ========================================================== */

  _bindEvents() {
    this.startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bus.emit('startmenu:toggle');
    });

    this.el.querySelector('.tray-showdesktop').addEventListener('click', () => {
      bus.emit('shell:close-popups', { source: 'taskbar' });
      windowManager.minimizeAll();
    });

    this.el.querySelector('.taskbar-tray').addEventListener('click', (e) => {
      const item = e.target.closest('.tray-item');
      if (!item) return;
      const kind = item.dataset.tray;
      if (kind === 'volume') {
        this._toggleVolumeFlyout(item);
        return;
      }
      bus.emit('shell:close-popups', { source: 'taskbar' });
      if (kind === 'network') {
        notifications.toast({
          title: '网络',
          body: navigator.onLine ? '已连接到 Internet' : '当前处于脱机状态',
          type: navigator.onLine ? 'success' : 'warning',
        });
      } else {
        // 通知按钮与时钟都打开通知中心
        bus.emit('notification-center:toggle');
      }
    });

    // 任务栏空白区右键
    this.el.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tb-app')) return;
      e.preventDefault();
      const align = settings.get('taskbar.align');
      contextMenu.open([
        { id: 'tm', label: '任务管理器', icon: 'taskManager', onClick: () => this._launch('task-manager') },
        { separator: true },
        {
          id: 'align',
          label: '图标居中对齐',
          checked: align !== 'left',
          onClick: () => settings.set('taskbar.align', align === 'left' ? 'center' : 'left'),
        },
        {
          id: 'settings',
          label: '任务栏设置',
          icon: 'settings',
          onClick: () => this._launch('settings', { section: 'personalization' }),
        },
      ], e.clientX, e.clientY);
    });

    document.addEventListener('pointerdown', (e) => {
      if (this._volumeEl && !this._volumeEl.contains(e.target) && !e.target.closest('[data-tray="volume"]')) {
        this._closeVolumeFlyout();
      }
    });

    const refresh = () => this.scheduleRender();
    this._disposers.push(
      bus.on('window:created', refresh),
      bus.on('window:closed', refresh),
      bus.on('window:focused', refresh),
      bus.on('window:minimized', refresh),
      bus.on('window:state-changed', refresh),
      bus.on('window:title-changed', refresh),
      bus.on('app:registered', refresh),
      settings.subscribe('taskbar.pinned', refresh),
      settings.subscribe('taskbar.align', (v) => {
        this.el.dataset.align = v;
      }),
      bus.on('startmenu:opened', () => {
        this.startBtn.setAttribute('aria-expanded', 'true');
        this.startBtn.classList.add('is-open');
      }),
      bus.on('startmenu:closed', () => {
        this.startBtn.setAttribute('aria-expanded', 'false');
        this.startBtn.classList.remove('is-open');
      }),
      bus.on('shell:close-popups', (p) => {
        if (p?.source !== 'taskbar-volume') this._closeVolumeFlyout();
      }),
    );
  }

  dispose() {
    clearTimeout(this._clockTimer);
    this._closeVolumeFlyout();
    this._disposers.forEach((fn) => {
      try {
        fn();
      } catch { /* ignore */ }
    });
    this._disposers = [];
    this.el?.remove();
    this.buttons.clear();
  }
}

/* ==========================================================
   工具
   ========================================================== */

/** 仅在值变化时写 DOM，减少属性写入引发的样式重算 */
function setAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function iconMarkup(icon, size) {
  if (typeof icon === 'string' && icon.trim().startsWith('<svg')) return icon;
  if (typeof icon === 'string' && /^(https?:|data:|blob:|\.|\/)/.test(icon)) {
    return `<img src="${icon}" width="${size}" height="${size}" alt="" onerror="this.style.display='none'">`;
  }
  return getIcon(icon || 'fileGeneric', size);
}

export const taskbar = new Taskbar();
export default taskbar;
