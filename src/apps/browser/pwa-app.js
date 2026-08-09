/**
 * PWA 应用宿主
 *
 * 用于将任意网页以独立窗口形式运行，模拟 PWA 体验。
 * 不显示浏览器导航栏，iframe 直接填满整个窗口内容区。
 *
 * 启动参数：
 *   - url:     目标网址（必填）
 *   - title:   窗口标题
 */

export default async function mount(ctx) {
  const url = ctx.args?.url;
  if (!url) {
    ctx.root.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:14px;">未提供目标网址</div>';
    return;
  }

  // 注入 PWA 专用样式（极简，不引入 browser.css 避免样式干扰）
  ctx.injectStyle(`
    .pwa-root {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      background: var(--bg-surface);
      overflow: hidden;
    }
    .pwa-iframe-wrap {
      flex: 1 1 0;
      min-height: 0;
      position: relative;
    }
    .pwa-iframe-wrap::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
      animation: pwa-loading-bar 1.2s linear infinite;
      z-index: 2;
      pointer-events: none;
      display: none;
    }
    .pwa-iframe-wrap.is-loading::after {
      display: block;
    }
    @keyframes pwa-loading-bar {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(100%);  }
    }
    .pwa-iframe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 0;
      background: #fff;
    }
  `, 'pwa-styles');

  const root = document.createElement('div');
  root.className = 'pwa-root';
  root.innerHTML = `
    <div class="pwa-iframe-wrap is-loading">
      <iframe class="pwa-iframe" src="${escapeAttr(url)}"
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        allow="fullscreen"
        loading="eager"></iframe>
    </div>`;
  ctx.root.appendChild(root);

  const wrap = root.querySelector('.pwa-iframe-wrap');
  const iframe = root.querySelector('.pwa-iframe');

  // 超时隐藏 loading bar
  const blockedTimeout = window.setTimeout(() => {
    wrap.classList.remove('is-loading');
  }, 15000);

  iframe.addEventListener('load', () => {
    wrap.classList.remove('is-loading');
    window.clearTimeout(blockedTimeout);
    // 尝试读取页面标题作为窗口标题
    try {
      const doc = iframe.contentDocument;
      if (doc?.title) ctx.window.setTitle(doc.title);
    } catch {
      // 跨域时忽略
    }
  });

  // 错误处理：iframe 加载失败时至少去掉 loading 状态
  iframe.addEventListener('error', () => {
    wrap.classList.remove('is-loading');
    window.clearTimeout(blockedTimeout);
  });

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

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
