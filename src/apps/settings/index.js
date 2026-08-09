/**
 * 设置
 *
 * 左侧分类导航 + 右侧面板：个性化 / 系统 / 应用 / 存储 / 关于。
 * 设置项直接绑定 settings.getLocal/setLocal，所见即所得。
 *
 * 特殊能力：
 *   - 壁纸模式切换（图片 / 视频 / HTML）+ 文件选择 → 写 settings.wallpaper.*，由 wallpaper 引擎实时响应
 *   - 主题色：实时写 CSS 变量 --accent
 *   - Aero 模糊/饱和/透明度滑块：实时改 CSS 变量
 *   - 主题（亮/暗）：切 :root[data-theme]
 *   - 存储：显示 VFS 大小、一键清空
 */

import { fileSystem, SHELL_FOLDERS } from '../../core/fs/fs-service.js';
import * as P from '../../core/fs/path-utils.js';
import { LocalStore } from '../../core/storage.js';
import { appRegistry } from '../../core/app-registry.js';
import { wallpaper } from '../../shell/wallpaper.js';
import { notifications } from '../../core/notification.js';

const SECTIONS = [
  { id: 'personalization', label: '个性化', icon: 'palette' },
  { id: 'system', label: '系统', icon: 'settings' },
  { id: 'apps', label: '应用', icon: 'grid' },
  { id: 'storage', label: '存储', icon: 'hdd' },
  { id: 'about', label: '关于', icon: 'info' },
];

const THEME_OPTIONS = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];
const ACCENT_PRESETS = ['#0078D4', '#0067C0', '#5C5DDE', '#107C10', '#CA5010', '#9D5D00', '#D13438', '#8764B8'];

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./settings.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'st-root';
  root.innerHTML = `
    <aside class="st-nav">
      <h3>设置</h3>
      ${SECTIONS.map((s) => `
        <button data-section="${s.id}">
          <span class="st-nav-icon"></span>
          <span>${s.label}</span>
        </button>`).join('')}
    </aside>
    <main class="st-main"></main>`;
  ctx.root.appendChild(root);

  const navEl = root.querySelector('.st-nav');
  const mainEl = root.querySelector('.st-main');

  let section = ctx.args?.section || 'personalization';

  navEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-section]');
    if (!btn) return;
    section = btn.dataset.section;
    render();
  });

  for (const s of SECTIONS) {
    const iconBtn = navEl.querySelector(`button[data-section="${s.id}"] .st-nav-icon`);
    if (iconBtn) iconBtn.dataset.icon = s.icon;
  }

  function render() {
    for (const btn of navEl.querySelectorAll('button[data-section]')) {
      btn.classList.toggle('is-active', btn.dataset.section === section);
    }
    mainEl.innerHTML = '';
    if (section === 'personalization') return renderPersonalization(mainEl);
    if (section === 'system') return renderSystem(mainEl);
    if (section === 'apps') return renderApps(mainEl);
    if (section === 'storage') return renderStorage(mainEl);
    if (section === 'about') return renderAbout(mainEl);
  }

  /* ============================================================
     个性化
     ============================================================ */

  function renderPersonalization(container) {
    const wallpaperCfg = {
      mode: ctx.settings.get('wallpaper.mode') || 'gradient',
      imageSrc: ctx.settings.get('wallpaper.imageSrc') || '',
      videoSrc: ctx.settings.get('wallpaper.videoSrc') || '',
      videoMuted: ctx.settings.get('wallpaper.videoMuted') !== false,
      htmlSrc: ctx.settings.get('wallpaper.htmlSrc') || '',
    };

    container.innerHTML = `
      <h2>个性化</h2>

      <section class="st-section">
        <h4>主题</h4>
        <div class="st-row">
          <span>外观模式</span>
          <div class="st-segmented">
            ${THEME_OPTIONS.map((o) => `
              <button data-theme="${o.id}" class="${ctx.settings.get('appearance.theme') === o.id ? 'is-active' : ''}">${o.label}</button>`).join('')}
          </div>
        </div>
        <div class="st-row">
          <span>主题色</span>
          <div class="st-swatches">
            ${ACCENT_PRESETS.map((c) => `
              <button class="st-swatch ${ctx.settings.get('appearance.accent') === c ? 'is-active' : ''}" data-accent="${c}" style="background:${c}"></button>`).join('')}
          </div>
        </div>
      </section>

      <section class="st-section">
        <h4>壁纸</h4>
        <div class="st-row">
          <span>壁纸模式</span>
          <div class="st-segmented">
            <button data-wp="gradient" class="${wallpaperCfg.mode === 'gradient' ? 'is-active' : ''}">渐变</button>
            <button data-wp="image" class="${wallpaperCfg.mode === 'image' ? 'is-active' : ''}">图片</button>
            <button data-wp="video" class="${wallpaperCfg.mode === 'video' ? 'is-active' : ''}">视频</button>
            <button data-wp="html" class="${wallpaperCfg.mode === 'html' ? 'is-active' : ''}">HTML</button>
          </div>
        </div>
        <div class="st-row" data-wp-pane="image">
          <span>图片来源</span>
          <div class="st-file-row">
            <input class="st-input" type="text" placeholder="http(s)://... 或 C:/... 或 C:/...#image" value="${escapeHtml(wallpaperCfg.imageSrc)}" data-wp-input="imageSrc">
            <button class="btn" data-wp-pick="image">选择</button>
            <button class="btn" data-wp-clear="imageSrc">清空</button>
          </div>
        </div>
        <div class="st-row" data-wp-pane="video">
          <span>视频源</span>
          <div class="st-file-row">
            <input class="st-input" type="text" placeholder="mp4 URL 或本地路径" value="${escapeHtml(wallpaperCfg.videoSrc)}" data-wp-input="videoSrc">
            <button class="btn" data-wp-pick="video">选择</button>
            <button class="btn" data-wp-clear="videoSrc">清空</button>
          </div>
        </div>
        <div class="st-row" data-wp-pane="video">
          <span>静音</span>
          <label class="st-switch"><input type="checkbox" data-wp-muted ${wallpaperCfg.videoMuted ? 'checked' : ''}><span></span></label>
        </div>
        <div class="st-row" data-wp-pane="html">
          <span>HTML 源</span>
          <div class="st-file-row">
            <input class="st-input" type="text" placeholder="HTML URL 或 C:/..." value="${escapeHtml(wallpaperCfg.htmlSrc)}" data-wp-input="htmlSrc">
            <button class="btn" data-wp-pick="html">选择</button>
            <button class="btn" data-wp-clear="htmlSrc">清空</button>
          </div>
        </div>
        <div class="st-row">
          <span></span>
          <div class="st-wallpaper-preview" id="wp-preview"></div>
        </div>
      </section>

      <section class="st-section">
        <h4>Aero 效果</h4>
        <div class="st-row st-slider-row">
          <span>模糊半径 <em data-val="blur">${ctx.settings.get('appearance.aeroBlur') || 30}</em>px</span>
          <input type="range" min="0" max="60" step="1" value="${ctx.settings.get('appearance.aeroBlur') || 30}" data-aero="blur">
        </div>
        <div class="st-row st-slider-row">
          <span>饱和度 <em data-val="saturate">${Math.round((ctx.settings.get('appearance.aeroSaturate') || 1.8) * 100)}</em>%</span>
          <input type="range" min="100" max="300" step="5" value="${Math.round((ctx.settings.get('appearance.aeroSaturate') || 1.8) * 100)}" data-aero="saturate">
        </div>
        <div class="st-row st-slider-row">
          <span>底色透明度 <em data-val="opacity">${Math.round((ctx.settings.get('appearance.aeroOpacity') || 0.62) * 100)}</em>%</span>
          <input type="range" min="20" max="95" step="1" value="${Math.round((ctx.settings.get('appearance.aeroOpacity') || 0.62) * 100)}" data-aero="opacity">
        </div>
      </section>
    `;

    // 主题
    container.querySelectorAll('[data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ctx.settings.set('appearance.theme', btn.dataset.theme);
        document.documentElement.dataset.theme = btn.dataset.theme;
        for (const b of container.querySelectorAll('[data-theme]')) b.classList.toggle('is-active', b === btn);
      });
    });

    // 主题色
    container.querySelectorAll('[data-accent]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ctx.settings.set('appearance.accent', btn.dataset.accent);
        for (const b of container.querySelectorAll('[data-accent]')) b.classList.toggle('is-active', b === btn);
      });
    });

    // 壁纸模式
    container.querySelectorAll('[data-wp]').forEach((btn) => {
      btn.addEventListener('click', () => {
        wallpaperCfg.mode = btn.dataset.wp;
        ctx.settings.set('wallpaper.mode', wallpaperCfg.mode);
        for (const b of container.querySelectorAll('[data-wp]')) b.classList.toggle('is-active', b === btn);
        showWPPane();
        updatePreview();
      });
    });
    function showWPPane() {
      for (const pane of container.querySelectorAll('[data-wp-pane]')) {
        pane.hidden = pane.dataset.wpPane !== wallpaperCfg.mode;
      }
    }
    showWPPane();

    // 输入
    container.querySelectorAll('[data-wp-input]').forEach((input) => {
      input.addEventListener('change', () => {
        wallpaperCfg[input.dataset.wpInput] = input.value.trim();
        ctx.settings.set(`wallpaper.${input.dataset.wpInput}`, wallpaperCfg[input.dataset.wpInput]);
        updatePreview();
      });
    });
    container.querySelectorAll('[data-wp-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.wpClear;
        wallpaperCfg[k] = '';
        ctx.settings.set(`wallpaper.${k}`, '');
        const input = container.querySelector(`[data-wp-input="${k}"]`);
        if (input) input.value = '';
        updatePreview();
      });
    });
    container.querySelectorAll('[data-wp-pick]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const kind = btn.dataset.wpPick;
        try {
          const res = await ctx.fs.pick({ mode: 'open', accept: kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : 'text/html' });
          if (res?.path) {
            const key = `${kind}Src`;
            wallpaperCfg[key] = res.path;
            ctx.settings.set(`wallpaper.${key}`, res.path);
            const input = container.querySelector(`[data-wp-input="${key}"]`);
            if (input) input.value = res.path;
            updatePreview();
          }
        } catch (err) {
          if (err?.name !== 'AbortError') ctx.notify.warning('选择失败：' + (err?.message || err));
        }
      });
    });
    container.querySelector('[data-wp-muted]').addEventListener('change', (e) => {
      wallpaperCfg.videoMuted = e.target.checked;
      ctx.settings.set('wallpaper.videoMuted', wallpaperCfg.videoMuted);
    });

    function updatePreview() {
      const box = container.querySelector('#wp-preview');
      if (!box) return;
      box.className = 'st-wallpaper-preview';
      if (wallpaperCfg.mode === 'gradient') {
        box.style.background = 'var(--wallpaper-fallback)';
        box.textContent = '默认深蓝紫渐变';
      } else if (wallpaperCfg.mode === 'image' && wallpaperCfg.imageSrc) {
        box.style.background = `center/cover url("${wallpaperCfg.imageSrc}")`;
        box.textContent = '';
      } else if (wallpaperCfg.mode === 'video' && wallpaperCfg.videoSrc) {
        box.style.background = '#000';
        box.textContent = `▶ ${wallpaperCfg.videoSrc}`;
      } else if (wallpaperCfg.mode === 'html' && wallpaperCfg.htmlSrc) {
        box.style.background = 'linear-gradient(135deg, #1a1a2e, #4c1d95)';
        box.textContent = `HTML 源：${wallpaperCfg.htmlSrc}`;
      } else {
        box.style.background = 'var(--bg-elev)';
        box.textContent = '（尚未配置）';
      }
    }
    updatePreview();

    // Aero 滑块
    container.querySelectorAll('[data-aero]').forEach((slider) => {
      slider.addEventListener('input', () => {
        const k = slider.dataset.aero;
        const v = Number(slider.value);
        let normalized = v;
        if (k === 'saturate' || k === 'opacity') normalized = v / (k === 'saturate' ? 100 : 100);
        ctx.settings.set(`appearance.aero${k.charAt(0).toUpperCase() + k.slice(1)}`, normalized);
        const label = container.querySelector(`[data-val="${k}"]`);
        if (label) label.textContent = k === 'blur' ? v : `${v}`;
      });
    });
  }

  /* ============================================================
     系统
     ============================================================ */

  function renderSystem(container) {
    container.innerHTML = `
      <h2>系统</h2>

      <section class="st-section">
        <h4>界面</h4>
        <div class="st-row">
          <span>任务栏图标</span>
          <div class="st-segmented">
            <button data-taskbar-align="left" class="${ctx.settings.get('taskbar.align') === 'left' ? 'is-active' : ''}">左对齐</button>
            <button data-taskbar-align="center" class="${ctx.settings.get('taskbar.align') !== 'left' ? 'is-active' : ''}">居中</button>
          </div>
        </div>
        <div class="st-row">
          <span>显示任务栏缩略图</span>
          <label class="st-switch"><input type="checkbox" data-show-preview ${ctx.settings.get('taskbar.showPreview') !== false ? 'checked' : ''}><span></span></label>
        </div>
      </section>

      <section class="st-section">
        <h4>通知</h4>
        <div class="st-row">
          <span>显示通知</span>
          <label class="st-switch"><input type="checkbox" data-notifications ${ctx.settings.get('system.notifications') !== false ? 'checked' : ''}><span></span></label>
        </div>
        <div class="st-row">
          <span>退出前确认</span>
          <label class="st-switch"><input type="checkbox" data-confirm-exit ${ctx.settings.get('system.confirmExit') ? 'checked' : ''}><span></span></label>
        </div>
      </section>

      <section class="st-section">
        <h4>辅助</h4>
        <div class="st-row">
          <span>键盘导航</span>
          <span class="st-hint">Alt+Tab 切换 · Ctrl+Esc/Win 打开开始菜单 · Ctrl+方向键 Snap</span>
        </div>
        <div class="st-row">
          <span>重置所有设置</span>
          <button class="btn" data-reset>恢复默认</button>
        </div>
      </section>
    `;

    container.querySelectorAll('[data-taskbar-align]').forEach((b) => {
      b.addEventListener('click', () => {
        ctx.settings.set('taskbar.align', b.dataset.taskbarAlign);
        for (const other of container.querySelectorAll('[data-taskbar-align]')) other.classList.toggle('is-active', other === b);
      });
    });
    container.querySelector('[data-show-preview]').addEventListener('change', (e) => ctx.settings.set('taskbar.showPreview', e.target.checked));
    container.querySelector('[data-notifications]').addEventListener('change', (e) => ctx.settings.set('system.notifications', e.target.checked));
    container.querySelector('[data-confirm-exit]').addEventListener('change', (e) => ctx.settings.set('system.confirmExit', e.target.checked));

    container.querySelector('[data-reset]').addEventListener('click', async () => {
      const ok = await ctx.dialog.confirm('确定要恢复所有设置为默认值吗？', '重置', { okLabel: '重置' });
      if (!ok) return;
      ctx.settings.reset();
      ctx.notify.success('设置已重置');
      render();
    });
  }

  /* ============================================================
     应用
     ============================================================ */

  function renderApps(container) {
    const apps = appRegistry.getAll();
    container.innerHTML = `
      <h2>应用</h2>
      <section class="st-section">
        <h4>已注册应用 <span class="st-hint">(${apps.length})</span></h4>
        <div class="st-app-list">
          ${apps.map((a) => `
            <div class="st-app-item">
              <div class="st-app-meta">
                <strong>${escapeHtml(a.name)}</strong>
                <span class="st-hint">${escapeHtml(a.id)} · ${escapeHtml(a.category || '通用')}</span>
              </div>
              <span class="st-app-exts">${a.fileExtensions?.length ? '关联：' + a.fileExtensions.map((e) => '.' + e).join(' ') : ''}</span>
            </div>`).join('')}
        </div>
      </section>
    `;
  }

  /* ============================================================
     存储
     ============================================================ */

  async function renderStorage(container) {
    container.innerHTML = `
      <h2>存储</h2>
      <section class="st-section">
        <h4>本地存储使用</h4>
        <div class="st-storage-stats" data-storage>正在计算…</div>
        <div class="st-row">
          <span></span>
          <button class="btn" data-clear>清空虚拟磁盘</button>
        </div>
      </section>
    `;
    const stats = container.querySelector('[data-storage]');
    try {
      const usage = await estimateUsage();
      stats.innerHTML = `
        <div class="st-stat-row"><span>虚拟盘 C: 文件</span><strong>${usage.files}</strong></div>
        <div class="st-stat-row"><span>虚拟盘 C: 占用</span><strong>${P.formatSize(usage.bytes)}</strong></div>
        <div class="st-stat-row"><span>localStorage</span><strong>${P.formatSize(usage.lsBytes)}</strong></div>
        <div class="st-stat-row"><span>IndexedDB</span><strong>${P.formatSize(usage.idbBytes)}</strong></div>
      `;
    } catch (err) {
      stats.textContent = '无法计算：' + err.message;
    }
    container.querySelector('[data-clear]').addEventListener('click', async () => {
      const ok = await ctx.dialog.confirm('将清空 C: 盘中所有用户文件，此操作不可撤销。', '清空虚拟磁盘', { okLabel: '清空' });
      if (!ok) return;
      const store = new LocalStore('vfs');
      store.set('tree', { type: 'directory', name: '', children: {} });
      // 清空 IndexedDB 文件内容
      try {
        const { idb, STORES } = await import('../../core/storage.js');
        await idb.clear(STORES.FILES);
        await idb.clear(STORES.BLOBS);
      } catch { /* ignore */ }
      ctx.notify.success('虚拟磁盘已清空');
      render();
    });
  }

  async function estimateUsage() {
    const stats = { files: 0, bytes: 0, lsBytes: 0, idbBytes: 0 };
    const recurse = async (path) => {
      const entries = await fileSystem.readDir(path);
      for (const e of entries) {
        if (e.type === 'directory') await recurse(e.path);
        else { stats.files++; stats.bytes += e.size || 0; }
      }
    };
    try { await recurse(SHELL_FOLDERS.home); } catch { /* 忽略 */ }

    try {
      stats.lsBytes = new Blob([JSON.stringify(localStorage)]).size;
    } catch { /* 忽略 */ }

    try {
      const { idb, openDB } = await import('../../core/storage.js');
      const db = await openDB();
      for (const storeName of ['files', 'handles', 'blobs']) {
        if (!db.objectStoreNames.contains(storeName)) continue;
        const tx = db.transaction(storeName, 'readonly');
        const cursor = tx.objectStore(storeName).openCursor();
        await new Promise((resolve) => {
          cursor.onsuccess = (e) => {
            const c = e.target.result;
            if (c) {
              stats.idbBytes += (c.value?.byteLength || c.value?.size || 0);
              c.continue();
            } else resolve();
          };
          cursor.onerror = () => resolve();
        });
      }
    } catch { /* 忽略 */ }
    return stats;
  }

  /* ============================================================
     关于
     ============================================================ */

  function renderAbout(container) {
    container.innerHTML = `
      <h2>关于</h2>
      <section class="st-section">
        <div class="st-about-logo">WindowsNext</div>
        <p class="st-about-desc">纯 HTML + 原生 ES Modules 构建的浏览器内桌面操作系统。Windows 11 Fluent 视觉叠加 Windows 7 Aero 毛玻璃质感。</p>
        <div class="st-about-meta">
          <div><strong>版本</strong> 1.0.0</div>
          <div><strong>用户</strong> ${escapeHtml(ctx.settings.get('system.userName') || 'User')}</div>
          <div><strong>分辨率</strong> ${window.innerWidth} × ${window.innerHeight}</div>
          <div><strong>浏览器</strong> ${escapeHtml(navigator.userAgent.split(' ').slice(-2).join(' '))}</div>
        </div>
        <div class="st-row">
          <span></span>
          <button class="btn" data-clear-shortcuts>清空快捷方式自定义</button>
        </div>
      </section>
    `;
    container.querySelector('[data-clear-shortcuts]').addEventListener('click', () => {
      new LocalStore('desktop').set('extraShortcuts', []);
      new LocalStore('desktop').set('hiddenShortcuts', []);
      ctx.notify.success('已清空');
    });
  }

  // 初次渲染
  render();

  ctx.setPreviewProvider(() => `设置 · ${SECTIONS.find((s) => s.id === section)?.label || ''}`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}