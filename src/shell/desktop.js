import { getIcon, getIconAsImg } from '../ui/icons.js';

/**
 * 桌面管理器：壁纸层（纯色/渐变/图片/视频/HTML）与桌面图标
 */
export class Desktop {
  constructor(wm, fs, settings, apps) {
    this.wm = wm;
    this.fs = fs;
    this.settings = settings;
    this.apps = apps;
    this.layer = document.getElementById('wallpaper-layer');
    this.iconsEl = document.getElementById('desktop-icons');
    this.ctxMenu = document.getElementById('context-menu');
    this.currentHandle = null;

    settings.bus.on('settings:changed', s => this._applyWallpaper(s.wallpaper));
    this._applyWallpaper(settings.get('wallpaper'));
    this._renderIcons();
    this._bindEvents();
  }

  _applyWallpaper(w) {
    this.layer.innerHTML = '';
    this.layer.style.backgroundImage = '';
    this.layer.style.backgroundColor = '';
    if (!w) return;
    if (w.type === 'color') {
      this.layer.style.backgroundColor = w.value;
    } else if (w.type === 'gradient') {
      this.layer.style.background = w.value;
    } else if (w.type === 'image') {
      this.layer.style.backgroundImage = `url(${w.src})`;
    } else if (w.type === 'video') {
      const v = document.createElement('video');
      v.src = w.src; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
      this.layer.appendChild(v);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) v.pause(); else v.play().catch(() => {});
      });
    } else if (w.type === 'html') {
      const iframe = document.createElement('iframe');
      iframe.src = w.src;
      iframe.setAttribute('sandbox', 'allow-scripts');
      this.layer.appendChild(iframe);
    }
  }

  _renderIcons() {
    this.iconsEl.innerHTML = '';
    const ids = this.settings.get('desktopIcons') || [];
    for (const id of ids) {
      const app = this.apps[id];
      if (!app) continue;
      const el = document.createElement('div');
      el.className = 'desktop-icon';
      el.innerHTML = `<div class="icon-img">${getIcon(app.icon, 44)}</div><div class="icon-label">${app.name}</div>`;
      el.addEventListener('dblclick', () => this.wm.open({ appId: id, ...app.open() }));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContext(e.clientX, e.clientY, [
          { label: '打开', action: () => this.wm.open({ appId: id, ...app.open() }) },
          { label: '从桌面移除', action: () => {
            const list = this.settings.get('desktopIcons').filter(x => x !== id);
            this.settings.set({ desktopIcons: list });
            this._renderIcons();
          }},
        ]);
      });
      this.iconsEl.appendChild(el);
    }
  }

  _bindEvents() {
    document.addEventListener('click', () => this._hideContext());
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.desktop-icon') || e.target.closest('.window') || e.target.closest('.taskbar')) return;
      e.preventDefault();
      this._showContext(e.clientX, e.clientY, [
        { label: '刷新', action: () => this._renderIcons() },
        { label: '更改壁纸', action: () => this.wm.open({ appId: 'settings', ...this.apps.settings.open({ page: 'personalization' }) }) },
        { divider: true },
        { label: '新建文件夹', action: async () => {
          const dir = this.fs.normalizeDocPath();
          await this.fs.mkdir(`${dir}/New Folder ${Date.now()}`);
        }},
      ]);
    });
  }

  _showContext(x, y, items) {
    this.ctxMenu.innerHTML = '';
    for (const it of items) {
      if (it.divider) {
        const d = document.createElement('div'); d.className = 'context-divider'; this.ctxMenu.appendChild(d);
      } else {
        const el = document.createElement('div');
        el.className = 'context-item';
        el.textContent = it.label;
        el.addEventListener('click', () => { it.action(); this._hideContext(); });
        this.ctxMenu.appendChild(el);
      }
    }
    this.ctxMenu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
    this.ctxMenu.style.top = `${Math.min(y, window.innerHeight - this.ctxMenu.offsetHeight - 20)}px`;
    this.ctxMenu.classList.remove('hidden');
  }

  _hideContext() { this.ctxMenu.classList.add('hidden'); }
}
