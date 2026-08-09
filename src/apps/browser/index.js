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

  /** @type {Tab[]} */
  const tabs = [];
  let active = null;
  let tabSeq = 0;

  const defaults = [
    { name: 'WindowsNext', url: 'about:newtab' },
    { name: '必应', url: 'https://cn.bing.com/' },
    { name: '维基百科', url: 'https://zh.wikipedia.org/' },
  ];

  /** 用户书签（持久化） */
  const bookmarks = ctx.settings.getLocal('bookmarks', defaults);

  function renderBookmarks() {
    bookmarksEl.innerHTML = '';
    for (const b of bookmarks) {
      const a = document.createElement('a');
      a.className = 'br-bookmark';
      a.href = '#';
      a.textContent = b.name;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        navigate(active, b.url);
      });
      a.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        import('../../shell/context-menu.js').then(({ contextMenu }) => {
          contextMenu.open([
            { id: 'open', label: '打开', icon: 'add', onClick: () => openInNewTab(b.url) },
            {
              id: 'remove',
              label: '删除书签',
              icon: 'delete',
              onClick: () => {
                const idx = bookmarks.indexOf(b);
                if (idx >= 0) bookmarks.splice(idx, 1);
                ctx.settings.setLocal('bookmarks', bookmarks);
                renderBookmarks();
              },
            },
          ], e.clientX, e.clientY);
        });
      });
      bookmarksEl.appendChild(a);
    }
  }
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
    if (t.url === 'about:newtab') {
      renderNewTabPage(ensurePane(t));
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

    const pane = ensurePane(t);
    pane.innerHTML = '';
    pane.classList.add('is-loading');

    if (url === 'about:newtab') {
      pane.classList.remove('is-loading');
      renderNewTabPage(pane);
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

  function renderNewTabPage(pane) {
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