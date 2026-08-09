/**
 * 浏览器（多标签页 + iframe）
 *
 * 极简实现：每个标签 = 一个 iframe + 独立历史栈。
 * 由于浏览器 X-Frame-Options / CSP 限制，多数站点拒绝被嵌入，
 * 检测到 onload 异常或 sandbox iframe 拒绝时显示友好提示并提供新窗口打开。
 *
 * 地址栏：
 *   - 直接输入 https://... / http://... 加载
 *   - 看起来像域名时自动补 https://
 *   - 否则作为默认搜索引擎查询串
 */

import { getIcon } from '../../ui/icons.js';

const HOME = 'https://start.local/';

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./browser.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'br-root';
  root.innerHTML = `
    <div class="br-tabs"></div>
    <div class="br-toolbar">
      <button class="br-btn br-back" title="后退" aria-label="后退">${getIcon('chevronLeft', 16)}</button>
      <button class="br-btn br-forward" title="前进" aria-label="前进">${getIcon('chevronRight', 16)}</button>
      <button class="br-btn br-reload" title="刷新" aria-label="刷新">${getIcon('refresh', 16)}</button>
      <button class="br-btn br-home" title="主页" aria-label="主页">${getIcon('thisPc', 16)}</button>
      <input class="br-address" type="text" placeholder="搜索或输入网址" spellcheck="false" autocomplete="off" aria-label="地址">
      <button class="br-btn br-star" title="收藏此页" aria-label="收藏此页">${getIcon('star', 16)}</button>
      <button class="br-btn br-menu" title="更多" aria-label="更多">${getIcon('more', 16)}</button>
      <button class="br-btn br-new" title="新建标签" aria-label="新建标签">＋</button>
    </div>
    <div class="br-bookmarks"></div>
    <div class="br-panes"></div>
  `;
  ctx.root.appendChild(root);

  const tabsEl = root.querySelector('.br-tabs');
  const panesEl = root.querySelector('.br-panes');
  const addressInput = root.querySelector('.br-address');
  const bookmarksEl = root.querySelector('.br-bookmarks');
  const starBtn = root.querySelector('.br-star');

  /** @type {Tab[]} */
  const tabs = [];
  let active = null;
  let tabSeq = 0;

  const defaults = [
    { id: 'bm-default-home', name: 'WindowsNext', url: 'about:newtab' },
    { id: 'bm-default-bing', name: '必应', url: 'https://cn.bing.com/' },
    { id: 'bm-default-wiki', name: '维基百科', url: 'https://zh.wikipedia.org/' },
  ];

  /**
   * 用户书签（持久化）
   * @type {Array<{id:string,name:string,url:string}>}
   *
   * 每条都带稳定 id：删除/编辑按 id 定位，避免同名书签用 indexOf 误删。
   * 兼容旧版本仅有 {name,url} 的数据，读取时补齐 id。
   */
  const bookmarks = ctx.settings.getLocal('bookmarks', defaults)
    .map((b) => (b.id ? b : { ...b, id: nextBookmarkId() }));

  /** 收藏栏是否显示（持久化） */
  let showFavbar = ctx.settings.getLocal('showFavbar', true);

  function nextBookmarkId() {
    return `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function saveBookmarks() {
    ctx.settings.setLocal('bookmarks', bookmarks);
    renderBookmarks();
    syncStar();
    // 新标签页磁贴与收藏栏共用同一份数据，需同步刷新可见的新标签页
    for (const t of tabs) {
      if (t.url === 'about:newtab' && t.pane) renderNewTabPage(t.pane, t);
    }
  }

  function applyFavbarVisibility() {
    root.dataset.favbar = showFavbar ? 'on' : 'off';
  }

  function setFavbarVisible(visible) {
    showFavbar = Boolean(visible);
    ctx.settings.setLocal('showFavbar', showFavbar);
    applyFavbarVisibility();
  }

  /** 当前标签的规范化地址，用于判断是否已收藏 */
  function activeUrl() {
    return active ? current(active) : '';
  }

  function findBookmarkByUrl(url) {
    return bookmarks.find((b) => b.url === url) || null;
  }

  /** 同步星形按钮的点亮状态 */
  function syncStar() {
    const url = activeUrl();
    const hit = url && findBookmarkByUrl(url);
    starBtn.classList.toggle('is-active', Boolean(hit));
    starBtn.title = hit ? '已收藏，点击修改' : '收藏此页';
  }

  function renderBookmarks() {
    bookmarksEl.innerHTML = '';
    for (const b of bookmarks) {
      const a = document.createElement('a');
      a.className = 'br-bookmark';
      a.href = '#';
      a.title = b.url;
      a.textContent = b.name;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (active) navigate(active, b.url);
      });
      a.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        import('../../shell/context-menu.js').then(({ contextMenu }) => {
          contextMenu.open([
            { id: 'open', label: '打开', icon: 'browser', onClick: () => active && navigate(active, b.url) },
            { id: 'open-new', label: '在新标签页中打开', icon: 'add', onClick: () => openInNewTab(b.url) },
            { separator: true },
            { id: 'edit', label: '编辑…', icon: 'edit', onClick: () => openBookmarkEditor(b) },
            { id: 'remove', label: '删除', icon: 'delete', onClick: () => removeBookmark(b.id) },
            { separator: true },
            { id: 'clear', label: '清空收藏栏', icon: 'delete', onClick: () => clearBookmarks() },
          ], e.clientX, e.clientY);
        });
      });
      bookmarksEl.appendChild(a);
    }
    if (!bookmarks.length) {
      const tip = document.createElement('span');
      tip.className = 'br-bookmarks-empty';
      tip.textContent = '点击地址栏右侧的 ☆ 收藏当前页面';
      bookmarksEl.appendChild(tip);
    }
  }

  function removeBookmark(id) {
    const idx = bookmarks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    bookmarks.splice(idx, 1);
    saveBookmarks();
  }

  async function clearBookmarks() {
    if (!bookmarks.length) return;
    const ok = await ctx.dialog.confirm('确定要清空全部书签吗？', '清空收藏栏', { okLabel: '清空' });
    if (!ok) return;
    bookmarks.length = 0;
    saveBookmarks();
  }

  /**
   * 打开书签编辑气泡：传入已有书签为编辑，否则为「收藏当前页」。
   * @param {{id:string,name:string,url:string}|null} existing
   */
  function openBookmarkEditor(existing) {
    root.querySelector('.br-bm-editor')?.remove();

    const isNew = !existing;
    const model = existing || {
      id: nextBookmarkId(),
      name: (active?.title && active.title !== active.url ? active.title : '') || activeUrl() || '新书签',
      url: activeUrl() || 'about:newtab',
    };

    const box = document.createElement('div');
    box.className = 'br-bm-editor';
    box.innerHTML = `
      <div class="br-bm-title">${isNew ? '已添加书签' : '编辑书签'}</div>
      <label class="br-bm-field"><span>名称</span><input class="br-bm-name" type="text"></label>
      <label class="br-bm-field"><span>网址</span><input class="br-bm-url" type="text" spellcheck="false"></label>
      <div class="br-bm-actions">
        <button class="btn br-bm-remove" type="button">删除</button>
        <span class="br-bm-spacer"></span>
        <button class="btn br-bm-cancel" type="button">取消</button>
        <button class="btn btn-primary br-bm-save" type="button">完成</button>
      </div>`;
    root.appendChild(box);

    const nameInput = box.querySelector('.br-bm-name');
    const urlInput = box.querySelector('.br-bm-url');
    nameInput.value = model.name;
    urlInput.value = model.url;

    // 新增时先落盘，符合 Chrome「先收藏再编辑」的交互习惯
    if (isNew) {
      bookmarks.push(model);
      saveBookmarks();
    }

    const close = () => {
      box.remove();
      root.removeEventListener('pointerdown', onOutside, true);
    };
    // 监听 root 而非 document：应用运行在 Shadow DOM 中，
    // 事件冒泡到 document 时 target 会被重定向到宿主元素，contains 判断将失效。
    const onOutside = (e) => {
      if (!box.contains(e.target) && !starBtn.contains(e.target)) close();
    };
    // 延迟注册，避免本次点击立刻触发关闭
    setTimeout(() => root.addEventListener('pointerdown', onOutside, true), 0);

    box.querySelector('.br-bm-save').addEventListener('click', () => {
      const name = nameInput.value.trim();
      const url = urlInput.value.trim();
      if (!url) return ctx.notify.warning('网址不能为空');
      const target = bookmarks.find((b) => b.id === model.id);
      if (target) {
        target.name = name || url;
        target.url = normalizeUrl(url);
      }
      saveBookmarks();
      close();
    });
    box.querySelector('.br-bm-cancel').addEventListener('click', () => {
      // 新增后取消 = 撤销这次收藏
      if (isNew) removeBookmark(model.id);
      close();
    });
    box.querySelector('.br-bm-remove').addEventListener('click', () => {
      removeBookmark(model.id);
      close();
    });

    nameInput.focus();
    nameInput.select();
  }

  /** 星形按钮：未收藏则添加，已收藏则打开编辑气泡 */
  function toggleBookmark() {
    if (!active) return;
    const url = activeUrl();
    if (!url || url === 'about:newtab') {
      ctx.notify.info('新标签页无法收藏');
      return;
    }
    openBookmarkEditor(findBookmarkByUrl(url));
  }

  starBtn.addEventListener('click', toggleBookmark);

  root.querySelector('.br-menu').addEventListener('click', (e) => {
    // 同步取出锚点矩形：事件派发结束后 e.currentTarget 会被置空，
    // 在异步 import 的回调里再访问就会抛错，菜单将永远打不开。
    const rect = e.currentTarget.getBoundingClientRect();
    import('../../shell/context-menu.js').then(({ contextMenu }) => {
      contextMenu.open([
        {
          id: 'toggle-favbar',
          label: showFavbar ? '✓ 显示收藏栏' : '显示收藏栏',
          icon: 'star',
          onClick: () => setFavbarVisible(!showFavbar),
        },
        { separator: true },
        { id: 'add-bm', label: '收藏当前页…', icon: 'star', onClick: () => toggleBookmark() },
        { id: 'clear-bm', label: '清空收藏栏', icon: 'delete', onClick: () => clearBookmarks() },
      ], rect.left, rect.bottom + 4);
    });
  });

  applyFavbarVisibility();
  renderBookmarks();

  function newTab(url = 'about:newtab') {
    const id = ++tabSeq;
    return {
      id,
      title: '新标签页',
      url,
      history: [url],
      cursor: 0,
      loading: false,
      blocked: false,
      dom: null,
      pane: null,
      iframe: null,
    };
  }

  function findTab(id) { return tabs.find((t) => t.id === id); }
  function current(t) { return t.history[t.cursor]; }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const t of tabs) {
      const tabEl = document.createElement('div');
      tabEl.className = 'br-tab';
      tabEl.dataset.tab = String(t.id);
      if (t === active) tabEl.classList.add('is-active');
      tabEl.innerHTML = `
        <span class="brt-favicon"></span>
        <span class="brt-title">${escapeHtml(t.title || '新标签')}</span>
        <button class="brt-close" aria-label="关闭">${getIcon('close', 10)}</button>`;
      tabEl.querySelector('.brt-favicon').innerHTML = getIcon('browser', 12);
      tabEl.addEventListener('click', (e) => {
        if (e.target.closest('.brt-close')) return closeTab(t);
        activate(t);
      });
      tabEl.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(t);
        }
      });
      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        import('../../shell/context-menu.js').then(({ contextMenu }) => {
          contextMenu.open([
            { id: 'reload', label: '重新加载', icon: 'refresh', onClick: () => reload(t) },
            { id: 'dup', label: '复制', icon: 'copy', onClick: () => openInNewTab(t.url) },
            { id: 'close', label: '关闭', icon: 'close', onClick: () => closeTab(t) },
            { id: 'closeothers', label: '关闭其他', icon: 'close', onClick: () => closeOthers(t) },
          ], e.clientX, e.clientY);
        });
      });
      tabsEl.appendChild(tabEl);
    }
    // 新标签按钮
    const add = document.createElement('button');
    add.className = 'br-tab br-tab-add';
    add.type = 'button';
    add.title = '新建标签';
    add.textContent = '＋';
    add.addEventListener('click', () => openInNewTab('about:newtab'));
    tabsEl.appendChild(add);
  }

  function ensurePane(t) {
    if (t.pane) return t.pane;
    const pane = document.createElement('div');
    pane.className = 'br-pane';
    pane.dataset.tab = String(t.id);
    panesEl.appendChild(pane);
    t.pane = pane;
    return pane;
  }

  async function openInNewTab(url = 'about:newtab') {
    const t = newTab(url);
    tabs.push(t);
    renderTabs();
    await activate(t);
  }

  async function activate(t) {
    active = t;
    for (const other of tabs) {
      other.pane?.classList.toggle('is-active', other === t);
      tabsEl.querySelector(`[data-tab="${other.id}"]`)?.classList.toggle('is-active', other === t);
    }
    addressInput.value = current(t) === 'about:newtab' ? '' : current(t);
    syncNavButtons();
    syncStar();
    if (t.url === 'about:newtab') {
      renderNewTabPage(ensurePane(t), t);
      t.pane.classList.add('is-active');
    } else if (!t.iframe) {
      await load(t, t.url);
    } else if (t.pane) {
      t.pane.classList.add('is-active');
    }
  }

  function syncNavButtons() {
    if (!active) return;
    root.querySelector('.br-back').disabled = active.cursor <= 0;
    root.querySelector('.br-forward').disabled = active.cursor >= active.history.length - 1;
  }

  async function load(t, rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (t.url !== url) {
      t.history = t.history.slice(0, t.cursor + 1);
      t.history.push(url);
      t.cursor++;
      t.url = url;
    }
    t.title = url;
    t.blocked = false;
    if (t === active) {
      addressInput.value = url === 'about:newtab' ? '' : url;
      syncNavButtons();
      syncStar();
    }

    const pane = ensurePane(t);
    pane.innerHTML = '';
    pane.classList.add('is-loading');

    if (url === 'about:newtab') {
      pane.classList.remove('is-loading');
      renderNewTabPage(pane, t);
      syncStar();
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'br-iframe';
    iframe.referrerPolicy = 'no-referrer';
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-same-origin');
    iframe.src = url;
    t.iframe = iframe;

    let loaded = false;
    const blockedTimeout = window.setTimeout(() => {
      if (!loaded) markBlocked(t, '加载超时或被目标站点拒绝嵌入');
    }, 8000);

    iframe.addEventListener('load', () => {
      loaded = true;
      window.clearTimeout(blockedTimeout);
      pane.classList.remove('is-loading');
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.title) {
          t.title = doc.title;
          const titleEl = tabsEl.querySelector(`[data-tab="${t.id}"] .brt-title`);
          if (titleEl && t === active) ctx.window.setTitle(doc.title);
          if (titleEl) titleEl.textContent = doc.title.slice(0, 40);
        }
      } catch (err) {
        markBlocked(t, '无法访问此页面的内容（同源策略）');
      }
    });
    pane.appendChild(iframe);
    pane.classList.add('is-active');
  }

  function markBlocked(t, reason) {
    t.blocked = true;
    const pane = ensurePane(t);
    pane.innerHTML = `
      <div class="br-blocked">
        <div class="br-blocked-icon">${getIcon('error', 48)}</div>
        <div class="br-blocked-title">无法显示此页面</div>
        <div class="br-blocked-reason">${escapeHtml(reason)}</div>
        <div class="br-blocked-actions">
          <button class="btn br-blocked-open">在新窗口中打开</button>
        </div>
      </div>`;
    pane.querySelector('.br-blocked-open').addEventListener('click', () => window.open(t.url, '_blank', 'noopener'));
    pane.classList.remove('is-loading');
  }

  /**
   * 渲染新标签页
   * @param {HTMLElement} pane
   * @param {Tab} t 所属标签（磁贴点击需要它来导航）
   */
  function renderNewTabPage(pane, t) {
    pane.innerHTML = `
      <div class="br-newtab">
        <div class="br-newtab-logo">WindowsNext</div>
        <form class="br-newtab-form">
          <input class="br-newtab-input" type="text" placeholder="搜索或输入网址" autofocus>
          <button type="submit" class="br-newtab-go">→</button>
        </form>
        <div class="br-newtab-grid"></div>
      </div>`;
    const grid = pane.querySelector('.br-newtab-grid');
    for (const b of bookmarks) {
      const tile = document.createElement('button');
      tile.className = 'br-newtab-tile';
      tile.type = 'button';
      tile.innerHTML = `${getIcon('browser', 24)}<span>${escapeHtml(b.name)}</span>`;
      tile.addEventListener('click', () => navigate(t, b.url));
      grid.appendChild(tile);
    }

    const form = pane.querySelector('.br-newtab-form');
    const input = pane.querySelector('.br-newtab-input');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      navigate(t, input.value);
    });
    setTimeout(() => input.focus(), 100);
  }

  function reload(t) {
    if (!t) return;
    if (t.url === 'about:newtab') return;
    t.iframe?.remove();
    t.iframe = null;
    load(t, t.url);
  }

  function closeTab(t) {
    const idx = tabs.indexOf(t);
    if (idx < 0) return;
    tabs.splice(idx, 1);
    if (t.iframe) t.iframe.remove();
    t.pane?.remove();
    if (t === active) {
      active = tabs[idx] || tabs[idx - 1] || null;
      if (active) activate(active);
      else openInNewTab('about:newtab');
    }
    renderTabs();
  }

  function closeOthers(t) {
    while (tabs.length) {
      const other = tabs.pop();
      if (other !== t) {
        other.iframe?.remove();
        other.pane?.remove();
      }
    }
    tabs.push(t);
    active = t;
    renderTabs();
    activate(t);
  }

  function navigate(t, raw) {
    const url = normalizeUrl(raw);
    load(t, url);
  }

  // ── 工具栏事件 ─────────────────────────────────────────
  root.querySelector('.br-back').addEventListener('click', () => {
    if (!active || active.cursor <= 0) return;
    active.cursor--;
    active.url = active.history[active.cursor];
    active.iframe?.remove();
    active.iframe = null;
    ensurePane(active).classList.add('is-active');
    load(active, active.url);
  });
  root.querySelector('.br-forward').addEventListener('click', () => {
    if (!active || active.cursor >= active.history.length - 1) return;
    active.cursor++;
    active.url = active.history[active.cursor];
    active.iframe?.remove();
    active.iframe = null;
    ensurePane(active).classList.add('is-active');
    load(active, active.url);
  });
  root.querySelector('.br-reload').addEventListener('click', () => active && reload(active));
  root.querySelector('.br-home').addEventListener('click', () => active && navigate(active, 'about:newtab'));
  root.querySelector('.br-new').addEventListener('click', () => openInNewTab('about:newtab'));

  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!active) return;
      const url = addressInput.value.trim();
      navigate(active, url);
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 't') { e.preventDefault(); openInNewTab('about:newtab'); }
    else if (e.ctrlKey && e.key === 'w' && active) { e.preventDefault(); closeTab(active); }
    else if (e.ctrlKey && e.key === 'l') { e.preventDefault(); addressInput.focus(); addressInput.select(); }
    else if (e.key === 'F5' && active) { e.preventDefault(); reload(active); }
  });

  // 启动
  await openInNewTab('about:newtab');

  ctx.setPreviewProvider(() => active ? (active.title || active.url) : '');
}

function normalizeUrl(input) {
  if (!input) return 'about:newtab';
  const s = input.trim();
  // 已经是协议 / 新标签 / 本地协议
  if (/^(https?:|file:|about:|data:|blob:)/.test(s)) return s;
  // 形如 c:/path 或本地盘符
  if (/^[a-zA-Z]:[\\/]/.test(s)) return `file:///${s.replace(/\\/g, '/')}`;
  // 形如 example.com / www.foo.bar / foo.cn
  if (/^[\w-]+(\.[\w-]+)+/.test(s) && !/\s/.test(s)) return 'https://' + s;
  // 否则交给搜索引擎
  return `https://cn.bing.com/search?q=${encodeURIComponent(s)}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}