/**
 * 通用右键菜单
 *
 * 全局单例：同一时刻只存在一个菜单栈，复用 DOM 结构。
 * 支持多级子菜单、图标、快捷键提示、分隔线、勾选态、边界翻转、键盘导航。
 */

import { getIcon } from '../ui/icons.js';
import bus from '../core/event-bus.js';

/**
 * @typedef {Object} MenuItem
 * @property {string} [label]
 * @property {string} [icon]
 * @property {string} [shortcut]
 * @property {boolean} [disabled]
 * @property {boolean} [checked]
 * @property {boolean} [separator]
 * @property {string} [header]        分组标题
 * @property {MenuItem[]} [children]  子菜单
 * @property {() => void} [onClick]
 */

class ContextMenuManager {
  constructor() {
    /** @type {HTMLElement|null} */
    this.layer = null;
    /** @type {HTMLElement[]} 当前打开的菜单层级栈 */
    this.stack = [];
    this._boundGlobal = false;
    this._submenuTimer = null;
  }

  /** @param {HTMLElement} layer */
  init(layer) {
    this.layer = layer;
    if (this._boundGlobal) return;
    this._boundGlobal = true;

    // 点击外部关闭
    document.addEventListener('pointerdown', (e) => {
      if (!this.stack.length) return;
      if (this.stack.some((m) => m.contains(e.target))) return;
      this.close();
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!this.stack.length) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this._closeTop();
      } else if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter'].includes(e.key)) {
        e.preventDefault();
        this._handleKeyNav(e.key);
      }
    }, true);

    window.addEventListener('blur', () => this.close());
    window.addEventListener('resize', () => this.close());
    bus.on('shell:close-popups', () => this.close());
  }

  /**
   * 打开菜单
   * @param {MenuItem[]} items
   * @param {number} x 视口坐标
   * @param {number} y
   * @param {{align?:'start'|'end', anchorRect?:DOMRect}} [opts]
   */
  open(items, x, y, opts = {}) {
    this.close();
    const list = (items || []).filter(Boolean);
    if (!list.length) return;
    const menu = this._buildMenu(list, 0);
    this.layer.appendChild(menu);
    this._position(menu, x, y, opts);
    this.stack.push(menu);
    bus.emit('contextmenu:opened', {});
  }

  /**
   * 相对某元素打开（用于下拉菜单 / 跳转列表）
   * @param {MenuItem[]} items
   * @param {HTMLElement} anchor
   * @param {{placement?:'bottom'|'top'}} [opts]
   */
  openAt(items, anchor, opts = {}) {
    const r = anchor.getBoundingClientRect();
    const placement = opts.placement || 'bottom';
    this.close();
    const list = (items || []).filter(Boolean);
    if (!list.length) return;
    const menu = this._buildMenu(list, 0);
    this.layer.appendChild(menu);

    const mr = menu.getBoundingClientRect();
    let x = r.left;
    let y = placement === 'top' ? r.top - mr.height - 6 : r.bottom + 6;
    if (x + mr.width > window.innerWidth - 8) x = window.innerWidth - mr.width - 8;
    if (y < 8) y = r.bottom + 6;
    if (y + mr.height > window.innerHeight - 8) y = Math.max(8, r.top - mr.height - 6);
    menu.style.left = `${Math.max(8, Math.round(x))}px`;
    menu.style.top = `${Math.round(y)}px`;

    this.stack.push(menu);
  }

  /** 关闭全部层级 */
  close() {
    clearTimeout(this._submenuTimer);
    while (this.stack.length) {
      this.stack.pop().remove();
    }
    bus.emit('contextmenu:closed', {});
  }

  /** 是否有菜单处于打开状态 */
  get isOpen() {
    return this.stack.length > 0;
  }

  _closeTop() {
    if (this.stack.length <= 1) {
      this.close();
      return;
    }
    this.stack.pop().remove();
  }

  /* ==========================================================
     构建
     ========================================================== */

  /**
   * @param {MenuItem[]} items
   * @param {number} depth
   * @returns {HTMLElement}
   */
  _buildMenu(items, depth) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.dataset.depth = String(depth);
    menu.setAttribute('role', 'menu');

    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'ctx-separator';
        menu.appendChild(sep);
        continue;
      }
      if (item.header) {
        const h = document.createElement('div');
        h.className = 'ctx-header';
        h.textContent = item.header;
        menu.appendChild(h);
        continue;
      }

      const btn = document.createElement('button');
      btn.className = 'ctx-item';
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      if (item.disabled) btn.disabled = true;
      if (item.checked) btn.classList.add('is-checked');

      const iconName = item.checked ? 'check' : item.icon;
      btn.innerHTML = `
        <span class="ctx-icon">${iconName ? getIcon(iconName, 15) : ''}</span>
        <span class="ctx-label"></span>
        ${item.children?.length
          ? `<span class="ctx-arrow">${getIcon('chevronRight', 13)}</span>`
          : item.shortcut ? `<span class="ctx-shortcut"></span>` : ''}
      `;
      btn.querySelector('.ctx-label').textContent = item.label || '';
      if (item.shortcut && !item.children?.length) {
        btn.querySelector('.ctx-shortcut').textContent = item.shortcut;
      }

      if (item.children?.length) {
        btn.dataset.hasSubmenu = 'true';
        const openSub = () => this._openSubmenu(btn, item.children, depth + 1);
        btn.addEventListener('pointerenter', () => {
          clearTimeout(this._submenuTimer);
          this._submenuTimer = setTimeout(openSub, 160);
        });
        btn.addEventListener('pointerleave', () => clearTimeout(this._submenuTimer));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          clearTimeout(this._submenuTimer);
          openSub();
        });
      } else {
        btn.addEventListener('pointerenter', () => {
          clearTimeout(this._submenuTimer);
          // 移到无子菜单项时收起已展开的子菜单
          this._submenuTimer = setTimeout(() => {
            while (this.stack.length > depth + 1) this.stack.pop().remove();
          }, 160);
        });
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (item.disabled) return;
          this.close();
          try {
            item.onClick?.();
          } catch (err) {
            console.error('[ContextMenu] 菜单项回调异常', err);
          }
        });
      }

      menu.appendChild(btn);
    }

    return menu;
  }

  /**
   * @param {HTMLElement} anchorBtn
   * @param {MenuItem[]} children
   * @param {number} depth
   */
  _openSubmenu(anchorBtn, children, depth) {
    // 关掉同级或更深的已有子菜单
    while (this.stack.length > depth) this.stack.pop().remove();

    const sub = this._buildMenu(children, depth);
    this.layer.appendChild(sub);

    const ar = anchorBtn.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    let x = ar.right - 2;
    let y = ar.top - 5;
    if (x + sr.width > window.innerWidth - 8) x = ar.left - sr.width + 2;
    if (y + sr.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - sr.height - 8);
    sub.style.left = `${Math.max(8, Math.round(x))}px`;
    sub.style.top = `${Math.round(y)}px`;

    this.stack.push(sub);
  }

  /**
   * 视口边界翻转定位
   * @param {HTMLElement} menu
   */
  _position(menu, x, y, opts) {
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;

    if (left + r.width > vw - 8) left = Math.max(8, x - r.width);
    if (top + r.height > vh - 8) top = Math.max(8, y - r.height);
    if (top < 8) top = 8;
    // 菜单高于视口时限制高度并允许滚动
    if (r.height > vh - 16) {
      menu.style.maxHeight = `${vh - 16}px`;
      menu.style.overflowY = 'auto';
      top = 8;
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  /* ==========================================================
     键盘导航
     ========================================================== */

  _handleKeyNav(key) {
    const menu = this.stack[this.stack.length - 1];
    if (!menu) return;
    const items = [...menu.querySelectorAll('.ctx-item:not([disabled])')];
    if (!items.length) return;

    const cur = items.findIndex((el) => el.classList.contains('is-highlighted'));

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const next = key === 'ArrowDown'
        ? (cur + 1) % items.length
        : (cur - 1 + items.length) % items.length;
      items.forEach((el) => el.classList.remove('is-highlighted'));
      items[next].classList.add('is-highlighted');
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }

    if (key === 'ArrowRight') {
      if (cur >= 0 && items[cur].dataset.hasSubmenu) items[cur].click();
      return;
    }

    if (key === 'ArrowLeft') {
      this._closeTop();
      return;
    }

    if (key === 'Enter' && cur >= 0) {
      items[cur].click();
    }
  }
}

export const contextMenu = new ContextMenuManager();
export default contextMenu;
