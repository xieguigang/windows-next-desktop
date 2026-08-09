/**
 * 窗口管理器
 *
 * 关键职责：
 *  1. 窗口的创建 / 关闭 / 聚焦 / z-order 分配
 *  2. **Aero 规则二**：维护 maximizedCount，在 rAF 内向 <body> 写入
 *     data-has-maximized，任务栏与开始菜单的毛玻璃由 CSS 后代选择器响应，
 *     全程只有一次 DOM 写入，不做任何逐元素 classList 操作。
 *  3. Snap 贴边区域检测与提示
 *  4. 工作区尺寸维护（随窗口 resize 与任务栏高度变化）
 */

import bus from './event-bus.js';
import { createLogger } from './logger.js';
import { debounce } from './storage.js';
import { WinWindow } from './window.js';

const log = createLogger('WindowManager');

const Z_BASE = 1000;
const Z_TOP_BASE = 5000;
const CASCADE_STEP = 28;
const SNAP_EDGE = 8;      // 触发贴边的边缘像素阈值
const SNAP_CORNER = 120;  // 触发四角贴边的角区尺寸

export class WindowManager {
  constructor() {
    /** @type {Map<string, WinWindow>} */
    this.windows = new Map();
    /** @type {WinWindow[]} 按 z-order 从低到高 */
    this.zOrder = [];
    /** @type {WinWindow|null} */
    this.activeWindow = null;

    this.maximizedCount = 0;
    this._hasMaximized = false;
    this._rafPending = false;
    this._cascadeIndex = 0;

    this.workArea = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight - 48 };

    /** @type {HTMLElement|null} */
    this.layer = null;
    /** @type {HTMLElement|null} */
    this.snapHintEl = null;
    /** @type {string|null} */
    this._pendingSnapZone = null;

    this.persist = debounce(() => this._persistState(), 400);
  }

  /** @param {HTMLElement} layer */
  init(layer) {
    this.layer = layer;
    this._updateWorkArea();

    const onResize = debounce(() => {
      this._updateWorkArea();
      for (const w of this.windows.values()) {
        if (w.state === 'maximized') w._applyGeometry();
        else this.clampIntoView(w);
      }
      bus.emit('wm:workarea-changed', this.workArea);
    }, 120);
    window.addEventListener('resize', onResize);

    this._bindKeyboard();
    // 首次同步，确保 body 属性与初始状态一致
    this._syncMaximizedFlag(true);
    log.info('窗口管理器已初始化');
  }

  _updateWorkArea() {
    const taskbarH = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--taskbar-height'), 10
    ) || 48;
    this.workArea = {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: Math.max(240, window.innerHeight - taskbarH),
    };
  }

  /* ==========================================================
     创建 / 销毁
     ========================================================== */

  /**
   * @param {import('./window.js').WindowOptions} options
   * @returns {WinWindow}
   */
  createWindow(options) {
    const win = new WinWindow(options, this);

    // 未指定位置时级联偏移，避免新窗口完全重叠
    if (options.x === undefined || options.y === undefined) {
      const wa = this.workArea;
      const offset = (this._cascadeIndex % 8) * CASCADE_STEP;
      this._cascadeIndex++;
      win.x = Math.max(0, Math.round((wa.width - win.width) / 2) + offset - 100);
      win.y = Math.max(0, Math.round((wa.height - win.height) / 2) + offset - 60);
    }
    this.clampIntoView(win);
    win._applyGeometry();

    this.windows.set(win.id, win);
    this.zOrder.push(win);
    this.layer.appendChild(win.el);

    // 开场动画结束后移除类，避免影响后续 transform
    win.el.addEventListener('animationend', () => win.el.classList.remove('is-opening'), { once: true });

    this.focus(win);
    bus.emit('window:created', { window: win });
    log.debug(`窗口已创建 ${win.id} (${win.appId})`);
    return win;
  }

  /** @param {WinWindow} win */
  unregister(win) {
    this.windows.delete(win.id);
    const i = this.zOrder.indexOf(win);
    if (i >= 0) this.zOrder.splice(i, 1);
    if (this.activeWindow === win) {
      this.activeWindow = null;
      const next = this._topVisible();
      if (next) this.focus(next);
    }
    this.notifyStateChange(win);
    bus.emit('window:closed', { window: win, id: win.id, appId: win.appId });
    log.debug(`窗口已关闭 ${win.id}`);
  }

  /** 关闭指定应用的全部窗口 */
  closeByAppId(appId) {
    for (const w of this.getByAppId(appId)) w.close();
  }

  /* ==========================================================
     查询
     ========================================================== */

  /** @param {string} id */
  get(id) {
    return this.windows.get(id) || null;
  }

  /** @returns {WinWindow[]} 按创建顺序 */
  getAll() {
    return [...this.windows.values()];
  }

  /** @param {string} appId @returns {WinWindow[]} */
  getByAppId(appId) {
    return this.getAll().filter((w) => w.appId === appId);
  }

  /** @returns {WinWindow|null} z 序最高且未最小化的窗口 */
  _topVisible() {
    for (let i = this.zOrder.length - 1; i >= 0; i--) {
      const w = this.zOrder[i];
      if (w.state !== 'minimized' && !w.isDestroyed) return w;
    }
    return null;
  }

  /* ==========================================================
     焦点与 z-order
     ========================================================== */

  /** @param {WinWindow} win */
  focus(win) {
    if (!win || win.isDestroyed) return;
    if (win.state === 'minimized') {
      win.restore();
      return;
    }
    if (this.activeWindow === win) {
      // 已聚焦时仅确保 z 序在顶部
      if (this.zOrder[this.zOrder.length - 1] !== win) this._raise(win);
      return;
    }
    if (this.activeWindow) this.activeWindow.setActive(false);
    this.activeWindow = win;
    win.setActive(true);
    this._raise(win);
    win.el.focus({ preventScroll: true });
    bus.emit('window:focused', { window: win });
  }

  /** 把窗口提到 z 序顶端，仅重排一个元素 */
  _raise(win) {
    const i = this.zOrder.indexOf(win);
    if (i >= 0) this.zOrder.splice(i, 1);
    this.zOrder.push(win);
    // 只重算受影响的窗口 z-index，避免全量刷新
    this.zOrder.forEach((w, idx) => {
      const z = (w.alwaysOnTop ? Z_TOP_BASE : Z_BASE) + idx;
      if (w.zIndex !== z) w.setZIndex(z);
    });
  }

  /** 当前窗口最小化 / 关闭后自动聚焦下一个 */
  focusNext(exclude) {
    if (this.activeWindow === exclude) {
      this.activeWindow.setActive(false);
      this.activeWindow = null;
    }
    const next = this._topVisible();
    if (next && next !== exclude) this.focus(next);
  }

  /** Alt+Tab 循环切换 */
  cycleWindows(reverse = false) {
    const list = this.getAll().filter((w) => w.state !== 'minimized');
    if (list.length < 2) {
      if (list.length === 1) this.focus(list[0]);
      return;
    }
    const ordered = this.zOrder.filter((w) => w.state !== 'minimized');
    const cur = ordered.indexOf(this.activeWindow);
    const nextIdx = reverse
      ? (cur + 1) % ordered.length
      : (cur - 1 + ordered.length) % ordered.length;
    this.focus(ordered[nextIdx]);
  }

  /** 最小化全部窗口（显示桌面） */
  minimizeAll() {
    const visible = this.getAll().filter((w) => w.state !== 'minimized');
    if (visible.length) {
      this._lastMinimizedBatch = visible;
      visible.forEach((w) => w.minimize());
    } else if (this._lastMinimizedBatch) {
      this._lastMinimizedBatch.forEach((w) => !w.isDestroyed && w.restore());
      this._lastMinimizedBatch = null;
    }
  }

  /* ==========================================================
     Aero 规则二：全局最大化状态广播
     ========================================================== */

  /**
   * 任何窗口状态变化后调用。合帧执行，连续操作只写一次 DOM。
   * @param {WinWindow} [win]
   */
  notifyStateChange(win) {
    if (win) bus.emit('window:state-changed', { window: win, state: win.state });
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      this._syncMaximizedFlag();
      this.persist();
    });
  }

  /**
   * 重算最大化窗口数量并同步到 <body data-has-maximized>。
   * 任务栏 / 开始菜单的不透明化完全由 CSS 依据此属性触发。
   * @param {boolean} [force]
   */
  _syncMaximizedFlag(force = false) {
    let count = 0;
    for (const w of this.windows.values()) {
      if (w.state === 'maximized' && !w.isDestroyed) count++;
    }
    this.maximizedCount = count;
    const has = count > 0;
    if (has === this._hasMaximized && !force) return;
    this._hasMaximized = has;
    document.body.dataset.hasMaximized = String(has);
    bus.emit('wm:maximized-count-changed', { count, hasMaximized: has });
    log.debug(`最大化窗口数 = ${count}，body[data-has-maximized]=${has}`);
  }

  /** @returns {boolean} */
  hasMaximizedWindow() {
    return this._hasMaximized;
  }

  /* ==========================================================
     Snap 贴边
     ========================================================== */

  /**
   * 根据指针位置判定贴边区域
   * @param {number} px @param {number} py
   * @returns {string|null}
   */
  detectSnapZone(px, py) {
    const wa = this.workArea;
    const nearLeft = px <= SNAP_EDGE;
    const nearRight = px >= wa.width - SNAP_EDGE;
    const nearTop = py <= SNAP_EDGE;

    if (nearTop && px > SNAP_CORNER && px < wa.width - SNAP_CORNER) return 'max';
    if (nearLeft && py <= SNAP_CORNER) return 'top-left';
    if (nearLeft && py >= wa.height - SNAP_CORNER) return 'bottom-left';
    if (nearRight && py <= SNAP_CORNER) return 'top-right';
    if (nearRight && py >= wa.height - SNAP_CORNER) return 'bottom-right';
    if (nearLeft) return 'left';
    if (nearRight) return 'right';
    if (nearTop) return 'max';
    return null;
  }

  /** 拖拽过程中更新贴边提示层 */
  updateSnapHint(px, py) {
    const zone = this.detectSnapZone(px, py);
    this._pendingSnapZone = zone;
    if (!this.snapHintEl) {
      this.snapHintEl = document.createElement('div');
      this.snapHintEl.className = 'snap-hint';
      document.body.appendChild(this.snapHintEl);
    }
    const el = this.snapHintEl;
    if (!zone) {
      el.classList.remove('is-visible');
      return;
    }
    const wa = this.workArea;
    const hw = Math.floor(wa.width / 2);
    const hh = Math.floor(wa.height / 2);
    const rects = {
      max: { left: 0, top: 0, width: wa.width, height: wa.height },
      left: { left: 0, top: 0, width: hw, height: wa.height },
      right: { left: wa.width - hw, top: 0, width: hw, height: wa.height },
      'top-left': { left: 0, top: 0, width: hw, height: hh },
      'top-right': { left: wa.width - hw, top: 0, width: hw, height: hh },
      'bottom-left': { left: 0, top: wa.height - hh, width: hw, height: hh },
      'bottom-right': { left: wa.width - hw, top: wa.height - hh, width: hw, height: hh },
    };
    const r = rects[zone];
    Object.assign(el.style, {
      left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    });
    el.classList.add('is-visible');
  }

  /** 松手时取出并清除贴边提示 */
  consumeSnapHint() {
    const zone = this._pendingSnapZone;
    this._pendingSnapZone = null;
    if (this.snapHintEl) this.snapHintEl.classList.remove('is-visible');
    return zone;
  }

  /** 把窗口约束回可视区域内，至少保留标题栏可点击 */
  clampIntoView(win) {
    const wa = this.workArea;
    const minVisible = 120;
    win.width = Math.min(win.width, wa.width);
    win.height = Math.min(win.height, wa.height);
    win.x = Math.min(Math.max(win.x, -(win.width - minVisible)), wa.width - minVisible);
    win.y = Math.min(Math.max(win.y, 0), Math.max(0, wa.height - 38));
    win._applyGeometry();
  }

  /* ==========================================================
     指针屏蔽层（避免 iframe / Shadow DOM 吞事件）
     ========================================================== */

  /** @param {string} cursor */
  showPointerShield(cursor = 'default') {
    const el = document.createElement('div');
    el.className = 'pointer-shield';
    el.style.cursor = cursor;
    document.body.appendChild(el);
    return el;
  }

  /* ==========================================================
     键盘快捷键
     ========================================================== */

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const w = this.activeWindow;
      // Alt+Tab
      if (e.altKey && e.key === 'Tab') {
        e.preventDefault();
        this.cycleWindows(e.shiftKey);
        return;
      }
      // Win + D：显示桌面
      if (e.key === 'd' && e.metaKey) {
        e.preventDefault();
        this.minimizeAll();
        return;
      }
      if (!w) return;
      // Alt+F4：关闭当前窗口
      if (e.altKey && e.key === 'F4') {
        e.preventDefault();
        w.close();
        return;
      }
      // Win + 方向键：Snap
      if (e.metaKey && !e.altKey) {
        const map = {
          ArrowLeft: 'left', ArrowRight: 'right',
          ArrowUp: 'max',
        };
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (w.state === 'maximized' || w.state === 'snapped') w.restore();
          else w.minimize();
          return;
        }
        if (map[e.key]) {
          e.preventDefault();
          w.snapTo(map[e.key]);
        }
      }
    });
  }

  /* ==========================================================
     持久化（仅记录几何，便于下次同应用打开时沿用）
     ========================================================== */

  _persistState() {
    try {
      const data = {};
      for (const w of this.windows.values()) {
        if (w.state === 'minimized') continue;
        data[w.appId] = {
          ...w.restoreRect,
          maximized: w.state === 'maximized',
        };
      }
      localStorage.setItem('winnext:wm:geometry', JSON.stringify(data));
    } catch {
      /* 配额问题静默忽略，几何记忆不是关键数据 */
    }
  }

  /** @param {string} appId @returns {{x:number,y:number,width:number,height:number,maximized:boolean}|null} */
  getSavedGeometry(appId) {
    try {
      const raw = localStorage.getItem('winnext:wm:geometry');
      if (!raw) return null;
      return JSON.parse(raw)[appId] || null;
    } catch {
      return null;
    }
  }
}

export const windowManager = new WindowManager();
export default windowManager;
