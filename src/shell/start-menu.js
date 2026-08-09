/**
 * 开始菜单（Win11 布局）
 *
 * 结构：搜索框 / 「已固定」应用宫格 / 「推荐的项目」最近文件 / 底部用户区 + 电源。
 *
 * 行为：
 * - 输入搜索时切换为「结果列表」模式，同时匹配应用名与最近文件名（模糊子串 + 首字母）。
 * - 点击外部、Esc、启动应用后自动关闭；关闭走出场动画再移除 DOM。
 * - 键盘：↑↓ 在结果间移动，Enter 打开，Esc 关闭。
 * - Aero 规则二由 CSS `body[data-has-maximized]` 驱动，本模块不涉及毛玻璃逻辑。
 */

import bus from '../core/event-bus.js';
import { createLogger } from '../core/logger.js';
import { LocalStore } from '../core/storage.js';
import { settings } from '../core/settings-store.js';
import { appRegistry } from '../core/app-registry.js';
import { fileSystem, SHELL_FOLDERS } from '../core/fs/fs-service.js';
import * as P from '../core/fs/path-utils.js';
import { notifications } from '../core/notification.js';
import { contextMenu } from './context-menu.js';
import { windowManager } from '../core/window-manager.js';
import { getIcon, iconForExtension } from '../ui/icons.js';

const log = createLogger('StartMenu');
const store = new LocalStore('startmenu');

const MAX_RECENT = 6;
const RECENT_DIRS = [SHELL_FOLDERS.desktop, SHELL_FOLDERS.documents, SHELL_FOLDERS.downloads];

export class StartMenu {
  constructor() {
    /** @type {HTMLElement|null} */
    this.el = null;
    /** @type {HTMLElement|null} */
    this.layer = null;
    this.isOpen = false;
    /** @type {Array<{name:string,path:string,ext:string,modified:number}>} */
    this.recent = [];
    this._query = '';
    this._highlight = -1;
    /** @type {Array<{kind:string,label:string,run:Function,icon:any,meta?:string}>} */
    this._results = [];
    this._disposers = [];
    this._closeTimer = 0;
  }

  /** @param {HTMLElement} layer #overlay-layer 或 #shell-layer */
  init(layer) {
    this.layer = layer || document.body;

    this._disposers.push(
      bus.on('startmenu:toggle', () => this.toggle()),
      bus.on('startmenu:open', () => this.open()),
      bus.on('startmenu:close', () => this.close()),
      bus.on('shell:close-popups', (p) => {
        if (p?.source !== 'startmenu') this.close();
      }),
      bus.on('app:registered', () => this.isOpen && this._renderBody()),
      settings.subscribe('taskbar.pinned', () => this.isOpen && this._renderBody()),
    );

    // Win 键 / Ctrl+Esc 开关开始菜单
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Meta' && !e.repeat && !e.ctrlKey && !e.altKey) {
          // 仅在 keyup 时触发，避免与 Win+方向键的 Snap 冲突
          this._metaCandidate = true;
          return;
        }
        if (e.key === 'Escape' && this.isOpen) {
          e.preventDefault();
          this.close();
        }
        this._metaCandidate = false;
      },
      true,
    );
    document.addEventListener(
      'keyup',
      (e) => {
        if (e.key === 'Meta' && this._metaCandidate) {
          this._metaCandidate = false;
          this.toggle();
        }
      },
      true,
    );

    log.info('开始菜单已就绪');
  }

  /* ==========================================================
     开关
     ========================================================== */

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  async open() {
    if (this.isOpen) return;
    clearTimeout(this._closeTimer);
    bus.emit('shell:close-popups', { source: 'startmenu' });

    this._query = '';
    this._highlight = -1;
    this.isOpen = true;

    this.el = document.createElement('div');
    this.el.className = 'start-menu is-opening';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', '开始菜单');
    this.el.innerHTML = `
      <div class="sm-search">
        <div class="sm-search-box">
          ${getIcon('search', 16)}
          <input type="text" placeholder="搜索应用和文件" aria-label="搜索" spellcheck="false" autocomplete="off">
        </div>
      </div>
      <div class="sm-content"></div>
      <div class="sm-footer">
        <button class="sm-user" type="button">
          <span class="sm-avatar">U</span><span>User</span>
        </button>
        <button class="sm-power" type="button" title="电源" aria-label="电源">${getIcon('power', 18)}</button>
      </div>`;

    this.layer.appendChild(this.el);
    this.el.addEventListener('animationend', () => this.el?.classList.remove('is-opening'), { once: true });

    this._bindMenuEvents();
    this._renderBody();

    // 先展示骨架，最近文件异步补齐，避免开菜单卡顿
    this._loadRecent().then(() => {
      if (this.isOpen && !this._query) this._renderBody();
    });

    requestAnimationFrame(() => this.el?.querySelector('input')?.focus());
    bus.emit('startmenu:opened');
  }

  close() {
    if (!this.isOpen || !this.el) return;
    this.isOpen = false;
    const el = this.el;
    this.el = null;
    el.classList.remove('is-opening');
    el.classList.add('is-closing');
    this._closeTimer = window.setTimeout(() => el.remove(), 180);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    bus.emit('startmenu:closed');
  }

  /* ==========================================================
     数据
     ========================================================== */

  async _loadRecent() {
    const collected = [];
    for (const dir of RECENT_DIRS) {
      try {
        const entries = await fileSystem.readDir(dir);
        for (const st of entries) {
          if (st.type === 'directory') continue;
          collected.push({ name: st.name, path: st.path, ext: st.ext || '', modified: st.modified || 0 });
        }
      } catch {
        /* 目录不存在时静默跳过 */
      }
    }
    collected.sort((a, b) => b.modified - a.modified);
    this.recent = collected.slice(0, MAX_RECENT);
    return this.recent;
  }

  _pinnedApps() {
    const pinned = settings.get('taskbar.pinned') || [];
    const all = appRegistry.getAll();
    const order = new Map(pinned.map((id, i) => [id, i]));
    return all.slice().sort((a, b) => {
      const ra = order.has(a.id) ? order.get(a.id) : 999;
      const rb = order.has(b.id) ? order.get(b.id) : 999;
      return ra - rb || a.name.localeCompare(b.name, 'zh');
    });
  }

  /* ==========================================================
     渲染
     ========================================================== */

  _renderBody() {
    const content = this.el?.querySelector('.sm-content');
    if (!content) return;
    content.innerHTML = '';
    this._results = [];

    if (this._query) this._renderSearch(content);
    else this._renderHome(content);
  }

  _renderHome(content) {
    const apps = this._pinnedApps();

    content.appendChild(
      sectionHead('已固定', {
        label: '所有应用 ›',
        onClick: () => notifications.toast({ title: '所有应用', body: `已注册 ${apps.length} 个应用`, type: 'info' }),
      }),
    );

    const grid = document.createElement('div');
    grid.className = 'sm-app-grid';
    for (const app of apps) {
      grid.appendChild(this._appTile(app));
    }
    if (!apps.length) grid.appendChild(emptyState('暂无已固定的应用'));
    content.appendChild(grid);

    content.appendChild(
      sectionHead('推荐的项目', {
        label: '更多 ›',
        onClick: () => this._launch('explorer', { path: SHELL_FOLDERS.documents }),
      }),
    );

    const list = document.createElement('div');
    list.className = 'sm-recent-list';
    if (!this.recent.length) {
      list.appendChild(emptyState('暂无最近使用的文件'));
    } else {
      for (const f of this.recent) list.appendChild(this._recentTile(f));
    }
    content.appendChild(list);
  }

  _appTile(app) {
    const btn = document.createElement('button');
    btn.className = 'sm-app';
    btn.type = 'button';
    btn.title = app.description || app.name;
    btn.innerHTML = `${iconMarkup(app.icon, 32)}<span class="sma-label">${escapeHtml(app.name)}</span>`;
    btn.addEventListener('click', () => this._launch(app.id));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const pinned = settings.get('taskbar.pinned') || [];
      const isPinned = pinned.includes(app.id);
      contextMenu.open([
        { id: 'open', label: '打开', icon: 'add', onClick: () => this._launch(app.id) },
        {
          id: 'pin',
          label: isPinned ? '从任务栏取消固定' : '固定到任务栏',
          icon: isPinned ? 'unpin' : 'pin',
          onClick: () => {
            const next = isPinned ? pinned.filter((x) => x !== app.id) : [...pinned, app.id];
            settings.set('taskbar.pinned', next);
          },
        },
      ], e.clientX, e.clientY);
    });
    return btn;
  }

  _recentTile(file) {
    const btn = document.createElement('button');
    btn.className = 'sm-recent';
    btn.type = 'button';
    btn.title = file.path;
    btn.innerHTML = `
      ${getIcon(iconForExtension(file.ext), 24)}
      <span class="smr-text">
        <span class="smr-name">${escapeHtml(file.name)}</span>
        <span class="smr-meta">${escapeHtml(P.formatDate(file.modified))}</span>
      </span>`;
    btn.addEventListener('click', () => this._openPath(file.path));
    return btn;
  }

  /* ---------------- 搜索 ---------------- */

  _renderSearch(content) {
    const q = this._query.toLowerCase();
    const results = [];

    for (const app of appRegistry.getAll()) {
      if (matches(app.name, q) || matches(app.id, q)) {
        results.push({
          kind: 'app',
          label: app.name,
          meta: '应用',
          icon: app.icon,
          run: () => this._launch(app.id),
        });
      }
    }

    for (const f of this.recent) {
      if (matches(f.name, q)) {
        results.push({
          kind: 'file',
          label: f.name,
          meta: P.dirname(f.path),
          icon: iconForExtension(f.ext),
          run: () => this._openPath(f.path),
        });
      }
    }

    // 兜底：把输入当作路径直接打开
    if (/^[a-zA-Z]:[\\/]/.test(this._query)) {
      const path = P.normalize(this._query);
      results.push({
        kind: 'path',
        label: `打开路径 ${path}`,
        meta: '在资源管理器中打开',
        icon: 'folderOpenSm',
        run: () => this._launch('explorer', { path }),
      });
    }

    this._results = results;
    this._highlight = results.length ? 0 : -1;

    content.appendChild(sectionHead(`搜索结果（${results.length}）`));

    if (!results.length) {
      content.appendChild(emptyState(`未找到与「${this._query}」匹配的内容`));
      return;
    }

    const list = document.createElement('div');
    list.className = 'sm-recent-list';
    list.style.gridTemplateColumns = '1fr';
    results.forEach((r, i) => {
      const btn = document.createElement('button');
      btn.className = 'sm-recent';
      btn.type = 'button';
      btn.dataset.index = String(i);
      btn.innerHTML = `
        ${iconMarkup(r.icon, 24)}
        <span class="smr-text">
          <span class="smr-name">${highlightMatch(r.label, this._query)}</span>
          <span class="smr-meta">${escapeHtml(r.meta || '')}</span>
        </span>`;
      btn.addEventListener('click', () => r.run());
      btn.addEventListener('pointerenter', () => this._setHighlight(i, false));
      list.appendChild(btn);
    });
    content.appendChild(list);
    this._syncHighlight();
  }

  _setHighlight(index, scroll = true) {
    if (!this._results.length) return;
    const n = this._results.length;
    this._highlight = ((index % n) + n) % n;
    this._syncHighlight(scroll);
  }

  _syncHighlight(scroll = false) {
    const items = this.el?.querySelectorAll('.sm-recent[data-index]');
    if (!items) return;
    items.forEach((el, i) => {
      const on = i === this._highlight;
      el.classList.toggle('is-highlighted', on);
      el.style.background = on ? 'var(--bg-hover)' : '';
      if (on && scroll) el.scrollIntoView({ block: 'nearest' });
    });
  }

  /* ==========================================================
     事件
     ========================================================== */

  _bindMenuEvents() {
    const input = this.el.querySelector('.sm-search-box input');

    let debounceTimer = 0;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        this._query = input.value.trim();
        this._renderBody();
      }, 120);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._setHighlight(this._highlight + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._setHighlight(this._highlight - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = this._results[this._highlight];
        if (r) r.run();
      }
    });

    this.el.querySelector('.sm-user').addEventListener('click', () => {
      notifications.toast({ title: 'User', body: '当前登录账户：本地用户', type: 'info' });
    });

    this.el.querySelector('.sm-power').addEventListener('click', (e) => {
      contextMenu.open([
        {
          id: 'lock',
          label: '锁定',
          icon: 'lock',
          onClick: () => notifications.toast({ title: '锁定', body: '该演示环境不支持锁屏', type: 'info' }),
        },
        {
          id: 'restart',
          label: '重启',
          icon: 'refresh',
          onClick: async () => {
            const ok = await notifications.confirm({ title: '重启', body: '将重新加载桌面环境，未保存的内容会丢失。', okText: '重启' });
            if (ok) location.reload();
          },
        },
        {
          id: 'shutdown',
          label: '关机',
          icon: 'power',
          danger: true,
          onClick: async () => {
            const ok = await notifications.confirm({ title: '关机', body: '将关闭所有窗口并停止桌面。', okText: '关机', danger: true });
            if (!ok) return;
            windowManager.getAll().forEach((w) => w.close());
            document.body.dataset.shutdown = 'true';
            notifications.toast({ title: '已关机', body: '刷新页面即可重新启动', type: 'info', duration: 8000 });
          },
        },
      ], e.clientX, e.clientY);
    });

    // 点击菜单内部不冒泡关闭
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());

    const onDocDown = (e) => {
      if (!this.isOpen) return;
      if (this.el?.contains(e.target)) return;
      if (e.target.closest?.('.tb-start')) return; // 交给开始按钮自己 toggle
      this.close();
    };
    document.addEventListener('pointerdown', onDocDown, true);
    this._disposers.push(() => document.removeEventListener('pointerdown', onDocDown, true));
  }

  /* ==========================================================
     动作
     ========================================================== */

  async _launch(appId, args) {
    this.close();
    try {
      await window.WinNext?.launchApp(appId, args);
      this._bumpUsage(appId);
    } catch (err) {
      log.error(`启动 ${appId} 失败`, err);
      notifications.toast({ title: '启动失败', body: String(err?.message || err), type: 'error' });
    }
  }

  async _openPath(path) {
    this.close();
    try {
      await window.WinNext?.openPath(path);
    } catch (err) {
      notifications.toast({ title: '无法打开', body: String(err?.message || err), type: 'error' });
    }
  }

  /** 记录启动次数，供后续「最常用」排序扩展 */
  _bumpUsage(appId) {
    const usage = store.get('usage', {});
    usage[appId] = (usage[appId] || 0) + 1;
    store.set('usage', usage);
  }

  dispose() {
    this.close();
    this._disposers.forEach((fn) => {
      try {
        fn();
      } catch { /* ignore */ }
    });
    this._disposers = [];
  }
}

/* ==========================================================
   工具
   ========================================================== */

function sectionHead(title, action) {
  const el = document.createElement('div');
  el.className = 'sm-section-head';
  el.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    el.appendChild(btn);
  }
  return el;
}

function emptyState(text) {
  const el = document.createElement('div');
  el.className = 'sm-empty';
  el.style.gridColumn = '1 / -1';
  el.textContent = text;
  return el;
}

/** 子串匹配 + 忽略大小写；空查询视为不匹配 */
function matches(text, query) {
  if (!query) return false;
  return String(text).toLowerCase().includes(query);
}

function highlightMatch(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return safe;
  const a = escapeHtml(text.slice(0, idx));
  const b = escapeHtml(text.slice(idx, idx + query.length));
  const c = escapeHtml(text.slice(idx + query.length));
  return `${a}<mark style="background:transparent;color:var(--accent);font-weight:600">${b}</mark>${c}`;
}

function iconMarkup(icon, size) {
  if (typeof icon === 'string' && icon.trim().startsWith('<svg')) return icon;
  if (typeof icon === 'string' && /^(https?:|data:|blob:|\.|\/)/.test(icon)) {
    return `<img src="${icon}" width="${size}" height="${size}" alt="" onerror="this.style.display='none'">`;
  }
  return getIcon(icon || 'fileGeneric', size);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const startMenu = new StartMenu();
export default startMenu;
