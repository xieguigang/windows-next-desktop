/**
 * 设置存储
 *
 * 扁平化 key（`分类.字段`）便于订阅与持久化。
 * set() 时同步把视觉相关项写入 :root 的 CSS 变量 / data 属性，
 * 保证「设置面板滑动 → 桌面立即变化」无需任何中间层。
 */

import bus from './event-bus.js';
import { LocalStore, debounce } from './storage.js';
import { createLogger, setLogLevel } from './logger.js';

const log = createLogger('Settings');

/** 默认设置表。新增设置项只需在此登记。 */
export const DEFAULT_SETTINGS = Object.freeze({
  /* 外观 */
  'appearance.theme': 'light',              // light | dark | auto
  'appearance.accent': '#0078D4',
  'appearance.aeroEnabled': true,
  'appearance.aeroBlur': 30,                // px
  'appearance.aeroSaturate': 180,           // %
  'appearance.aeroOpacity': 0.62,           // 0.2 ~ 0.95
  'appearance.reduceMotion': false,
  'appearance.uiScale': 100,                // %

  /* 透明度（独立于 Aero 底色透明度，逐层可调） */
  'appearance.titlebarOpacity': 1,          // 0.3 ~ 1，标题栏相对窗体的通透程度
  'appearance.inactiveOpacity': 0.92,       // 0.4 ~ 1，窗口失去焦点时的整体不透明度
  'appearance.taskbarOpacity': 0.58,        // 0.2 ~ 1，任务栏底色不透明度
  'appearance.menuOpacity': 0.76,           // 0.3 ~ 1，菜单 / 弹出层底色不透明度

  /* 壁纸 */
  'wallpaper.mode': 'gradient',             // gradient | image | video | html
  'wallpaper.imageUrl': '',
  'wallpaper.imageFit': 'cover',            // cover | contain | fill | tile | center
  'wallpaper.videoUrl': '',
  'wallpaper.videoMuted': true,
  'wallpaper.videoVolume': 0.5,
  'wallpaper.htmlUrl': 'assets/html-wallpapers/particles.html',
  'wallpaper.pauseWhenOccluded': true,

  /* 任务栏 */
  'taskbar.align': 'center',                // center | left
  'taskbar.combine': 'always',              // always | never
  'taskbar.showPreview': true,
  'taskbar.pinned': ['explorer', 'browser', 'notepad', 'calculator', 'terminal'],
  'taskbar.showSeconds': false,

  /* 桌面 */
  'desktop.iconSize': 'medium',             // small | medium | large
  'desktop.showIcons': true,
  'desktop.sortBy': 'name',                 // name | type | date

  /* 系统 */
  'system.logLevel': 'warn',
  'system.notifications': true,
  'system.userName': 'User',
  'system.snapEnabled': true,
  'system.welcomed': false,                 // 首次启动欢迎提示是否已展示
  'system.confirmExit': false,              // 关闭页面前是否确认
});

/** 需要同步到 CSS 变量的设置项映射 */
const CSS_VAR_MAP = {
  'appearance.accent': (v, root) => {
    root.style.setProperty('--accent', v);
    root.style.setProperty('--accent-hover', shade(v, 12));
    root.style.setProperty('--accent-active', shade(v, -18));
    root.style.setProperty('--accent-subtle', hexToRgba(v, 0.12));
  },
  'appearance.aeroBlur': (v, root) => root.style.setProperty('--aero-blur', `${v}px`),
  'appearance.aeroSaturate': (v, root) => root.style.setProperty('--aero-saturate', `${v}%`),
  'appearance.aeroOpacity': (v, root) => root.style.setProperty('--aero-opacity', String(v)),
  'appearance.uiScale': (v, root) => root.style.setProperty('--ui-scale', String(v / 100)),

  'appearance.titlebarOpacity': (v, root) =>
    root.style.setProperty('--titlebar-opacity', String(clamp01(v, 1))),
  'appearance.inactiveOpacity': (v, root) =>
    root.style.setProperty('--window-inactive-opacity', String(clamp01(v, 0.92))),
  'appearance.taskbarOpacity': (v, root) =>
    root.style.setProperty('--taskbar-opacity', String(clamp01(v, 0.58))),
  'appearance.menuOpacity': (v, root) =>
    root.style.setProperty('--menu-opacity', String(clamp01(v, 0.76))),
};

/**
 * 把任意输入夹取到 [0, 1]，非法值回退到默认。
 * 防止设置被外部脚本写入越界数值后导致整层界面不可见。
 * @param {unknown} v
 * @param {number} fallback
 */
function clamp01(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/** 十六进制颜色明暗调整 */
function shade(hex, percent) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (percent / 100) * 255)));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

export function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return { r: 0, g: 120, b: 212 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

class SettingsStore {
  constructor() {
    this._store = new LocalStore('settings');
    /** @type {Record<string, any>} */
    this._cache = { ...DEFAULT_SETTINGS };
    /** @type {Map<string, Set<(value:any, key:string)=>void>>} */
    this._subs = new Map();
    this._persist = debounce(() => this._flush(), 240);
    this._mediaQuery = null;
    this._initialized = false;
  }

  /** 从持久化读取并应用到 DOM */
  init() {
    if (this._initialized) return;
    const saved = this._store.get('all', null);
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) {
        if (k in DEFAULT_SETTINGS) this._cache[k] = v;
      }
    }
    setLogLevel(this._cache['system.logLevel']);

    // 跟随系统亮暗
    if (window.matchMedia) {
      this._mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this._mediaQuery.addEventListener('change', () => {
        if (this._cache['appearance.theme'] === 'auto') this._applyTheme();
      });
    }

    this.applyAll();
    this._initialized = true;
    log.info('设置已加载');
  }

  /** 把全部视觉设置写入 DOM */
  applyAll() {
    const root = document.documentElement;
    for (const [key, apply] of Object.entries(CSS_VAR_MAP)) {
      apply(this._cache[key], root);
    }
    this._applyTheme();
    root.dataset.aero = this._cache['appearance.aeroEnabled'] ? 'on' : 'off';
    root.dataset.reduceMotion = String(this._cache['appearance.reduceMotion']);
    document.body?.setAttribute('data-icon-size', this._cache['desktop.iconSize']);
  }

  _applyTheme() {
    const mode = this._cache['appearance.theme'];
    const dark = mode === 'dark' || (mode === 'auto' && this._mediaQuery?.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }

  /**
   * @template T
   * @param {string} key
   * @param {T} [fallback]
   * @returns {T}
   */
  get(key, fallback) {
    if (key in this._cache) return this._cache[key];
    return fallback !== undefined ? fallback : DEFAULT_SETTINGS[key];
  }

  /** @returns {Record<string, any>} 全部设置的浅拷贝 */
  getAll() {
    return { ...this._cache };
  }

  /**
   * 写入设置。相同值不触发通知。
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    if (!(key in DEFAULT_SETTINGS)) {
      log.warn(`未知设置项 "${key}"，仍会写入但不受默认值保护`);
    }
    const old = this._cache[key];
    if (shallowEqual(old, value)) return;
    this._cache[key] = value;

    // 同步 DOM
    const applyCss = CSS_VAR_MAP[key];
    if (applyCss) applyCss(value, document.documentElement);
    if (key === 'appearance.theme') this._applyTheme();
    if (key === 'appearance.aeroEnabled') document.documentElement.dataset.aero = value ? 'on' : 'off';
    if (key === 'appearance.reduceMotion') document.documentElement.dataset.reduceMotion = String(value);
    if (key === 'desktop.iconSize') document.body?.setAttribute('data-icon-size', value);
    if (key === 'system.logLevel') setLogLevel(value);

    this._persist();
    this._notify(key, value, old);
  }

  /**
   * 批量写入
   * @param {Record<string, any>} patch
   */
  setMany(patch) {
    for (const [k, v] of Object.entries(patch)) this.set(k, v);
  }

  /**
   * 订阅某个设置项变化
   * @param {string} key 支持 `分类.*` 前缀通配
   * @param {(value:any, key:string)=>void} handler
   * @returns {() => void} 取消订阅
   */
  subscribe(key, handler) {
    let set = this._subs.get(key);
    if (!set) {
      set = new Set();
      this._subs.set(key, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (!set.size) this._subs.delete(key);
    };
  }

  _notify(key, value, old) {
    const direct = this._subs.get(key);
    if (direct) for (const fn of Array.from(direct)) safeCall(fn, value, key);
    for (const [pattern, set] of this._subs) {
      if (!pattern.endsWith('*')) continue;
      if (!key.startsWith(pattern.slice(0, -1))) continue;
      for (const fn of Array.from(set)) safeCall(fn, value, key);
    }
    bus.emit('settings:changed', { key, value, old });
  }

  /** 恢复默认值 */
  reset(key) {
    if (key) {
      this.set(key, DEFAULT_SETTINGS[key]);
      return;
    }
    const keys = Object.keys(DEFAULT_SETTINGS);
    for (const k of keys) this.set(k, DEFAULT_SETTINGS[k]);
    log.info('设置已恢复默认');
  }

  _flush() {
    // 只持久化与默认值不同的项，减小体积
    const diff = {};
    for (const [k, v] of Object.entries(this._cache)) {
      if (!shallowEqual(v, DEFAULT_SETTINGS[k])) diff[k] = v;
    }
    this._store.set('all', diff);
  }

  /** 立即落盘（页面卸载前调用） */
  flush() {
    this._persist.flush();
  }
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return false;
}

function safeCall(fn, ...args) {
  try {
    fn(...args);
  } catch (err) {
    log.error('设置订阅回调异常', err);
  }
}

export const settings = new SettingsStore();
export default settings;
