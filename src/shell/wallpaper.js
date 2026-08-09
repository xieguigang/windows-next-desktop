/**
 * 壁纸引擎
 *
 * 三种模式：
 *  - gradient  CSS 渐变兜底（零资源依赖）
 *  - image     静态图片，支持 cover/contain/fill/tile/center 填充方式
 *  - video     MP4 动态壁纸，带静音切换、循环播放
 *  - html      HTML 页面壁纸，用 sandbox iframe 隔离，防止其脚本影响桌面
 *
 * 省电策略：页面隐藏、或存在最大化窗口（壁纸被完全遮挡）时暂停视频解码。
 */

import bus from '../core/event-bus.js';
import settings from '../core/settings-store.js';
import { createLogger } from '../core/logger.js';
import { getIcon } from '../ui/icons.js';
import fileSystem from '../core/fs/fs-service.js';
import { idb, STORES } from '../core/storage.js';

const log = createLogger('Wallpaper');

class WallpaperEngine {
  constructor() {
    /** @type {HTMLElement|null} */
    this.layer = null;
    /** @type {HTMLElement|null} 当前承载媒体的元素 */
    this.mediaEl = null;
    /** @type {HTMLElement|null} 视频静音切换按钮 */
    this.badgeEl = null;
    /** @type {(()=>void)|null} 当前资源的清理函数 */
    this._cleanup = null;
    this._occluded = false;
    this._mode = 'gradient';
  }

  /** @param {HTMLElement} layer */
  async init(layer) {
    this.layer = layer;

    // 存在最大化窗口时视频暂停（此时壁纸完全不可见）
    bus.on('wm:maximized-count-changed', ({ hasMaximized }) => {
      this._occluded = hasMaximized;
      this._syncPlayback();
    });

    document.addEventListener('visibilitychange', () => this._syncPlayback());

    // 设置变更实时生效
    settings.subscribe('wallpaper.*', (value, key) => {
      if (key === 'wallpaper.videoMuted' || key === 'wallpaper.videoVolume') {
        this._syncAudio();
        return;
      }
      if (key === 'wallpaper.imageFit') {
        if (this.mediaEl) this._applyFit(this.mediaEl);
        return;
      }
      this.apply();
    });

    await this.apply();
    log.info('壁纸引擎已就绪');
  }

  /** 根据当前设置渲染壁纸 */
  async apply() {
    const mode = settings.get('wallpaper.mode');
    this._teardown();
    this._mode = mode;
    this.layer.dataset.mode = mode;

    try {
      if (mode === 'image') await this._applyImage();
      else if (mode === 'video') await this._applyVideo();
      else if (mode === 'html') await this._applyHtml();
      else this._applyGradient();
    } catch (err) {
      log.error(`应用壁纸失败（模式 ${mode}）`, err);
      this._applyGradient();
      bus.emit('wallpaper:error', { mode, error: err });
    }

    bus.emit('wallpaper:changed', { mode });
  }

  /* ==========================================================
     各模式实现
     ========================================================== */

  _applyGradient() {
    this.layer.style.background = 'var(--wallpaper-fallback)';
    this.layer.classList.remove('is-tiled');
  }

  async _applyImage() {
    const src = await this._resolveSource(settings.get('wallpaper.imageUrl'));
    if (!src) { this._applyGradient(); return; }

    const fit = settings.get('wallpaper.imageFit');
    if (fit === 'tile') {
      this.layer.style.background = `url("${cssEscape(src)}")`;
      this.layer.classList.add('is-tiled');
      return;
    }

    this.layer.classList.remove('is-tiled');
    this.layer.style.background = 'var(--wallpaper-fallback)';

    const img = document.createElement('img');
    img.className = 'wallpaper-media';
    img.alt = '';
    img.decoding = 'async';
    img.dataset.fit = fit;
    img.addEventListener('error', () => {
      log.warn('壁纸图片加载失败，已回退到渐变背景');
      img.remove();
      this._applyGradient();
    });
    img.src = src;
    this.layer.appendChild(img);
    this.mediaEl = img;
  }

  async _applyVideo() {
    const src = await this._resolveSource(settings.get('wallpaper.videoUrl'));
    if (!src) { this._applyGradient(); return; }

    this.layer.classList.remove('is-tiled');
    this.layer.style.background = '#000';

    const video = document.createElement('video');
    video.className = 'wallpaper-media';
    video.dataset.fit = settings.get('wallpaper.imageFit') === 'contain' ? 'contain' : 'cover';
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = settings.get('wallpaper.videoMuted') !== false;
    video.volume = clamp01(settings.get('wallpaper.videoVolume'));
    video.preload = 'auto';
    video.addEventListener('error', () => {
      log.warn('壁纸视频加载失败，已回退到渐变背景');
      this._applyGradient();
    });
    video.src = src;
    this.layer.appendChild(video);
    this.mediaEl = video;

    // 浏览器可能因自动播放策略阻止非静音播放
    video.play().catch((err) => {
      if (!video.muted) {
        log.warn('非静音自动播放被浏览器阻止，已自动切换为静音', err);
        video.muted = true;
        settings.set('wallpaper.videoMuted', true);
        video.play().catch(() => {});
      }
    });

    this._buildVideoBadge(video);
    this._syncPlayback();
  }

  /** 视频壁纸右下角的静音切换胶囊 */
  _buildVideoBadge(video) {
    const badge = document.createElement('button');
    badge.className = 'wallpaper-video-badge';
    badge.type = 'button';
    const render = () => {
      const muted = video.muted;
      badge.innerHTML = `${getIcon(muted ? 'volumeMute' : 'volume', 14)}<span>${muted ? '已静音' : '有声'}</span>`;
      badge.title = muted ? '点击取消静音' : '点击静音';
      badge.setAttribute('aria-label', badge.title);
    };
    render();
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = !video.muted;
      settings.set('wallpaper.videoMuted', next);
      video.muted = next;
      if (!next) {
        video.volume = clamp01(settings.get('wallpaper.videoVolume'));
        video.play().catch(() => {
          video.muted = true;
          settings.set('wallpaper.videoMuted', true);
          render();
        });
      }
      render();
    });
    // 静音状态由设置驱动，外部改动也要同步图标
    const off = settings.subscribe('wallpaper.videoMuted', render);
    this._badgeOff = off;

    this.layer.appendChild(badge);
    this.badgeEl = badge;
  }

  async _applyHtml() {
    const url = settings.get('wallpaper.htmlUrl');
    if (!url) { this._applyGradient(); return; }

    this.layer.classList.remove('is-tiled');
    this.layer.style.background = 'var(--wallpaper-fallback)';

    const frame = document.createElement('iframe');
    frame.className = 'wallpaper-media';
    // sandbox 只给脚本权限，禁止其访问父页面 / 弹窗 / 表单提交
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('tabindex', '-1');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.pointerEvents = 'none';
    frame.addEventListener('error', () => {
      log.warn('HTML 壁纸加载失败');
      this._applyGradient();
    });
    frame.src = url;
    this.layer.appendChild(frame);
    this.mediaEl = frame;
  }

  /* ==========================================================
     资源解析
     ========================================================== */

  /**
   * 把设置里的来源解析为可用 URL：
   *  - `idb:<key>` → 从 IndexedDB 读取用户上传的 Blob
   *  - `C:/...`    → 从虚拟文件系统读取
   *  - 其余        → 直接当作 URL
   * @param {string} source
   * @returns {Promise<string>}
   */
  async _resolveSource(source) {
    const s = String(source || '').trim();
    if (!s) return '';

    if (s.startsWith('idb:')) {
      const key = s.slice(4);
      const blob = await idb.get(STORES.BLOBS, key);
      if (!blob) {
        log.warn(`本地壁纸资源已丢失：${key}`);
        return '';
      }
      const url = URL.createObjectURL(blob);
      this._addCleanup(() => URL.revokeObjectURL(url));
      return url;
    }

    if (/^[A-Za-z]:[/\\]/.test(s)) {
      const { url, revoke } = await fileSystem.createObjectURL(s);
      this._addCleanup(revoke);
      return url;
    }

    return s;
  }

  /**
   * 保存用户上传的壁纸文件到 IndexedDB
   * @param {File|Blob} file
   * @param {'image'|'video'} kind
   * @returns {Promise<string>} 形如 `idb:wallpaper-image-169...` 的来源标识
   */
  async storeUpload(file, kind) {
    const key = `wallpaper-${kind}-${Date.now()}`;
    await idb.put(STORES.BLOBS, key, file);
    // 清理该类型的旧壁纸，避免无限堆积
    try {
      const keys = await idb.keys(STORES.BLOBS);
      for (const k of keys) {
        if (typeof k === 'string' && k.startsWith(`wallpaper-${kind}-`) && k !== key) {
          await idb.delete(STORES.BLOBS, k);
        }
      }
    } catch { /* 清理失败不影响主流程 */ }
    return `idb:${key}`;
  }

  /* ==========================================================
     播放控制
     ========================================================== */

  _syncPlayback() {
    const v = this.mediaEl;
    if (!(v instanceof HTMLVideoElement)) return;
    const shouldPause =
      document.hidden ||
      (this._occluded && settings.get('wallpaper.pauseWhenOccluded') !== false);
    if (shouldPause) {
      if (!v.paused) v.pause();
    } else if (v.paused) {
      v.play().catch(() => {});
    }
  }

  _syncAudio() {
    const v = this.mediaEl;
    if (!(v instanceof HTMLVideoElement)) return;
    v.muted = settings.get('wallpaper.videoMuted') !== false;
    v.volume = clamp01(settings.get('wallpaper.videoVolume'));
  }

  /** 切换视频壁纸静音 */
  toggleMute() {
    const next = !settings.get('wallpaper.videoMuted');
    settings.set('wallpaper.videoMuted', next);
    this._syncAudio();
    return next;
  }

  /* ==========================================================
     清理
     ========================================================== */

  _addCleanup(fn) {
    const prev = this._cleanup;
    this._cleanup = () => {
      prev?.();
      fn();
    };
  }

  _teardown() {
    if (this._badgeOff) { this._badgeOff(); this._badgeOff = null; }
    if (this.mediaEl instanceof HTMLVideoElement) {
      this.mediaEl.pause();
      this.mediaEl.removeAttribute('src');
      this.mediaEl.load();
    }
    this.mediaEl?.remove();
    this.badgeEl?.remove();
    this.mediaEl = null;
    this.badgeEl = null;
    if (this._cleanup) {
      try { this._cleanup(); } catch { /* 已释放 */ }
      this._cleanup = null;
    }
    this.layer.classList.remove('is-tiled');
    this.layer.style.background = '';
  }
}

function clamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

export const wallpaper = new WallpaperEngine();
export default wallpaper;
