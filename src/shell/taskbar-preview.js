/**
 * 任务栏缩略图预览浮层
 *
 * 设计取舍：不做实时位图截图（html2canvas 之类开销不可接受且与 Shadow DOM 冲突），
 * 而是渲染「结构化预览卡片」：应用图标 + 窗口标题 + 应用通过
 * `ctx.setPreviewProvider()` 注册的摘要文本。视觉上接近 Win11，开销恒定。
 *
 * 交互：悬停 HOVER_DELAY 后弹出；移出后 GRACE_PERIOD 内移回则不关闭；
 * 悬停某一项时给对应窗口加发光边框（peek）；点击切换焦点；关闭按钮关闭窗口。
 */

import bus from '../core/event-bus.js';
import { createLogger } from '../core/logger.js';
import { windowManager } from '../core/window-manager.js';
import { getIcon } from '../ui/icons.js';

const log = createLogger('TaskbarPreview');

const HOVER_DELAY = 220;
const GRACE_PERIOD = 320;
const MAX_ITEMS = 8;

export class TaskbarPreview {
  constructor() {
    /** @type {HTMLElement|null} */
    this.el = null;
    /** @type {HTMLElement|null} 当前锚点（任务栏按钮） */
    this.anchor = null;
    /** @type {string|null} 当前展示的 appId */
    this.appId = null;
    this._openTimer = 0;
    this._closeTimer = 0;
    this._peeked = null;
    this._layer = document.body;
    this._disposers = [];
  }

  init(layer) {
    if (layer) this._layer = layer;
    this._disposers.push(
      bus.on('shell:close-popups', (p) => {
        if (p?.source !== 'taskbar-preview') this.hide(true);
      }),
      bus.on('window:closed', () => this._onWindowsChanged()),
      bus.on('window:state-changed', () => this._onWindowsChanged()),
      bus.on('window:title-changed', () => this._onWindowsChanged()),
    );
    window.addEventListener('blur', () => this.hide(true));
  }

  /**
   * 请求展示（带延迟）
   * @param {HTMLElement} anchor 任务栏按钮元素
   * @param {string} appId
   */
  requestShow(anchor, appId) {
    clearTimeout(this._closeTimer);
    // 已经在展示同一应用：仅取消关闭计时
    if (this.el && this.appId === appId) return;
    clearTimeout(this._openTimer);
    const delay = this.el ? 60 : HOVER_DELAY; // 已有浮层时快速切换
    this._openTimer = window.setTimeout(() => this.show(anchor, appId), delay);
  }

  /** 请求关闭（带宽限期） */
  requestHide() {
    clearTimeout(this._openTimer);
    clearTimeout(this._closeTimer);
    this._closeTimer = window.setTimeout(() => this.hide(), GRACE_PERIOD);
  }

  /** 取消待执行的关闭（鼠标移入浮层时调用） */
  cancelHide() {
    clearTimeout(this._closeTimer);
  }

  /**
   * 立即展示
   * @param {HTMLElement} anchor
   * @param {string} appId
   */
  show(anchor, appId) {
    const windows = windowManager.getByAppId(appId);
    if (!windows.length) {
      this.hide(true);
      return;
    }

    this.anchor = anchor;
    this.appId = appId;

    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'tb-preview';
      this.el.setAttribute('role', 'menu');
      this.el.addEventListener('pointerenter', () => this.cancelHide());
      this.el.addEventListener('pointerleave', () => this.requestHide());
      this._layer.appendChild(this.el);
    }

    this._renderItems(windows);
    this._position();
  }

  _onWindowsChanged() {
    if (!this.el || !this.appId) return;
    const windows = windowManager.getByAppId(this.appId);
    if (!windows.length) {
      this.hide(true);
      return;
    }
    this._renderItems(windows);
    this._position();
  }

  _renderItems(windows) {
    const list = windows.slice(0, MAX_ITEMS);
    this.el.innerHTML = '';

    for (const win of list) {
      const item = document.createElement('div');
      item.className = 'tb-preview-item';
      item.dataset.winId = win.id;
      item.setAttribute('role', 'menuitem');
      item.tabIndex = 0;

      const head = document.createElement('div');
      head.className = 'tpi-head';
      head.innerHTML = `
        <span class="tpi-icon">${this._iconMarkup(win.icon, 16)}</span>
        <span class="tpi-title">${escapeHtml(win.title)}</span>`;

      const close = document.createElement('button');
      close.className = 'tpi-close';
      close.type = 'button';
      close.title = '关闭窗口';
      close.setAttribute('aria-label', `关闭 ${win.title}`);
      close.innerHTML = getIcon('close', 12);
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        win.close();
      });
      head.appendChild(close);

      const body = document.createElement('div');
      body.className = 'tpi-body';
      const summary = this._summaryOf(win);
      if (summary) {
        body.textContent = summary;
      } else {
        body.classList.add('is-empty');
        body.textContent = win.state === 'minimized' ? '已最小化' : '无可用预览';
      }

      item.append(head, body);
      item.addEventListener('click', () => {
        this.hide(true);
        this._activate(win);
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.hide(true);
          this._activate(win);
        }
      });
      item.addEventListener('pointerenter', () => this._peek(win));
      item.addEventListener('pointerleave', () => this._unpeek());

      this.el.appendChild(item);
    }

    if (windows.length > MAX_ITEMS) {
      const more = document.createElement('div');
      more.className = 'tb-preview-item';
      more.style.cssText = 'width:120px;align-items:center;justify-content:center;font-size:12px;opacity:.7';
      more.textContent = `还有 ${windows.length - MAX_ITEMS} 个窗口`;
      this.el.appendChild(more);
    }
  }

  /** 调用应用注册的预览提供器，失败不影响浮层 */
  _summaryOf(win) {
    try {
      const provider = win.previewProvider;
      if (typeof provider !== 'function') return '';
      const text = provider();
      if (text == null) return '';
      return String(text).slice(0, 400);
    } catch (err) {
      log.warn(`应用 ${win.appId} 的预览提供器抛出异常`, err);
      return '';
    }
  }

  _iconMarkup(icon, size) {
    if (typeof icon === 'string' && icon.trim().startsWith('<svg')) return icon;
    if (typeof icon === 'string' && /^(https?:|data:|blob:|\.|\/)/.test(icon)) {
      return `<img src="${icon}" width="${size}" height="${size}" alt="" onerror="this.style.display='none'">`;
    }
    return getIcon(icon || 'fileGeneric', size);
  }

  _activate(win) {
    if (win.state === 'minimized') win.restore();
    else if (windowManager.activeWindow === win) win.minimize();
    else windowManager.focus(win);
  }

  /** 高亮对应窗口（Aero Peek 的轻量版） */
  _peek(win) {
    this._unpeek();
    if (!win.el || win.state === 'minimized') return;
    win.el.classList.add('is-peeked');
    this._peeked = win;
  }

  _unpeek() {
    if (this._peeked?.el) this._peeked.el.classList.remove('is-peeked');
    this._peeked = null;
  }

  /** 定位到锚点上方居中，并做视口边界收敛 */
  _position() {
    if (!this.el || !this.anchor) return;
    const a = this.anchor.getBoundingClientRect();
    const r = this.el.getBoundingClientRect();
    const margin = 8;
    let left = a.left + a.width / 2 - r.width / 2;
    left = Math.min(window.innerWidth - r.width - margin, Math.max(margin, left));
    const top = Math.max(margin, a.top - r.height - 8);
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  /**
   * 关闭浮层
   * @param {boolean} [immediate] 是否立即关闭（跳过宽限期）
   */
  hide(immediate = false) {
    clearTimeout(this._openTimer);
    if (immediate) clearTimeout(this._closeTimer);
    this._unpeek();
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.anchor = null;
    this.appId = null;
  }

  dispose() {
    this.hide(true);
    this._disposers.forEach((fn) => {
      try {
        fn();
      } catch { /* ignore */ }
    });
    this._disposers = [];
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const taskbarPreview = new TaskbarPreview();
export default taskbarPreview;
