/**
 * 桌面层
 *
 * 职责：
 * - 渲染桌面图标网格（应用快捷方式 + 桌面目录里的真实文件）
 * - 单击选中 / Ctrl 多选 / Shift 连选 / 空白处框选
 * - 双击启动（应用 → launchApp，文件 → openPath）
 * - 拖拽换位（吸附到网格单元），位置持久化到 localStorage
 * - 键盘方向键导航、F2 重命名、Delete 删除、Enter 打开
 * - 空白处与图标的右键菜单
 *
 * 图标位置模型：以「列,行」网格坐标存储（而非像素），窗口尺寸变化时布局仍然稳定。
 */

import bus from '../core/event-bus.js';
import { createLogger } from '../core/logger.js';
import { LocalStore, debounce } from '../core/storage.js';
import { settings } from '../core/settings-store.js';
import { fileSystem, SHELL_FOLDERS } from '../core/fs/fs-service.js';
import * as P from '../core/fs/path-utils.js';
import { appRegistry } from '../core/app-registry.js';
import { notifications } from '../core/notification.js';
import { contextMenu } from './context-menu.js';
import { getIcon, iconForExtension } from '../ui/icons.js';

const log = createLogger('Desktop');
const store = new LocalStore('desktop');

/** 网格单元尺寸档位（与 shell.css 中的 --icon-cell-* 保持一致） */
const CELL = {
  small: { w: 72, h: 78, glyph: 32 },
  medium: { w: 88, h: 96, glyph: 42 },
  large: { w: 108, h: 122, glyph: 56 },
};

/** 网格外边距 */
const PAD = 10;

/** 固定在桌面上的系统快捷方式（不来自文件系统） */
const SYSTEM_SHORTCUTS = [
  { key: 'shortcut:thisPc', kind: 'system', name: '此电脑', icon: 'thisPc', target: 'explorer', args: { path: 'C:/' } },
  { key: 'shortcut:recycleBin', kind: 'system', name: '回收站', icon: 'recycleBin', target: 'explorer', args: { path: SHELL_FOLDERS.temp } },
];

/** 默认出现在桌面上的应用快捷方式 */
const DEFAULT_APP_SHORTCUTS = ['explorer', 'browser', 'notepad', 'calculator', 'terminal', 'media-player', 'task-manager', 'settings'];

export class Desktop {
  constructor() {
    /** @type {HTMLElement|null} */
    this.root = null;
    /** @type {HTMLElement|null} */
    this.grid = null;
    /** @type {Array<Object>} 当前渲染的条目 */
    this.items = [];
    /** @type {Map<string, HTMLElement>} key → DOM */
    this.elements = new Map();
    /** @type {Set<string>} 选中项 key */
    this.selection = new Set();
    /** @type {Record<string, {col:number,row:number}>} key → 网格坐标 */
    this.positions = store.get('positions', {});
    /** 最后一次点击的项（用于 Shift 连选与方向键导航） */
    this.anchorKey = null;

    this._cols = 1;
    this._rows = 1;
    this._disposers = [];
    this._refreshing = false;
    this._pendingRefresh = false;

    this._persist = debounce(() => store.set('positions', this.positions), 400);
    this._onResize = debounce(() => this._measure(true), 150);
  }

  /**
   * @param {HTMLElement} layer 桌面层容器（#desktop-layer）
   */
  async init(layer) {
    this.root = layer;
    this.grid = document.createElement('div');
    this.grid.className = 'desktop-grid';
    this.grid.tabIndex = -1;
    layer.appendChild(this.grid);

    this._measure();
    this._bindEvents();
    await this.refresh();

    log.info('桌面已就绪');
  }

  /* ==========================================================
     布局测量
     ========================================================== */

  _cell() {
    return CELL[settings.get('desktop.iconSize')] || CELL.medium;
  }

  _measure(relayout = false) {
    const cell = this._cell();
    const w = this.root?.clientWidth || window.innerWidth;
    const h = this.root?.clientHeight || window.innerHeight;
    this._cols = Math.max(1, Math.floor((w - PAD * 2) / cell.w));
    this._rows = Math.max(1, Math.floor((h - PAD * 2) / cell.h));
    if (relayout) this._applyAllPositions();
  }

  /* ==========================================================
     数据加载
     ========================================================== */

  /** 重新枚举桌面条目并渲染（并发安全：进行中则排队一次） */
  async refresh() {
    if (this._refreshing) {
      this._pendingRefresh = true;
      return;
    }
    this._refreshing = true;
    try {
      this.items = await this._collectItems();
      this._render();
    } catch (err) {
      log.error('刷新桌面失败', err);
    } finally {
      this._refreshing = false;
      if (this._pendingRefresh) {
        this._pendingRefresh = false;
        this.refresh();
      }
    }
  }

  async _collectItems() {
    const items = [];

    for (const s of SYSTEM_SHORTCUTS) items.push({ ...s });

    // 应用快捷方式
    const hidden = new Set(store.get('hiddenShortcuts', []));
    const extra = store.get('extraShortcuts', []);
    const appIds = [...new Set([...DEFAULT_APP_SHORTCUTS, ...extra])];
    for (const appId of appIds) {
      if (hidden.has(appId)) continue;
      const app = appRegistry.get(appId);
      if (!app) continue;
      items.push({
        key: `app:${appId}`,
        kind: 'app',
        name: app.name,
        icon: app.icon,
        target: appId,
      });
    }

    // 桌面目录中的真实文件
    if (settings.get('desktop.showIcons')) {
      try {
        const entries = await fileSystem.readDir(SHELL_FOLDERS.desktop);
        for (const st of entries) {
          items.push({
            key: `path:${st.path}`,
            kind: st.type === 'directory' ? 'folder' : 'file',
            name: st.name,
            icon: st.type === 'directory' ? 'folder' : iconForExtension(st.ext),
            path: st.path,
            stat: st,
          });
        }
      } catch (err) {
        log.warn('读取桌面目录失败', err);
      }
    }

    this._sortItems(items);
    return items;
  }

  _sortItems(items) {
    const by = settings.get('desktop.sortBy');
    const rank = (it) => (it.kind === 'system' ? 0 : it.kind === 'app' ? 1 : it.kind === 'folder' ? 2 : 3);
    items.sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      if (by === 'date' && a.stat && b.stat) return b.stat.modified - a.stat.modified;
      if (by === 'type' && a.stat && b.stat) return (a.stat.ext || '').localeCompare(b.stat.ext || '') || a.name.localeCompare(b.name, 'zh');
      return a.name.localeCompare(b.name, 'zh');
    });
  }

  /* ==========================================================
     渲染
     ========================================================== */

  _render() {
    const frag = document.createDocumentFragment();
    const seen = new Set();
    const nextElements = new Map();

    for (const item of this.items) {
      seen.add(item.key);
      let el = this.elements.get(item.key);
      if (el) {
        this._updateIconEl(el, item);
      } else {
        el = this._createIconEl(item);
        frag.appendChild(el);
      }
      nextElements.set(item.key, el);
    }

    // 移除消失的条目
    for (const [key, el] of this.elements) {
      if (!seen.has(key)) {
        el.remove();
        this.selection.delete(key);
      }
    }

    this.elements = nextElements;
    if (frag.childNodes.length) this.grid.appendChild(frag);

    this._assignPositions();
    this._applyAllPositions();
    this._syncSelectionClasses();
  }

  _createIconEl(item) {
    const el = document.createElement('div');
    el.className = 'desktop-icon';
    el.dataset.key = item.key;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    this._updateIconEl(el, item);
    return el;
  }

  _updateIconEl(el, item) {
    const size = this._cell().glyph;
    el.dataset.kind = item.kind;
    el.title = item.path || item.name;
    el.setAttribute('aria-label', item.name);
    el.innerHTML = `<span class="di-glyph">${this._iconMarkup(item.icon, size)}</span><span class="di-label">${escapeHtml(item.name)}</span>`;
  }

  _iconMarkup(icon, size) {
    if (typeof icon === 'string' && icon.trim().startsWith('<svg')) return icon;
    if (typeof icon === 'string' && /^(https?:|data:|blob:|\.|\/)/.test(icon)) {
      return `<img src="${icon}" width="${size}" height="${size}" alt="" onerror="this.style.display='none'">`;
    }
    return getIcon(icon || 'fileGeneric', size);
  }

  /* ==========================================================
     位置分配
     ========================================================== */

  /** 为尚无坐标的条目按列优先顺序分配空位 */
  _assignPositions() {
    const occupied = new Set();
    const valid = new Set(this.items.map((i) => i.key));

    // 清理已消失条目的坐标记录
    for (const key of Object.keys(this.positions)) {
      if (!valid.has(key)) delete this.positions[key];
    }

    for (const item of this.items) {
      const pos = this.positions[item.key];
      if (pos && pos.col < this._cols && pos.row < this._rows) {
        const id = `${pos.col},${pos.row}`;
        if (!occupied.has(id)) {
          occupied.add(id);
          continue;
        }
      }
      delete this.positions[item.key];
    }

    for (const item of this.items) {
      if (this.positions[item.key]) continue;
      const slot = this._firstFreeSlot(occupied);
      this.positions[item.key] = slot;
      occupied.add(`${slot.col},${slot.row}`);
    }
    this._persist();
  }

  _firstFreeSlot(occupied) {
    for (let col = 0; col < this._cols; col++) {
      for (let row = 0; row < this._rows; row++) {
        if (!occupied.has(`${col},${row}`)) return { col, row };
      }
    }
    // 网格已满：堆到最后一列末尾
    return { col: this._cols - 1, row: this._rows - 1 };
  }

  _applyAllPositions() {
    const cell = this._cell();
    for (const [key, el] of this.elements) {
      const pos = this.positions[key];
      if (!pos) continue;
      el.style.transform = `translate(${PAD + pos.col * cell.w}px, ${PAD + pos.row * cell.h}px)`;
    }
  }

  /** 把像素坐标换算为最近的网格槽位 */
  _slotFromPoint(px, py) {
    const cell = this._cell();
    const col = clamp(Math.round((px - PAD) / cell.w), 0, this._cols - 1);
    const row = clamp(Math.round((py - PAD) / cell.h), 0, this._rows - 1);
    return { col, row };
  }

  /* ==========================================================
     选择
     ========================================================== */

  _select(key, { additive = false, range = false } = {}) {
    if (range && this.anchorKey) {
      const order = this.items.map((i) => i.key);
      const a = order.indexOf(this.anchorKey);
      const b = order.indexOf(key);
      if (a >= 0 && b >= 0) {
        if (!additive) this.selection.clear();
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.selection.add(order[i]);
        this._syncSelectionClasses();
        return;
      }
    }
    if (additive) {
      if (this.selection.has(key)) this.selection.delete(key);
      else this.selection.add(key);
    } else {
      this.selection.clear();
      this.selection.add(key);
    }
    this.anchorKey = key;
    this._syncSelectionClasses();
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this._syncSelectionClasses();
  }

  _syncSelectionClasses() {
    for (const [key, el] of this.elements) {
      el.classList.toggle('is-selected', this.selection.has(key));
    }
  }

  _itemByKey(key) {
    return this.items.find((i) => i.key === key) || null;
  }

  _selectedItems() {
    return [...this.selection].map((k) => this._itemByKey(k)).filter(Boolean);
  }

  /* ==========================================================
     事件绑定
     ========================================================== */

  _bindEvents() {
    const grid = this.grid;

    grid.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    grid.addEventListener('dblclick', (e) => {
      const el = e.target.closest?.('.desktop-icon');
      if (el) this._open(this._itemByKey(el.dataset.key));
    });
    grid.addEventListener('contextmenu', (e) => this._onContextMenu(e));
    grid.addEventListener('keydown', (e) => this._onKeyDown(e), true);

    // 文件拖放到桌面
    grid.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    grid.addEventListener('drop', (e) => this._onDropFiles(e));

    window.addEventListener('resize', this._onResize);

    // 文件系统 / 设置 / 应用注册变化时刷新
    this._disposers.push(
      bus.on('fs:changed', (payload) => {
        const p = payload?.path || '';
        if (!p || P.isSubPath(SHELL_FOLDERS.desktop, p) || p === SHELL_FOLDERS.desktop) this.refresh();
      }),
      bus.on('app:registered', () => this.refresh()),
      settings.subscribe('desktop.iconSize', () => {
        this._measure(true);
        this._render();
      }),
      settings.subscribe('desktop.showIcons', () => this.refresh()),
      settings.subscribe('desktop.sortBy', () => this.refresh()),
      bus.on('shell:close-popups', () => {}),
    );
  }

  _onPointerDown(e) {
    if (e.button === 2) return; // 右键交给 contextmenu
    const el = e.target.closest?.('.desktop-icon');

    if (!el) {
      if (!e.ctrlKey && !e.shiftKey) this.clearSelection();
      bus.emit('shell:close-popups', { source: 'desktop' });
      this._startMarquee(e);
      return;
    }

    const key = el.dataset.key;
    if (!this.selection.has(key) || e.ctrlKey || e.shiftKey) {
      this._select(key, { additive: e.ctrlKey, range: e.shiftKey });
    } else {
      this.anchorKey = key;
    }
    el.focus({ preventScroll: true });
    bus.emit('shell:close-popups', { source: 'desktop' });

    if (e.button === 0) this._startDrag(e, el);
  }

  /* ---------------- 拖拽换位 ---------------- */

  _startDrag(e, el) {
    const cell = this._cell();
    const startX = e.clientX;
    const startY = e.clientY;
    const keys = this.selection.has(el.dataset.key) ? [...this.selection] : [el.dataset.key];
    const origin = new Map(keys.map((k) => [k, { ...this.positions[k] }]));
    let moved = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        moved = true;
        keys.forEach((k) => this.elements.get(k)?.classList.add('is-dragging'));
      }
      for (const k of keys) {
        const o = origin.get(k);
        const elm = this.elements.get(k);
        if (!o || !elm) continue;
        elm.style.transform = `translate(${PAD + o.col * cell.w + dx}px, ${PAD + o.row * cell.h + dy}px)`;
      }
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      keys.forEach((k) => this.elements.get(k)?.classList.remove('is-dragging'));
      if (!moved) return;

      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const occupied = new Set(
        Object.entries(this.positions)
          .filter(([k]) => !keys.includes(k))
          .map(([, p]) => `${p.col},${p.row}`),
      );

      for (const k of keys) {
        const o = origin.get(k);
        if (!o) continue;
        let slot = this._slotFromPoint(PAD + o.col * cell.w + dx + cell.w / 2, PAD + o.row * cell.h + dy + cell.h / 2);
        if (occupied.has(`${slot.col},${slot.row}`)) slot = this._firstFreeSlot(occupied);
        this.positions[k] = slot;
        occupied.add(`${slot.col},${slot.row}`);
      }
      this._applyAllPositions();
      this._persist();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  /* ---------------- 框选 ---------------- */

  _startMarquee(e) {
    const rect = this.grid.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const box = document.createElement('div');
    box.className = 'selection-box';
    let active = false;
    const base = new Set(e.ctrlKey ? this.selection : []);

    const onMove = (ev) => {
      const cx = ev.clientX - rect.left;
      const cy = ev.clientY - rect.top;
      if (!active) {
        if (Math.hypot(cx - ox, cy - oy) < 5) return;
        active = true;
        this.grid.appendChild(box);
      }
      const x = Math.min(ox, cx);
      const y = Math.min(oy, cy);
      const w = Math.abs(cx - ox);
      const h = Math.abs(cy - oy);
      box.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

      this.selection = new Set(base);
      for (const [key, el] of this.elements) {
        const r = el.getBoundingClientRect();
        const ex = r.left - rect.left;
        const ey = r.top - rect.top;
        if (ex < x + w && ex + r.width > x && ey < y + h && ey + r.height > y) this.selection.add(key);
      }
      this._syncSelectionClasses();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      box.remove();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  /* ==========================================================
     打开 / 操作
     ========================================================== */

  async _open(item) {
    if (!item) return;
    try {
      if (item.kind === 'app') {
        await window.WinNext?.launchApp(item.target);
      } else if (item.kind === 'system') {
        await window.WinNext?.launchApp(item.target, item.args);
      } else if (item.kind === 'folder') {
        await window.WinNext?.launchApp('explorer', { path: item.path });
      } else {
        await window.WinNext?.openPath(item.path);
      }
    } catch (err) {
      log.error('打开条目失败', err);
      notifications.toast({ title: '无法打开', body: String(err?.message || err), type: 'error' });
    }
  }

  async _onDropFiles(e) {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    let ok = 0;
    for (const file of files) {
      try {
        const target = P.join(SHELL_FOLDERS.desktop, file.name);
        await fileSystem.writeFile(target, await file.arrayBuffer());
        ok++;
      } catch (err) {
        log.warn(`保存 ${file.name} 失败`, err);
      }
    }
    if (ok) notifications.toast({ title: '已复制到桌面', body: `${ok} 个文件`, type: 'success' });
    this.refresh();
  }

  /* ==========================================================
     键盘
     ========================================================== */

  _onKeyDown(e) {
    const keys = this.items.map((i) => i.key);
    if (!keys.length) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      this._selectedItems().forEach((it) => this._open(it));
      return;
    }
    if (e.key === 'F2') {
      e.preventDefault();
      const [first] = this._selectedItems();
      if (first) this._beginRename(first);
      return;
    }
    if (e.key === 'Delete') {
      e.preventDefault();
      this._deleteSelected();
      return;
    }
    if (e.key === 'a' && e.ctrlKey) {
      e.preventDefault();
      this.selection = new Set(keys);
      this._syncSelectionClasses();
      return;
    }

    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();

    const cur = this.anchorKey ? this.positions[this.anchorKey] : null;
    let best = null;
    let bestScore = Infinity;
    for (const key of keys) {
      const p = this.positions[key];
      if (!p || key === this.anchorKey) continue;
      if (!cur) {
        best = key;
        break;
      }
      const dc = p.col - cur.col;
      const dr = p.row - cur.row;
      // 只考虑目标方向上的条目
      if (d[0] !== 0 ? Math.sign(dc) !== d[0] : Math.sign(dr) !== d[1]) continue;
      const score = Math.abs(dc) * (d[0] !== 0 ? 1 : 4) + Math.abs(dr) * (d[1] !== 0 ? 1 : 4);
      if (score < bestScore) {
        bestScore = score;
        best = key;
      }
    }
    if (best) {
      this._select(best, { additive: false });
      this.elements.get(best)?.focus({ preventScroll: true });
    }
  }

  /* ==========================================================
     重命名 / 删除
     ========================================================== */

  _beginRename(item) {
    if (item.kind !== 'file' && item.kind !== 'folder') {
      notifications.toast({ title: '无法重命名', body: '系统快捷方式不支持重命名', type: 'warning' });
      return;
    }
    const el = this.elements.get(item.key);
    const label = el?.querySelector('.di-label');
    if (!label) return;

    const input = document.createElement('input');
    input.className = 'di-label-input';
    input.value = item.name;
    label.replaceWith(input);
    input.focus();
    const dot = item.name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : item.name.length);

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      input.replaceWith(label);
      if (!commit || !next || next === item.name) return;
      const err = P.validateName(next);
      if (err) {
        notifications.toast({ title: '名称无效', body: err, type: 'error' });
        return;
      }
      try {
        await fileSystem.rename(item.path, P.join(P.dirname(item.path), next));
      } catch (e2) {
        notifications.toast({ title: '重命名失败', body: String(e2?.message || e2), type: 'error' });
      }
      this.refresh();
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
  }

  async _deleteSelected() {
    const targets = this._selectedItems().filter((i) => i.kind === 'file' || i.kind === 'folder');
    if (!targets.length) return;
    const ok = await notifications.confirm({
      title: '删除',
      body: targets.length === 1 ? `确定要删除「${targets[0].name}」吗？` : `确定要删除这 ${targets.length} 个项目吗？`,
      okText: '删除',
      danger: true,
    });
    if (!ok) return;
    for (const t of targets) {
      try {
        await fileSystem.remove(t.path, true);
      } catch (err) {
        notifications.toast({ title: '删除失败', body: `${t.name}：${err?.message || err}`, type: 'error' });
      }
    }
    this.clearSelection();
    this.refresh();
  }

  /* ==========================================================
     右键菜单
     ========================================================== */

  _onContextMenu(e) {
    e.preventDefault();
    const el = e.target.closest?.('.desktop-icon');
    if (el) {
      const key = el.dataset.key;
      if (!this.selection.has(key)) this._select(key);
      contextMenu.open(this._iconMenu(), e.clientX, e.clientY);
    } else {
      this.clearSelection();
      contextMenu.open(this._blankMenu(e), e.clientX, e.clientY);
    }
  }

  _iconMenu() {
    const items = this._selectedItems();
    const single = items.length === 1 ? items[0] : null;
    const isFsItem = items.every((i) => i.kind === 'file' || i.kind === 'folder');

    return [
      { id: 'open', label: '打开', icon: 'folderOpenSm', onClick: () => items.forEach((i) => this._open(i)) },
      single?.kind === 'app' && {
        id: 'pin',
        label: '固定到任务栏',
        icon: 'pin',
        onClick: () => this._pinToTaskbar(single.target),
      },
      { separator: true },
      isFsItem && { id: 'copy', label: '复制', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => this._copySelection() },
      isFsItem && {
        id: 'rename',
        label: '重命名',
        icon: 'rename',
        shortcut: 'F2',
        disabled: !single,
        onClick: () => single && this._beginRename(single),
      },
      isFsItem && { id: 'delete', label: '删除', icon: 'delete', shortcut: 'Del', onClick: () => this._deleteSelected() },
      isFsItem && { separator: true },
      {
        id: 'props',
        label: '属性',
        icon: 'info',
        disabled: !single,
        onClick: () => single && this._showProperties(single),
      },
    ].filter(Boolean);
  }

  _blankMenu(e) {
    const iconSize = settings.get('desktop.iconSize');
    const sortBy = settings.get('desktop.sortBy');
    return [
      {
        id: 'view',
        label: '查看',
        icon: 'grid',
        children: [
          ...['large', 'medium', 'small'].map((s) => ({
            id: `size-${s}`,
            label: { large: '大图标', medium: '中等图标', small: '小图标' }[s],
            checked: iconSize === s,
            onClick: () => settings.set('desktop.iconSize', s),
          })),
          { separator: true },
          {
            id: 'show-icons',
            label: '显示桌面图标',
            checked: settings.get('desktop.showIcons'),
            onClick: () => settings.set('desktop.showIcons', !settings.get('desktop.showIcons')),
          },
        ],
      },
      {
        id: 'sort',
        label: '排序方式',
        icon: 'sort',
        children: [
          { id: 'sort-name', label: '名称', checked: sortBy === 'name', onClick: () => this._sortAndReflow('name') },
          { id: 'sort-type', label: '类型', checked: sortBy === 'type', onClick: () => this._sortAndReflow('type') },
          { id: 'sort-date', label: '修改日期', checked: sortBy === 'date', onClick: () => this._sortAndReflow('date') },
        ],
      },
      { id: 'refresh', label: '刷新', icon: 'refresh', shortcut: 'F5', onClick: () => this.refresh() },
      { separator: true },
      {
        id: 'new',
        label: '新建',
        icon: 'add',
        children: [
          { id: 'new-folder', label: '文件夹', icon: 'folder', onClick: () => this._createNew('folder') },
          { separator: true },
          { id: 'new-txt', label: '文本文档', icon: 'fileText', onClick: () => this._createNew('file', 'txt') },
          { id: 'new-md', label: 'Markdown 文档', icon: 'fileText', onClick: () => this._createNew('file', 'md') },
          { id: 'new-html', label: 'HTML 文件', icon: 'fileCode', onClick: () => this._createNew('file', 'html') },
        ],
      },
      { separator: true },
      { id: 'paste', label: '粘贴', icon: 'paste', disabled: !this._clipboard, onClick: () => this._pasteHere() },
      { separator: true },
      {
        id: 'terminal',
        label: '在此处打开终端',
        icon: 'terminal',
        onClick: () => window.WinNext?.launchApp('terminal', { cwd: SHELL_FOLDERS.desktop }),
      },
      {
        id: 'personalize',
        label: '个性化',
        icon: 'palette',
        onClick: () => window.WinNext?.launchApp('settings', { section: 'personalization' }),
      },
    ];
  }

  _sortAndReflow(by) {
    settings.set('desktop.sortBy', by);
    // 重排：清空坐标让分配器按新顺序重新填格
    this.positions = {};
    this.refresh();
  }

  async _createNew(kind, ext = '') {
    try {
      const dir = SHELL_FOLDERS.desktop;
      const existing = (await fileSystem.readDir(dir)).map((s) => s.name);
      const base = kind === 'folder' ? '新建文件夹' : `新建 ${ext.toUpperCase()} 文档.${ext}`;
      const name = P.uniqueName(base, existing);
      const target = P.join(dir, name);
      if (kind === 'folder') await fileSystem.mkdir(target);
      else await fileSystem.writeFile(target, '');
      await this.refresh();
      const item = this._itemByKey(`path:${target}`);
      if (item) {
        this._select(item.key);
        this._beginRename(item);
      }
    } catch (err) {
      notifications.toast({ title: '新建失败', body: String(err?.message || err), type: 'error' });
    }
  }

  _copySelection() {
    const paths = this._selectedItems()
      .filter((i) => i.path)
      .map((i) => i.path);
    if (!paths.length) return;
    this._clipboard = { mode: 'copy', paths };
    notifications.toast({ title: '已复制', body: `${paths.length} 个项目`, type: 'info', duration: 1800 });
  }

  async _pasteHere() {
    if (!this._clipboard) return;
    for (const src of this._clipboard.paths) {
      try {
        const existing = (await fileSystem.readDir(SHELL_FOLDERS.desktop)).map((s) => s.name);
        const name = P.uniqueName(P.basename(src), existing);
        await fileSystem.copy(src, P.join(SHELL_FOLDERS.desktop, name));
      } catch (err) {
        notifications.toast({ title: '粘贴失败', body: String(err?.message || err), type: 'error' });
      }
    }
    this.refresh();
  }

  _pinToTaskbar(appId) {
    const pinned = [...settings.get('taskbar.pinned')];
    if (!pinned.includes(appId)) {
      pinned.push(appId);
      settings.set('taskbar.pinned', pinned);
    }
  }

  async _showProperties(item) {
    if (!item.path) {
      await notifications.alert({ title: item.name, body: `类型：${item.kind === 'app' ? '应用程序' : '系统项目'}` });
      return;
    }
    try {
      const st = await fileSystem.stat(item.path);
      await notifications.alert({
        title: `${st.name} 属性`,
        body: [
          `类型：${st.type === 'directory' ? '文件夹' : `${(st.ext || '文件').toUpperCase()} 文件`}`,
          `位置：${P.dirname(st.path)}`,
          `大小：${P.formatSize(st.size)}`,
          `修改时间：${P.formatDate(st.modified)}`,
        ].join('\n'),
      });
    } catch (err) {
      notifications.toast({ title: '无法读取属性', body: String(err?.message || err), type: 'error' });
    }
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this._disposers.forEach((fn) => {
      try {
        fn();
      } catch { /* ignore */ }
    });
    this._disposers = [];
    this.grid?.remove();
  }
}

/* ==========================================================
   工具
   ========================================================== */

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const desktop = new Desktop();
export default desktop;
