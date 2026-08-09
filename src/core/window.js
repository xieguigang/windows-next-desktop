/**
 * 单窗口实现
 *
 * 职责：
 *  - 构建窗口 DOM（标题栏 + 控制按钮 + Shadow DOM 内容宿主）
 *  - 状态机 data-state：normal | maximized | minimized | snapped
 *    （Aero 规则一完全由 CSS 依据该属性实现，本类不做任何毛玻璃相关的样式操作）
 *  - Pointer Events 拖拽与八向缩放
 *  - disposables 生命周期清理
 */

import bus from './event-bus.js';
import { createLogger } from './logger.js';
import { getIcon } from '../ui/icons.js';

const log = createLogger('Window');

let seq = 0;

/** 缩放方向 */
const RESIZE_DIRS = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];

/**
 * @typedef {Object} WindowOptions
 * @property {string} appId
 * @property {string} title
 * @property {string} icon            图标名或 SVG 字符串
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [width=800]
 * @property {number} [height=560]
 * @property {number} [minWidth=280]
 * @property {number} [minHeight=180]
 * @property {boolean} [resizable=true]
 * @property {boolean} [maximizable=true]
 * @property {boolean} [minimizable=true]
 */

export class WinWindow {
  /**
   * @param {WindowOptions} options
   * @param {import('./window-manager.js').WindowManager} manager
   */
  constructor(options, manager) {
    this.id = `win-${++seq}`;
    this.manager = manager;
    this.appId = options.appId;
    this.title = options.title || '未命名';
    this.icon = options.icon || 'fileGeneric';

    this.minWidth = Math.max(200, options.minWidth ?? 280);
    this.minHeight = Math.max(120, options.minHeight ?? 180);
    this.resizable = options.resizable !== false;
    this.maximizable = options.maximizable !== false;
    this.minimizable = options.minimizable !== false;

    this.width = Math.max(this.minWidth, options.width ?? 800);
    this.height = Math.max(this.minHeight, options.height ?? 560);
    this.x = options.x ?? 0;
    this.y = options.y ?? 0;

    /** 上一次普通态的几何，用于最大化 / Snap 还原 */
    this.restoreRect = { x: this.x, y: this.y, width: this.width, height: this.height };

    /** @type {'normal'|'maximized'|'minimized'|'snapped'} */
    this.state = 'normal';
    /** 最小化前的状态，用于恢复 */
    this.prevState = 'normal';
    this.isActive = false;
    this.isDestroyed = false;

    /** @type {Array<() => void>} 关闭时执行的清理函数 */
    this.disposables = [];
    /** @type {(() => string)|null} 任务栏预览摘要提供者 */
    this.previewProvider = null;

    this._buildDOM();
    this._bindEvents();
  }

  /* ==========================================================
     DOM 构建
     ========================================================== */

  _buildDOM() {
    const el = document.createElement('div');
    el.className = 'window is-opening';
    el.id = this.id;
    el.dataset.state = 'normal';
    el.dataset.appId = this.appId;
    el.dataset.resizable = String(this.resizable);
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', this.title);
    el.tabIndex = -1;

    // 标题栏
    const titlebar = document.createElement('div');
    titlebar.className = 'window-titlebar';

    const iconEl = document.createElement('span');
    iconEl.className = 'window-icon';
    iconEl.innerHTML = this._renderIcon(16);

    const titleEl = document.createElement('span');
    titleEl.className = 'window-title';
    titleEl.textContent = this.title;

    const caption = document.createElement('div');
    caption.className = 'window-caption';
    if (this.minimizable) caption.appendChild(this._captionBtn('minimize', '最小化'));
    if (this.maximizable) caption.appendChild(this._captionBtn('maximize', '最大化'));
    caption.appendChild(this._captionBtn('close', '关闭'));

    titlebar.append(iconEl, titleEl, caption);

    // 内容区 + Shadow DOM 宿主
    const body = document.createElement('div');
    body.className = 'window-body';
    const host = document.createElement('div');
    host.className = 'window-host';
    body.appendChild(host);

    el.append(titlebar, body);

    // 缩放热区
    if (this.resizable) {
      for (const dir of RESIZE_DIRS) {
        const h = document.createElement('div');
        h.className = 'resize-handle';
        h.dataset.dir = dir;
        el.appendChild(h);
      }
    }

    this.el = el;
    this.titlebarEl = titlebar;
    this.iconEl = iconEl;
    this.titleEl = titleEl;
    this.bodyEl = body;
    this.hostEl = host;
    this.captionEl = caption;

    /** @type {ShadowRoot} 应用内容挂载点，样式天然隔离 */
    this.shadow = host.attachShadow({ mode: 'open' });

    this._applyGeometry();
  }

  /**
   * @param {'minimize'|'maximize'|'close'} action
   * @param {string} label
   */
  _captionBtn(action, label) {
    const btn = document.createElement('button');
    btn.className = 'caption-btn';
    btn.dataset.action = action;
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = getIcon(action === 'maximize' ? 'maximize' : action, 16);
    return btn;
  }

  /** @param {number} size */
  _renderIcon(size) {
    if (typeof this.icon === 'string' && this.icon.trim().startsWith('<svg')) return this.icon;
    if (typeof this.icon === 'string' && /^(https?:|data:|\.|\/)/.test(this.icon)) {
      return `<img src="${this.icon}" width="${size}" height="${size}" alt="" onerror="this.style.display='none'">`;
    }
    return getIcon(this.icon, size);
  }

  /* ==========================================================
     事件绑定
     ========================================================== */

  _bindEvents() {
    // 聚焦：捕获阶段，保证点击应用内部也能提升 z-order
    this.el.addEventListener('pointerdown', () => {
      if (!this.isActive) this.manager.focus(this);
    }, { capture: true });

    // 标题栏拖拽
    this.titlebarEl.addEventListener('pointerdown', (e) => this._onTitlebarPointerDown(e));

    // 双击标题栏切换最大化
    this.titlebarEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('.caption-btn')) return;
      if (this.maximizable) this.toggleMaximize();
    });

    // 标题栏右键 → 系统菜单
    this.titlebarEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      bus.emit('window:system-menu', { window: this, x: e.clientX, y: e.clientY });
    });

    // 控制按钮
    this.captionEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.caption-btn');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'close') this.close();
      else if (action === 'minimize') this.minimize();
      else if (action === 'maximize') this.toggleMaximize();
    });

    // 缩放
    if (this.resizable) {
      this.el.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('.resize-handle');
        if (handle) this._onResizePointerDown(e, handle.dataset.dir);
      });
    }
  }

  /* ==========================================================
     拖拽
     ========================================================== */

  /** @param {PointerEvent} e */
  _onTitlebarPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.caption-btn')) return;
    if (this.state === 'minimized') return;

    e.preventDefault();
    this.manager.focus(this);

    const startX = e.clientX;
    const startY = e.clientY;
    let originX = this.x;
    let originY = this.y;
    let moved = false;
    // 最大化窗口拖拽时的还原比例锚点
    const wasMaximized = this.state === 'maximized' || this.state === 'snapped';
    const grabRatio = wasMaximized ? (startX - this.x) / this.width : 0;

    const shield = this.manager.showPointerShield('move');
    this.el.classList.add('is-interacting');

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;

      // 从最大化态拖出 → 还原并把窗口锚在指针处
      if (!moved && wasMaximized) {
        const r = this.restoreRect;
        this.state = 'normal';
        this.el.dataset.state = 'normal';
        this.width = r.width;
        this.height = r.height;
        originX = ev.clientX - r.width * grabRatio;
        originY = Math.max(0, ev.clientY - 19);
        this.manager.notifyStateChange(this);
      }
      moved = true;

      this.x = originX + (wasMaximized ? ev.clientX - startX : dx);
      this.y = Math.max(0, originY + (wasMaximized ? ev.clientY - startY : dy));
      if (wasMaximized) {
        this.x = originX + dx;
        this.y = Math.max(0, originY + dy);
      }
      this._applyGeometry();
      this.manager.updateSnapHint(ev.clientX, ev.clientY);
    };

    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      shield.remove();
      this.el.classList.remove('is-interacting');

      const zone = this.manager.consumeSnapHint(ev.clientX, ev.clientY);
      if (moved && zone) {
        this.snapTo(zone);
      } else if (moved) {
        this.manager.clampIntoView(this);
        this.restoreRect = { x: this.x, y: this.y, width: this.width, height: this.height };
        this.manager.persist();
      }
      bus.emit('window:moved', { window: this });
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  /* ==========================================================
     缩放
     ========================================================== */

  /**
   * @param {PointerEvent} e
   * @param {string} dir
   */
  _onResizePointerDown(e, dir) {
    if (e.button !== 0) return;
    if (this.state === 'maximized') return;
    e.preventDefault();
    e.stopPropagation();
    this.manager.focus(this);

    const startX = e.clientX;
    const startY = e.clientY;
    const o = { x: this.x, y: this.y, w: this.width, h: this.height };
    const maxBottom = this.manager.workArea.height;

    const cursor = {
      n: 'ns-resize', s: 'ns-resize', w: 'ew-resize', e: 'ew-resize',
      nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    }[dir];
    const shield = this.manager.showPointerShield(cursor);
    this.el.classList.add('is-interacting');
    if (this.state === 'snapped') {
      this.state = 'normal';
      this.el.dataset.state = 'normal';
      this.manager.notifyStateChange(this);
    }

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let { x, y, w, h } = o;

      if (dir.includes('e')) w = o.w + dx;
      if (dir.includes('s')) h = o.h + dy;
      if (dir.includes('w')) { w = o.w - dx; x = o.x + dx; }
      if (dir.includes('n')) { h = o.h - dy; y = o.y + dy; }

      // 尺寸下限约束（左/上边缩放时需回推坐标）
      if (w < this.minWidth) {
        if (dir.includes('w')) x = o.x + (o.w - this.minWidth);
        w = this.minWidth;
      }
      if (h < this.minHeight) {
        if (dir.includes('n')) y = o.y + (o.h - this.minHeight);
        h = this.minHeight;
      }
      // 不允许标题栏被拖到屏幕上方之外
      if (y < 0) { h += y; y = 0; }
      if (y + h > maxBottom) h = maxBottom - y;

      this.x = x; this.y = y; this.width = w; this.height = h;
      this._applyGeometry();
      bus.emit('window:resizing', { window: this });
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      shield.remove();
      this.el.classList.remove('is-interacting');
      this.restoreRect = { x: this.x, y: this.y, width: this.width, height: this.height };
      this.manager.persist();
      bus.emit('window:resized', { window: this });
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  /* ==========================================================
     几何
     ========================================================== */

  _applyGeometry() {
    const el = this.el;
    if (this.state === 'maximized') {
      const wa = this.manager.workArea;
      el.style.setProperty('--win-x', '0px');
      el.style.setProperty('--win-y', '0px');
      el.style.transform = 'translate3d(0, 0, 0)';
      el.style.width = `${wa.width}px`;
      el.style.height = `${wa.height}px`;
      return;
    }
    el.style.setProperty('--win-x', `${Math.round(this.x)}px`);
    el.style.setProperty('--win-y', `${Math.round(this.y)}px`);
    el.style.transform = `translate3d(${Math.round(this.x)}px, ${Math.round(this.y)}px, 0)`;
    el.style.width = `${Math.round(this.width)}px`;
    el.style.height = `${Math.round(this.height)}px`;
  }

  /**
   * 设置窗口位置与尺寸
   * @param {{x?:number,y?:number,width?:number,height?:number}} rect
   */
  setRect(rect) {
    if (rect.x !== undefined) this.x = rect.x;
    if (rect.y !== undefined) this.y = rect.y;
    if (rect.width !== undefined) this.width = Math.max(this.minWidth, rect.width);
    if (rect.height !== undefined) this.height = Math.max(this.minHeight, rect.height);
    if (this.state === 'normal') {
      this.restoreRect = { x: this.x, y: this.y, width: this.width, height: this.height };
    }
    this._applyGeometry();
    bus.emit('window:resized', { window: this });
  }

  /** @returns {{x:number,y:number,width:number,height:number}} */
  getRect() {
    if (this.state === 'maximized') {
      const wa = this.manager.workArea;
      return { x: 0, y: 0, width: wa.width, height: wa.height };
    }
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  /* ==========================================================
     状态切换
     ========================================================== */

  /** 切换到最大化，或从最大化 / 贴边还原 */
  toggleMaximize() {
    if (!this.maximizable) return;
    if (this.state === 'maximized') this.restore();
    else this.maximize();
  }

  maximize() {
    if (!this.maximizable || this.state === 'maximized') return;
    if (this.state === 'normal') {
      this.restoreRect = { x: this.x, y: this.y, width: this.width, height: this.height };
    }
    this.state = 'maximized';
    // data-state 变更后，CSS 立即去掉毛玻璃并换成不透明白边框（Aero 规则一）
    this.el.dataset.state = 'maximized';
    this._animateStateChange();
    this._applyGeometry();
    this._syncMaximizeButton();
    this.manager.notifyStateChange(this);
    bus.emit('window:maximized', { window: this });
  }

  restore() {
    if (this.state === 'normal') return;
    const wasMinimized = this.state === 'minimized';
    if (wasMinimized) {
      // 从最小化恢复到最小化之前的状态
      this.state = this.prevState === 'minimized' ? 'normal' : this.prevState;
      this.el.dataset.state = this.state;
      this.el.style.pointerEvents = '';
      this._applyGeometry();
      this._syncMaximizeButton();
      this.manager.focus(this);
      this.manager.notifyStateChange(this);
      bus.emit('window:restored', { window: this });
      return;
    }
    const r = this.restoreRect;
    this.state = 'normal';
    // Aero 毛玻璃随 data-state 回到 normal 自动恢复
    this.el.dataset.state = 'normal';
    this.x = r.x; this.y = r.y; this.width = r.width; this.height = r.height;
    this._animateStateChange();
    this._applyGeometry();
    this.manager.clampIntoView(this);
    this._syncMaximizeButton();
    this.manager.notifyStateChange(this);
    bus.emit('window:restored', { window: this });
  }

  minimize() {
    if (!this.minimizable || this.state === 'minimized') return;
    this.prevState = this.state;
    if (this.state === 'normal') {
      this.restoreRect = { x: this.x, y: this.y, width: this.width, height: this.height };
    }
    this.state = 'minimized';
    this.el.dataset.state = 'minimized';
    this.manager.notifyStateChange(this);
    this.manager.focusNext(this);
    bus.emit('window:minimized', { window: this });
  }

  /**
   * 贴边分屏
   * @param {'left'|'right'|'top-left'|'top-right'|'bottom-left'|'bottom-right'|'max'} zone
   */
  snapTo(zone) {
    const wa = this.manager.workArea;
    if (zone === 'max') { this.maximize(); return; }
    const halfW = Math.floor(wa.width / 2);
    const halfH = Math.floor(wa.height / 2);
    const map = {
      left: { x: 0, y: 0, width: halfW, height: wa.height },
      right: { x: wa.width - halfW, y: 0, width: halfW, height: wa.height },
      'top-left': { x: 0, y: 0, width: halfW, height: halfH },
      'top-right': { x: wa.width - halfW, y: 0, width: halfW, height: halfH },
      'bottom-left': { x: 0, y: wa.height - halfH, width: halfW, height: halfH },
      'bottom-right': { x: wa.width - halfW, y: wa.height - halfH, width: halfW, height: halfH },
    };
    const r = map[zone];
    if (!r) return;
    if (this.state === 'normal') {
      this.restoreRect = { x: this.x, y: this.y, width: this.width, height: this.height };
    }
    this.state = 'snapped';
    // snapped 与 normal 共享 Aero 毛玻璃样式
    this.el.dataset.state = 'snapped';
    this.x = r.x; this.y = r.y;
    this.width = Math.max(this.minWidth, r.width);
    this.height = Math.max(this.minHeight, r.height);
    this._animateStateChange();
    this._applyGeometry();
    this._syncMaximizeButton();
    this.manager.notifyStateChange(this);
    bus.emit('window:snapped', { window: this, zone });
  }

  _animateStateChange() {
    this.el.classList.add('is-animating-state');
    clearTimeout(this._animTimer);
    this._animTimer = setTimeout(() => this.el.classList.remove('is-animating-state'), 220);
  }

  _syncMaximizeButton() {
    const btn = this.captionEl.querySelector('[data-action="maximize"]');
    if (!btn) return;
    const maxed = this.state === 'maximized';
    btn.innerHTML = getIcon(maxed ? 'restore' : 'maximize', 16);
    btn.title = maxed ? '向下还原' : '最大化';
    btn.setAttribute('aria-label', btn.title);
  }

  /* ==========================================================
     属性更新
     ========================================================== */

  /** @param {string} title */
  setTitle(title) {
    this.title = String(title ?? '');
    this.titleEl.textContent = this.title;
    this.el.setAttribute('aria-label', this.title);
    bus.emit('window:title-changed', { window: this });
  }

  /** @param {string} icon 图标名 / SVG 字符串 / 图片 URL */
  setIcon(icon) {
    this.icon = icon;
    this.iconEl.innerHTML = this._renderIcon(16);
    bus.emit('window:icon-changed', { window: this });
  }

  /** @param {boolean} active */
  setActive(active) {
    this.isActive = active;
    this.el.classList.toggle('is-active', active);
  }

  /** @param {number} z */
  setZIndex(z) {
    this.zIndex = z;
    this.el.style.zIndex = String(z);
  }

  /** 注册清理回调，窗口关闭时统一执行 */
  onDispose(fn) {
    if (typeof fn === 'function') this.disposables.push(fn);
  }

  /* ==========================================================
     销毁
     ========================================================== */

  close() {
    if (this.isDestroyed) return;
    // 允许应用拦截关闭（例如未保存提示）
    if (typeof this.beforeClose === 'function') {
      let result;
      try {
        result = this.beforeClose();
      } catch (err) {
        log.error('beforeClose 异常', err);
      }
      if (result === false) return;
      if (result && typeof result.then === 'function') {
        result.then((ok) => { if (ok !== false) this._doClose(); });
        return;
      }
    }
    this._doClose();
  }

  _doClose() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.el.classList.add('is-closing');
    const finish = () => this.destroy();
    this.el.addEventListener('animationend', finish, { once: true });
    // 动画未触发时的兜底
    setTimeout(finish, 200);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    clearTimeout(this._animTimer);
    for (const fn of this.disposables.splice(0)) {
      try {
        fn();
      } catch (err) {
        log.error(`应用 "${this.appId}" 清理回调异常`, err);
      }
    }
    this.previewProvider = null;
    this.beforeClose = null;
    this.el.remove();
    this.manager.unregister(this);
  }
}

export default WinWindow;
