/**
 * 文件资源管理器
 *
 * 多标签页：每个标签页独立的浏览历史栈（前进/后退/上级）。
 * 左侧导航：常用目录 + 已挂载驱动器（虚拟盘 C 与已挂载本地目录）。
 * 右侧：地址栏面包屑、可手输路径、三视图（图标/列表/详细信息）、搜索、新建/重命名/删除/复制粘贴。
 *
 * 文件双击：文件夹进入；文件按扩展名调用关联应用（用 ctx.openPath）。
 * 拖放：文件到应用图标 → 复制粘贴；外部文件拖入 → 上传。
 */

import * as P from '../../core/fs/path-utils.js';
import { SHELL_FOLDERS } from '../../core/fs/fs-service.js';
import { getIcon, iconForExtension } from '../../ui/icons.js';

const NAV_LOCATIONS = [
  { label: '桌面', path: SHELL_FOLDERS.desktop, icon: 'desktop' },
  { label: '文档', path: SHELL_FOLDERS.documents, icon: 'documents' },
  { label: '下载', path: SHELL_FOLDERS.downloads, icon: 'downloads' },
  { label: '图片', path: SHELL_FOLDERS.pictures, icon: 'pictures' },
  { label: '音乐', path: SHELL_FOLDERS.music, icon: 'music' },
  { label: '视频', path: SHELL_FOLDERS.videos, icon: 'videos' },
];

export default async function mount(ctx) {
  const { fs } = ctx;
  ctx.injectStyleSheet(new URL('./explorer.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'ex-root';
  root.innerHTML = `
    <div class="ex-sidebar">
      <div class="ex-side-group">
        <h4>快速访问</h4>
        ${NAV_LOCATIONS.map((l) => `
          <button class="ex-side-item" data-nav="${escapeHtml(l.path)}">
            ${getIcon(l.icon, 16)}
            <span>${escapeHtml(l.label)}</span>
          </button>`).join('')}
        <button class="ex-side-item" data-action="home">${getIcon('thisPc', 16)}<span>此电脑</span></button>
      </div>
      <div class="ex-side-group" data-mount-group>
        <h4>此电脑</h4>
      </div>
      <div class="ex-side-group">
        <button class="ex-side-item" data-action="mount">${getIcon('add', 16)}<span>挂载本地文件夹</span></button>
      </div>
    </div>
    <div class="ex-main">
      <div class="ex-toolbar">
        <div class="ex-nav-buttons">
          <button class="tb-btn ex-back" title="后退" aria-label="后退" disabled>${getIcon('chevronLeft', 16)}</button>
          <button class="tb-btn ex-forward" title="前进" aria-label="前进" disabled>${getIcon('chevronRight', 16)}</button>
          <button class="tb-btn ex-up" title="上级" aria-label="上级">${getIcon('chevronUp', 16)}</button>
        </div>
        <div class="ex-address">
          <input class="ex-address-input" type="text" aria-label="地址" spellcheck="false">
        </div>
        <div class="ex-search">
          <span class="ex-search-icon">${getIcon('search', 14)}</span>
          <input class="ex-search-input" type="search" placeholder="搜索当前目录" aria-label="搜索">
        </div>
        <div class="ex-view-toggle">
          <button class="tb-btn is-active" data-view="icons" title="大图标" aria-label="大图标">${getIcon('grid', 16)}</button>
          <button class="tb-btn" data-view="list" title="列表" aria-label="列表">${getIcon('list', 16)}</button>
          <button class="tb-btn" data-view="details" title="详细信息" aria-label="详细信息">${getIcon('list', 16)}</button>
        </div>
      </div>
      <div class="ex-tabs"></div>
      <div class="ex-panes"></div>
      <div class="ex-status">
        <span class="ex-status-count">0 项</span>
        <span class="ex-status-info"></span>
      </div>
    </div>`;
  ctx.root.appendChild(root);

  const sidebar = root.querySelector('.ex-sidebar');
  const tabsEl = root.querySelector('.ex-tabs');
  const panesEl = root.querySelector('.ex-panes');
  const statusCount = root.querySelector('.ex-status-count');
  const statusInfo = root.querySelector('.ex-status-info');
  const addressInput = root.querySelector('.ex-address-input');
  const searchInput = root.querySelector('.ex-search-input');
  const mountGroup = root.querySelector('[data-mount-group]');

  /** @type {Tab[]} */
  const tabs = [];
  /** @type {Tab|null} */
  let active = null;

  // ── 标签页模型 ─────────────────────────────────────────────
  function newTab(path) {
    return {
      id: ++tabSeq,
      history: [path],
      cursor: 0,
      view: 'icons',
      search: '',
      results: null,
    };
  }

  let tabSeq = 0;
  function findTabById(id) { return tabs.find((t) => t.id === id); }
  function currentPath(t = active) { return t.history[t.cursor]; }

  async function openInNewTab(path) {
    const tab = newTab(path);
    tabs.push(tab);
    renderTabs();
    await activate(tab);
  }

  function activate(tab) {
    active = tab;
    for (const t of tabs) {
      const pane = panesEl.querySelector(`[data-tab="${t.id}"]`);
      const tabEl = tabsEl.querySelector(`[data-tab="${t.id}"]`);
      const on = t === tab;
      pane?.classList.toggle('is-active', on);
      tabEl?.classList.toggle('is-active', on);
    }
    syncToolbar();
    loadActive();
  }

  async function closeTab(tab) {
    const idx = tabs.indexOf(tab);
    if (idx < 0) return;
    tabs.splice(idx, 1);
    if (tab === active) {
      active = tabs[idx] || tabs[idx - 1] || null;
      if (active) await activate(active);
      else {
        // 关闭最后一个标签：自动开一个 Home
        await openInNewTab(SHELL_FOLDERS.home);
        tabs.shift();
      }
    }
    renderTabs();
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    panesEl.innerHTML = '';
    for (const t of tabs) {
      const tabEl = document.createElement('div');
      tabEl.className = 'ex-tab';
      tabEl.dataset.tab = t.id;
      tabEl.innerHTML = `<span class="ext-title"></span><button class="ext-close" aria-label="关闭">${getIcon('close', 10)}</button>`;
      tabEl.querySelector('.ext-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(t);
      });
      tabEl.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(t);
        } else if (e.button === 0) {
          activate(t);
        }
      });
      tabsEl.appendChild(tabEl);

      const pane = document.createElement('div');
      pane.className = 'ex-pane';
      pane.dataset.tab = t.id;
      panesEl.appendChild(pane);
    }
    // 补充标题
    for (const t of tabs) {
      const tabEl = tabsEl.querySelector(`[data-tab="${t.id}"] .ext-title`);
      if (tabEl) tabEl.textContent = titleOf(currentPath(t));
    }
  }

  function syncToolbar() {
    if (!active) return;
    const back = root.querySelector('.ex-back');
    const forward = root.querySelector('.ex-forward');
    const up = root.querySelector('.ex-up');
    back.disabled = active.cursor <= 0;
    forward.disabled = active.cursor >= active.history.length - 1;
    const dir = P.dirname(currentPath());
    up.disabled = dir === currentPath() || !dir;
    addressInput.value = currentPath();
  }

  async function loadActive() {
    if (!active) return;
    const pane = panesEl.querySelector(`[data-tab="${active.id}"]`);
    const path = currentPath();
    pane.classList.add('is-loading');
    try {
      let entries;
      if (active.search) {
        entries = await fs.search(path, active.search, { limit: 200 });
        active.results = entries;
      } else {
        entries = await fs.readDir(path);
        active.results = null;
      }
      active.entries = entries;
      renderPane(pane);
      updateStatus(entries);
    } catch (err) {
      pane.innerHTML = `<div class="ex-empty">无法访问：${escapeHtml(String(err?.message || err))}</div>`;
      statusCount.textContent = '0 项';
    } finally {
      pane.classList.remove('is-loading');
    }
    syncToolbar();
    // 同步侧边栏选中态
    for (const item of sidebar.querySelectorAll('[data-nav]')) {
      item.classList.toggle('is-active', item.dataset.nav === path);
    }
  }

  function renderPane(pane) {
    pane.innerHTML = '';
    pane.dataset.view = active.view;

    if (!active.entries?.length) {
      const empty = document.createElement('div');
      empty.className = 'ex-empty';
      empty.textContent = active.search ? '没有匹配的文件' : '此文件夹为空';
      pane.appendChild(empty);
      return;
    }

    // 先按类型（文件夹在前）再按名称排序
    const entries = [...active.entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh');
    });

    const list = document.createElement('div');
    list.className = `ex-list ex-view-${active.view}`;

    if (active.view === 'details') {
      list.appendChild(
        headerRow(['名称', '修改日期', '类型', '大小']),
      );
    }

    for (const st of entries) {
      list.appendChild(renderEntry(st));
    }
    pane.appendChild(list);
  }

  function renderEntry(st) {
    const el = document.createElement('div');
    el.className = `ex-entry ex-entry-${st.type}`;
    el.dataset.path = st.path;
    el.dataset.name = st.name;
    el.tabIndex = 0;
    const iconName = st.type === 'directory' ? 'folder' : iconForExtension(st.ext);

    if (active.view === 'icons') {
      el.innerHTML = `
        <span class="ex-entry-icon">${iconMarkup(iconName, 36)}</span>
        <span class="ex-entry-label">${escapeHtml(st.name)}</span>`;
    } else if (active.view === 'list') {
      el.innerHTML = `
        <span class="ex-entry-icon">${iconMarkup(iconName, 18)}</span>
        <span class="ex-entry-label">${escapeHtml(st.name)}</span>`;
    } else {
      el.innerHTML = `
        <span class="ex-entry-icon">${iconMarkup(iconName, 18)}</span>
        <span class="col-name">${escapeHtml(st.name)}</span>
        <span class="col-date">${escapeHtml(P.formatDate(st.modified))}</span>
        <span class="col-type">${st.type === 'directory' ? '文件夹' : (st.ext || '文件').toUpperCase()}</span>
        <span class="col-size">${st.type === 'directory' ? '' : P.formatSize(st.size)}</span>`;
    }

    // 双击进入 / 打开
    el.addEventListener('dblclick', () => activateEntry(st));
    // 单击选中
    el.addEventListener('pointerdown', (e) => selectOnPointer(e, el, st));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      selectOnly(el);
      showContextMenu(e.clientX, e.clientY, st);
    });
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-wn-path', st.path);
      e.dataTransfer.effectAllowed = 'copyMove';
    });

    return el;
  }

  function headerRow(cols) {
    const el = document.createElement('div');
    el.className = 'ex-entry ex-header';
    el.innerHTML = cols.map((c, i) => `<span class="col-${['name', 'date', 'type', 'size'][i]}">${escapeHtml(c)}</span>`).join('');
    return el;
  }

  function selectOnPointer(e, el, st) {
    if (e.button === 2) return;
    if (e.ctrlKey) el.classList.toggle('is-selected');
    else if (e.shiftKey) rangeSelect(el);
    else selectOnly(el);
  }

  function selectOnly(el) {
    for (const other of el.parentElement.querySelectorAll('.is-selected')) other.classList.remove('is-selected');
    el.classList.add('is-selected');
  }

  function rangeSelect(target) {
    const pane = target.parentElement;
    const all = [...pane.querySelectorAll('.ex-entry:not(.ex-header)')];
    const last = pane.querySelector('.is-selected') || all[0];
    const a = all.indexOf(last);
    const b = all.indexOf(target);
    if (a < 0 || b < 0) return;
    const [from, to] = a < b ? [a, b] : [b, a];
    all.forEach((e, i) => e.classList.toggle('is-selected', i >= from && i <= to));
  }

  function selectedEntries() {
    if (!active) return [];
    const pane = panesEl.querySelector(`[data-tab="${active.id}"]`);
    return [...pane.querySelectorAll('.ex-entry.is-selected')].map((el) => active.entries.find((s) => s.path === el.dataset.path)).filter(Boolean);
  }

  async function activateEntry(st) {
    if (st.type === 'directory') {
      active.history = active.history.slice(0, active.cursor + 1);
      active.history.push(st.path);
      active.cursor++;
      active.search = '';
      searchInput.value = '';
      renderTabs();
      await loadActive();
    } else {
      await ctx.openPath(st.path);
    }
  }

  function updateStatus(entries) {
    statusCount.textContent = `${entries.length} 项`;
    if (entries.length) {
      const total = entries.reduce((s, e) => s + (e.size || 0), 0);
      statusInfo.textContent = active.search ? `搜索：「${active.search}」` : `共 ${P.formatSize(total)}`;
    } else {
      statusInfo.textContent = '';
    }
  }

  function titleOf(path) {
    return path === SHELL_FOLDERS.desktop ? '桌面' : P.basename(path) || path;
  }

  // ── 工具栏事件 ─────────────────────────────────────────────
  root.querySelector('.ex-back').addEventListener('click', async () => {
    if (active.cursor <= 0) return;
    active.cursor--;
    await loadActive();
  });
  root.querySelector('.ex-forward').addEventListener('click', async () => {
    if (active.cursor >= active.history.length - 1) return;
    active.cursor++;
    await loadActive();
  });
  root.querySelector('.ex-up').addEventListener('click', async () => {
    const parent = P.dirname(currentPath());
    if (parent === currentPath()) return;
    active.history = active.history.slice(0, active.cursor + 1);
    active.history.push(parent);
    active.cursor++;
    renderTabs();
    await loadActive();
  });

  let addressTimer = 0;
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const target = P.normalize(addressInput.value.trim() || SHELL_FOLDERS.home);
      active.history = active.history.slice(0, active.cursor + 1);
      active.history.push(target);
      active.cursor++;
      renderTabs();
      loadActive();
    } else if (e.key === 'Escape') {
      addressInput.value = currentPath();
      addressInput.blur();
    }
  });
  addressInput.addEventListener('input', () => {
    clearTimeout(addressTimer);
    addressTimer = window.setTimeout(() => {
      addressInput.value = currentPath();
    }, 1200);
  });

  let searchTimer = 0;
  searchInput.addEventListener('input', () => {
    if (!active) return;
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      active.search = searchInput.value.trim();
      loadActive();
    }, 220);
  });

  for (const btn of root.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => {
      if (!active) return;
      active.view = btn.dataset.view;
      for (const b of root.querySelectorAll('[data-view]')) b.classList.toggle('is-active', b === btn);
      const pane = panesEl.querySelector(`[data-tab="${active.id}"]`);
      renderPane(pane);
    });
  }

  // ── 侧边栏 ─────────────────────────────────────────────
  for (const item of sidebar.querySelectorAll('[data-nav]')) {
    item.addEventListener('click', async () => {
      await openInNewTab(item.dataset.nav);
    });
  }
  sidebar.querySelector('[data-action="home"]').addEventListener('click', () => openInNewTab(SHELL_FOLDERS.home));
  sidebar.querySelector('[data-action="mount"]').addEventListener('click', () => mountLocalFolder());

  function refreshDriveList() {
    mountGroup.innerHTML = '<h4>此电脑</h4>';
    for (const drive of ctx.fs.getDrives()) {
      const btn = document.createElement('button');
      btn.className = 'ex-side-item';
      btn.dataset.nav = drive.path;
      btn.innerHTML = `${getIcon(drive.kind === 'local' ? 'usb' : 'hdd', 16)}<span>${escapeHtml(drive.label)}</span>`;
      btn.addEventListener('click', () => openInNewTab(drive.path));
      mountGroup.appendChild(btn);
    }
  }

  async function mountLocalFolder() {
    try {
      const result = await ctx.fs.pick({ mode: 'folder' });
      if (!result?.path) return;
      refreshDriveList();
      await openInNewTab(result.path);
    } catch (err) {
      if (err?.name !== 'AbortError') ctx.notify.error('挂载失败：' + (err?.message || err));
    }
  }

  ctx.events.on('fs:changed', (payload) => {
    if (payload?.path?.startsWith?.(currentPath() || '')) loadActive();
  });

  // ── 空白处右键：新建 ─────────────────────────────────────────
  panesEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.ex-entry')) return;
    e.preventDefault();
    showEmptyContextMenu(e.clientX, e.clientY);
  });

  async function showEmptyContextMenu(x, y) {
    const items = [
      { id: 'new-folder', label: '新建文件夹', icon: 'folder', onClick: () => createNew('folder') },
      { separator: true },
      { id: 'new-txt', label: '文本文档', icon: 'fileText', onClick: () => createNew('file', 'txt') },
      { id: 'new-md', label: 'Markdown 文档', icon: 'fileText', onClick: () => createNew('file', 'md') },
      { id: 'new-html', label: 'HTML 文件', icon: 'fileCode', onClick: () => createNew('file', 'html') },
      { id: 'new-js', label: 'JavaScript 文件', icon: 'fileCode', onClick: () => createNew('file', 'js') },
      { separator: true },
      { id: 'paste', label: '粘贴', icon: 'paste', disabled: !clipboard, onClick: () => pasteHere() },
      { separator: true },
      { id: 'open-terminal', label: '在此处打开终端', icon: 'terminal', onClick: () => ctx.launchApp('terminal', { cwd: currentPath() }) },
    ];
    const { contextMenu } = await import('../../shell/context-menu.js');
    contextMenu.open(items, x, y);
  }

  async function showContextMenu(x, y, st) {
    const selected = selectedEntries();
    const list = selected.length ? selected : [st];
    const items = [];

    if (list.length === 1 && list[0].type === 'directory') {
      items.push({ id: 'open', label: '打开', icon: 'folderOpenSm', onClick: () => activateEntry(list[0]) });
    } else if (list.length === 1 && list[0].type !== 'directory') {
      items.push({ id: 'open', label: '打开', icon: 'folderOpenSm', onClick: () => activateEntry(list[0]) });
      const ext = list[0].ext;
      if (ext) {
        items.push({
          id: 'open-with',
          label: '打开方式',
          icon: 'add',
          children: [
            { id: 'default', label: '默认应用', onClick: () => ctx.openPath(list[0].path) },
            { id: 'notepad', label: '记事本', onClick: () => ctx.launchApp('notepad', { filePath: list[0].path }) },
            { id: 'browser', label: '浏览器', disabled: !/^(htm|html|svg)$/.test(ext), onClick: () => ctx.launchApp('browser', { url: list[0].path }) },
          ],
        });
      }
    }

    items.push(
      { id: 'rename', label: '重命名', icon: 'rename', shortcut: 'F2', disabled: list.length !== 1, onClick: () => renameEntry(list[0]) },
      { id: 'delete', label: list.length > 1 ? `删除 ${list.length} 项` : '删除', icon: 'delete', shortcut: 'Del', danger: true, onClick: () => deleteEntries(list) },
      { id: 'copy', label: '复制', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => copyEntries(list) },
    );

    if (list.length === 1 && list[0].type !== 'directory') {
      items.push({ id: 'props', label: '属性', icon: 'info', onClick: () => showProperties(list[0]) });
    }

    const { contextMenu } = await import('../../shell/context-menu.js');
    contextMenu.open(items, x, y);
  }

  let clipboard = null; // { mode: 'copy', paths: string[] }

  async function createNew(kind, ext) {
    try {
      const dir = currentPath();
      const existing = (await ctx.fs.readDir(dir)).map((s) => s.name);
      const base = kind === 'folder' ? '新建文件夹' : `新建.${ext}`;
      const name = P.uniqueName(base, existing);
      const target = P.join(dir, name);
      if (kind === 'folder') await ctx.fs.mkdir(target);
      else await ctx.fs.writeFile(target, '');
      await loadActive();
      const pane = panesEl.querySelector(`[data-tab="${active.id}"]`);
      const el = pane.querySelector(`[data-path="${target}"]`);
      if (el) {
        for (const other of pane.querySelectorAll('.is-selected')) other.classList.remove('is-selected');
        el.classList.add('is-selected');
        el.dispatchEvent(new MouseEvent('dblclick'));
        // 启动重命名
        await new Promise((r) => setTimeout(r, 50));
        beginRename(pane.querySelector(`[data-path="${target}"]`), name);
      }
    } catch (err) {
      ctx.notify.error('新建失败：' + (err?.message || err));
    }
  }

  function copyEntries(list) {
    clipboard = { mode: 'copy', paths: list.map((s) => s.path) };
    ctx.notify.info(`已复制 ${list.length} 个项目`);
  }

  async function pasteHere() {
    if (!clipboard) return;
    const dir = currentPath();
    try {
      for (const src of clipboard.paths) {
        const existing = (await ctx.fs.readDir(dir)).map((s) => s.name);
        const name = P.uniqueName(P.basename(src), existing);
        await ctx.fs.copy(src, P.join(dir, name));
      }
    } catch (err) {
      ctx.notify.error('粘贴失败：' + (err?.message || err));
    }
    await loadActive();
  }

  async function deleteEntries(list) {
    if (!(await ctx.dialog.confirm(`确定要删除这 ${list.length} 个项目吗？`, '删除', { okLabel: '删除' }))) return;
    for (const s of list) {
      try {
        await ctx.fs.remove(s.path, true);
      } catch (err) {
        ctx.notify.warning(`无法删除 ${s.name}：${err?.message || err}`);
      }
    }
    await loadActive();
  }

  async function renameEntry(st) {
    const pane = panesEl.querySelector(`[data-tab="${active.id}"]`);
    const el = pane.querySelector(`[data-path="${st.path}"]`);
    if (el) beginRename(el, st.name);
  }

  function beginRename(el, originalName) {
    const label = el.querySelector('.ex-entry-label') || el.querySelector('.col-name');
    const input = document.createElement('input');
    input.className = 'ex-rename-input';
    input.value = originalName;
    label.replaceWith(input);
    input.focus();
    const dot = originalName.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : originalName.length);
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      label.textContent = next || originalName;
      input.replaceWith(label);
      if (!commit || !next || next === originalName) return;
      const err = P.validateName(next);
      if (err) return ctx.notify.error(err);
      try {
        await ctx.fs.rename(el.dataset.path, P.join(P.dirname(el.dataset.path), next));
        await loadActive();
      } catch (e2) {
        ctx.notify.error('重命名失败：' + (e2?.message || e2));
      }
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
  }

  async function showProperties(st) {
    const data = [
      `类型：${st.type === 'directory' ? '文件夹' : (st.ext || '文件').toUpperCase()}`,
      `位置：${P.dirname(st.path)}`,
      `大小：${P.formatSize(st.size)}`,
      `修改时间：${P.formatDate(st.modified)}`,
    ].join('\n');
    await ctx.dialog.alert(data, `${st.name} 属性`);
  }

  // ── 键盘 ─────────────────────────────────────────────
  document.addEventListener('keydown', async (e) => {
    // 仅在窗口激活时响应
    if (!ctx.window.isActive) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'F2') {
      const [first] = selectedEntries();
      if (first) renameEntry(first);
    } else if (e.key === 'Delete') {
      const list = selectedEntries();
      if (list.length) deleteEntries(list);
    } else if (e.key === 'c' && e.ctrlKey) {
      const list = selectedEntries();
      if (list.length) copyEntries(list);
    } else if (e.key === 'v' && e.ctrlKey) {
      pasteHere();
    } else if (e.key === 'a' && e.ctrlKey) {
      e.preventDefault();
      const pane = panesEl.querySelector(`[data-tab="${active.id}"]`);
      for (const el of pane.querySelectorAll('.ex-entry:not(.ex-header)')) el.classList.add('is-selected');
    } else if (e.key === 'F5') {
      await loadActive();
    }
  });

  // ── 拖入文件上传 ─────────────────────────────────────────
  panesEl.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  panesEl.addEventListener('drop', async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    let ok = 0;
    for (const file of e.dataTransfer.files) {
      try {
        const target = P.join(currentPath(), file.name);
        await ctx.fs.writeFile(target, await file.arrayBuffer());
        ok++;
      } catch (err) {
        ctx.notify.warning(`保存 ${file.name} 失败`);
      }
    }
    if (ok) ctx.notify.success(`已复制 ${ok} 个文件`);
    await loadActive();
  });

  // ── 启动 ─────────────────────────────────────────────
  await openInNewTab(ctx.args?.path || SHELL_FOLDERS.home);
  refreshDriveList();

  ctx.setPreviewProvider(() => {
    if (!active) return '';
    return `${currentPath()} · ${active.entries?.length || 0} 项`;
  });
}

/* ============================================================
   工具
   ============================================================ */

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