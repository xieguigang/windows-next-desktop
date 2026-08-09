/**
 * PWA 应用宿主
 *
 * 用于将任意网页以独立窗口形式运行，模拟 PWA 体验。
 * 启动参数：
 *   - url:     目标网址（必填）
 *   - title:   窗口标题
 *   - icon:    窗口图标名称
 *
 * 此模块被浏览器"安装为应用"功能动态注册后调用。
 */

import { getIcon } from '../../ui/icons.js';

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./browser.css', import.meta.url).href);

  const url = ctx.args?.url;
  if (!url) {
    ctx.root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:14px;">未提供目标网址</div>';
    return;
  }

  const root = document.createElement('div');
  root.className = 'br-root';
  root.innerHTML = `
    <div class="br-toolbar" style="border-top:0;padding:6px 10px;">
      <button class="br-btn br-back" title="后退" aria-label="后退">${getIcon('chevronLeft', 16)}</button>
      <button class="br-btn br-forward" title="前进" aria-label="前进">${getIcon('chevronRight', 16)}</button>
      <button class="br-btn br-reload" title="刷新" aria-label="刷新">${getIcon('refresh', 16)}</button>
      <input class="br-address" type="text" value="${escapeAttr(url)}" spellcheck="false" autocomplete="off" aria-label="地址" style="font-size:12px;">
    </div>
    <div class="br-panes" style="flex:1;">
      <div class="br-pane is-active" style="position:relative;">
        <iframe class="br-iframe" src="${escapeAttr(url)}" referrerpolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          style="width:100%;height:100%;border:0;background:white;"></iframe>
      </div>
    </div>
  `;
  ctx.root.appendChild(root);

  const addressInput = root.querySelector('.br-address');
  const iframe = root.querySelector('.br-iframe');
  const pane = root.querySelector('.br-pane');

  let history = [url];
  let cursor = 0;

  // 加载进度条
  pane.classList.add('is-loading');
  iframe.addEventListener('load', () => {
    pane.classList.remove('is-loading');
    try {
      const doc = iframe.contentDocument;
      if (doc && doc.title) {
        ctx.window.setTitle(doc.title);
      }
    } catch {
      // 跨域无法读取 title，保持原样
    }
  });

  // 超时兜底
  const blockedTimeout = window.setTimeout(() => {
    if (pane.classList.contains('is-loading')) {
      pane.classList.remove('is-loading');
    }
  }, 12000);
  iframe.addEventListener('load', () => window.clearTimeout(blockedTimeout), { once: true });

  function syncNav() {
    root.querySelector('.br-back').disabled = cursor <= 0;
    root.querySelector('.br-forward').disabled = cursor >= history.length - 1;
    addressInput.value = history[cursor];
  }

  function navigate(rawUrl) {
    const normalized = normalizeUrl(rawUrl);
    if (history[cursor] === normalized) {
      iframe.src = normalized;
      pane.classList.add('is-loading');
      return;
    }
    history = history.slice(0, cursor + 1);
    history.push(normalized);
    cursor++;
    iframe.src = normalized;
    pane.classList.add('is-loading');
    syncNav();
  }

  root.querySelector('.br-back').addEventListener('click', () => {
    if (cursor <= 0) return;
    cursor--;
    iframe.src = history[cursor];
    pane.classList.add('is-loading');
    syncNav();
  });
  root.querySelector('.br-forward').addEventListener('click', () => {
    if (cursor >= history.length - 1) return;
    cursor++;
    iframe.src = history[cursor];
    pane.classList.add('is-loading');
    syncNav();
  });
  root.querySelector('.br-reload').addEventListener('click', () => {
    iframe.src = iframe.src;
    pane.classList.add('is-loading');
  });

  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigate(addressInput.value.trim());
    }
  });

  syncNav();

  ctx.setPreviewProvider(() => {
    try {
      return iframe.contentDocument?.title || url;
    } catch {
      return url;
    }
  });

  ctx.onDispose(() => {
    window.clearTimeout(blockedTimeout);
  });
}

function normalizeUrl(input) {
  if (!input) return '';
  const s = input.trim();
  if (/^(https?:|file:|about:|data:|blob:)/.test(s)) return s;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return `file:///${s.replace(/\\/g, '/')}`;
  if (/^[\w-]+(\.[\w-]+)+/.test(s) && !/\s/.test(s)) return 'https://' + s;
  return `https://cn.bing.com/search?q=${encodeURIComponent(s)}`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
