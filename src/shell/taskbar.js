/**
 * 任务栏
 *
 * 结构（Win11 布局）：
 *   [ 左：可选「显示桌面」 ] [ 中：开始按钮 + 应用图标区（居中） ] [ 右：系统托盘 ]
 *
 * 关键设计：
 * - **按 appId 堆叠**：同一应用的多个窗口合并为一个按钮，下方指示条随窗口数变长；
 *   单窗口点击 = 聚焦/最小化切换；多窗口点击 = 展开缩略图预览浮层。
 * - **增量更新**：订阅窗口事件后只重绘发生变化的按钮，避免每次窗口操作全量重建 DOM。
 * - **Aero 规则二** 由 CSS 的 `body[data-has-maximized]` 选择器实现，任务栏本身不写任何
 *   毛玻璃相关的 JS 分支。
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
  }

  /** @param {HTMLElement} layer #shell-layer */
  init(layer) {
    this.el = document.createElement('div');
    this.el.className = 'taskbar';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', '任务栏');

    this.el.innerHTML = `
      <div class="tb-left"></div>
      <div class="tb-center">
        <button class="tb-start" type="button" title="开始" aria-label="开始" aria-haspopup="true" aria-expanded="false">
          ${getIcon('windows', 22)}
        </button>
        <div class="tb-apps" role="group" aria-label="正在运行的应用"></div>
      </div>
      <div class="tb-right">
        <div class="tb-tray">
          <button class="tray-btn" type="button" data-tray="network" title="网络">${getIcon('network', 16)}</button>
          <button class="tray-btn" type="button" data-tray="volume" title="音量">${getIcon('volume', 16)}</button>
          <button class="tray-btn" type="button" data-tray="battery" title="电源">${getIcon('battery', 16)}</button>
        </div>
        <button class="tb-clock" type="button" title="日期和时间" aria-label="日期和时间">
          <span class="tbc-time"></span><span class="tbc-date"></span>
        </button>
        <button class="tb-notify" type="button" title="通知" aria-label="通知中心">${getIcon('bell', 16)}</button>
        <button class="tb-showdesktop" type="button" title="显示桌面" aria-label="显示桌面"></button>
      </div>`;

    layer.appendChild(this.el);

    this.appsEl = this.el.querySelector('.tb-apps');
    this.startBtn = this.el.querySelector('.tb-start');

    this._bindEvents();
    this._startClock();
    this.render();

    log.info('任务栏已就绪');
  }

  /* ==========================================================
     渲染
     ========================================================== */

  /** 计算需要展示的按钮序列：固定应用 ∪ 运行中应用（保持固定顺序在前） */
  _computeEntries() {
    const pinned = settings.get('taskbar.pinned') || [];
    const running = new Map(); // appId → windows[]
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

  /** 全量渲染（增删按钮），内部对未变化的按钮只做状态同步 */
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
      // 保证 DOM 顺序与逻辑顺序一致（仅在错位时移动，避免无谓的 DOM 操作）
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
    btn.className = 'tb-app';
    btn.type = 'button';
    btn.dataset.appId = entry.appId;
    btn.innerHTML = `<span class="tba-icon"></span><span class="tba-indicator"></span>`;

    btn.addEventListener('click', () => this._onButtonClick(entry.appId));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      taskbarPreview.hide(true);
      contextMenu.openAt(e.clientX, e.clientY, this._buttonMenu(entry.appId));
    });
    btn.addEventListener('pointerenter', () => {
      const windows = windowManager.getByAppId(entry.appId);
      if (windows.length) taskbarPreview.requestShow(btn, entry.appId);
    });
    btn.addEventListener('pointerleave', () => taskbarPreview.requestHide());
    // 中键关闭最近的窗口 / 打开新实例
    btn.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      window.WinNext?.launchApp(entry.appId, {}, { forceNew: true });
    });

    return btn;
  }

  _syncButton(btn, entry) {
    const count = entry.windows.length;
    const active = entry.windows.some((w) => w === windowManager.activeWindow && w.state !== 'minimized');

    btn.dataset.running = count > 0 ? 'true' : 'false';
    btn.dataset.count = String(Math.min(count, 3));
    btn.classList.toggle('is-active', active);
    btn.classList.toggle('is-pinned', entry.pinned);
    btn.title = count > 1 ? `${entry.name}（${count} 个窗口）` : entry.name;
    btn.setAttribute('aria-label', btn.title);

    const iconSlot = btn.querySelector('.tba-icon');
    const markup = this._iconMarkup(entry.icon, 22);
    if (iconSlot.dataset.sig !== markup) {
      iconSlot.dataset.sig = markup;
      iconSlot.innerHTML = markup;
    }
  }

  _iconMarkup(icon, size) {
    if (typeof icon === 'string' && icon.trim().startsWith('<svg')) return icon;
    if (typeof icon === 'string' && /^(https?:|data:|blob:|\.|\/)/.test(icon)) {
      return `<img src="${icon}" width="${size}" height="${size}" alt="" onerror="this.style.display='none'">`;
    }
    return getIcon(icon || 'fileGeneric', size);
  }

  /* ==========================================================
     交互
     ========================================================== */

  async _onButtonClick(appId) {
    const windows = windowManager.getByAppId(appId);
    taskbarPreview.hide(true);
    bus.emit('shell:close-popups', { source: 'taskbar' });

    if (!windows.length) {
      try {
        await window.WinNext?.launchApp(appId);
      } catch (err) {
        log.error(`启动 ${appId} 失败`, err);
      }
      return;
    }

    if (windows.length === 1) {
      const win = windows[0];
      if (win.state === 'minimized') win.restore();
      else if (windowManager.activeWindow === win) win.minimize();
      else windowManager.focus(win);
      return;
    }

    // 多窗口：优先展开预览；若已展开则轮转焦点
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

    const jumpList = windows.slice(0, 6).map((win) => ({
      id: `win-${win.id}`,
      label: win.title,
      icon: 'window',
      onClick: () => (win.state === 'minimized' ? win.restore() : windowManager.focus(win)),
    }));

    return [
      ...(jumpList.length ? [{ id: 'header', label: '窗口', disabled: true }, ...jumpList, { separator: true }] : []),
      {
        id: 'open',
        label: windows.length ? '打开新窗口' : '打开',
        icon: 'add',
        disabled: !app,
        onClick: () => window.WinNext?.launchApp(appId, {}, { forceNew: true }),
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
    const timeEl = this.el.querySelector('.tbc-time');
    const dateEl = this.el.querySelector('.tbc-date');
    const tick = () => {
      const now = new Date();
      const use24 = settings.get('system.use24Hour') !== false;
      timeEl.textContent = now.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: !use24,
      });
      dateEl.textContent = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
      // 对齐到下一分钟边界，避免每秒无谓重绘
      const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 20;
      this._clockTimer = window.setTimeout(tick, Math.max(1000, delay));
    };
    tick();
  }

  _openVolumeFlyout(anchor) {
    bus.emit('shell:close-popups', { source: 'taskbar' });
    if (this._volumeEl) {
      this._closeVolumeFlyout();
      return;
    }
    const el = document.createElement('div');
    el.className = 'volume-flyout';
    const value = Math.round((settings.get('system.volume') ?? 0.6) * 100);
    el.innerHTML = `
      <div class="vf-row">
        <span class="vf-icon">${getIcon('volume', 18)}</span>
        <input class="vf-slider" type="range" min="0" max="100" value="${value}" aria-label="音量">
        <span class="vf-value">${value}</span>
      </div>`;
    document.body.appendChild(el);

    const r = anchor.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.left + r.width / 2 - el.offsetWidth / 2))}px`;
    el.style.top = `${r.top - el.offsetHeight - 10}px`;

    const slider = el.querySelector('.vf-slider');
    const label = el.querySelector('.vf-value');
    slider.addEventListener('input', () => {
      label.textContent = slider.value;
      settings.set('system.volume', Number(slider.value) / 100);
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

    this.el.querySelector('.tb-notify').addEventListener('click', () => {
      bus.emit('shell:close-popups', { source: 'taskbar' });
      bus.emit('notification-center:toggle');
    });

    this.el.querySelector('.tb-clock').addEventListener('click', () => {
      bus.emit('shell:close-popups', { source: 'taskbar' });
      bus.emit('notification-center:toggle');
    });

    this.el.querySelector('.tb-showdesktop').addEventListener('click', () => {
      windowManager.minimizeAll();
    });

    this.el.querySelector('.tb-tray').addEventListener('click', (e) => {
      const btn = e.target.closest('.tray-btn');
      if (!btn) return;
      const kind = btn.dataset.tray;
      if (kind === 'volume') {
        this._openVolumeFlyout(btn);
      } else if (kind === 'network') {
        notifications.toast({
          title: '网络',
          body: navigator.onLine ? '已连接到 Internet' : '当前处于脱机状态',
          type: navigator.onLine ? 'success' : 'warning',
        });
      } else {
        window.WinNext?.launchApp('settings', { section: 'system' });
      }
    });

    this.el.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tb-app')) return; // 应用按钮有自己的菜单
      e.preventDefault();
      contextMenu.openAt(e.clientX, e.clientY, [
        { id: 'tm', label: '任务管理器', icon: 'taskManager', onClick: () => window.WinNext?.launchApp('task-manager') },
        { separator: true },
        {
          id: 'center',
          label: '图标居中对齐',
          checked: settings.get('taskbar.align') !== 'left',
          onClick: () => settings.set('taskbar.align', settings.get('taskbar.align') === 'left' ? 'center' : 'left'),
        },
        {
          id: 'settings',
          label: '任务栏设置',
          icon: 'settings',
          onClick: () => window.WinNext?.launchApp('settings', { section: 'personalization' }),
        },
      ]);
    });

    // 窗口生命周期 → 增量刷新
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
      bus.on('startmenu:opened', () => this.startBtn.setAttribute('aria-expanded', 'true')),
      bus.on('startmenu:closed', () => this.startBtn.setAttribute('aria-expanded', 'false')),
      bus.on('shell:close-popups', (p) => {
        if (p?.source !== 'taskbar-volume') this._closeVolumeFlyout();
      }),
    );

    this.el.dataset.align = settings.get('taskbar.align') || 'center';

    document.addEventListener('pointerdown', (e) => {
      if (this._volumeEl && !this._volumeEl.contains(e.target) && !e.target.closest('[data-tray="volume"]')) {
        this._closeVolumeFlyout();
      }
    });
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
  }
}

export const taskbar = new Taskbar();
export default taskbar;
