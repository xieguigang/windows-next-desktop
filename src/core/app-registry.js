/**
 * 应用注册表
 *
 * 内置应用与第三方应用走完全相同的注册流程，这是「可扩展性」的根本保证。
 * 支持两种注册形态：
 *   1. 声明式清单 + `entry` 模块路径 → 首次启动时动态 import（懒加载）
 *   2. 直接携带 `mount` 函数 → 立即可用（第三方 SDK 调用场景）
 */

import bus from './event-bus.js';
import { createLogger } from './logger.js';
import * as P from './fs/path-utils.js';

const log = createLogger('AppRegistry');

/**
 * @typedef {Object} AppManifest
 * @property {string} id
 * @property {string} name
 * @property {string} icon
 * @property {string} [description]
 * @property {string} [category]
 * @property {{width:number,height:number}} [defaultSize]
 * @property {{width:number,height:number}} [minSize]
 * @property {boolean} [resizable]
 * @property {boolean} [maximizable]
 * @property {boolean} [singleton]
 * @property {boolean} [showOnDesktop]
 * @property {boolean} [hidden]        不在开始菜单显示
 * @property {string[]} [fileExtensions]
 * @property {string} [entry]          模块路径，用于懒加载
 * @property {(ctx:any)=>void|Promise<void>} [mount]
 */

class AppRegistry {
  constructor() {
    /** @type {Map<string, AppManifest>} */
    this.apps = new Map();
    /** @type {Map<string, Promise<AppManifest>>} 正在加载的模块，避免并发重复 import */
    this._loading = new Map();
    /** @type {Map<string, string>} 扩展名 → appId */
    this._extMap = new Map();
  }

  /**
   * 注册应用
   * @param {AppManifest} manifest
   * @returns {AppManifest}
   */
  register(manifest) {
    if (!manifest || typeof manifest !== 'object') {
      throw new TypeError('registerApp: 需要一个清单对象');
    }
    const { id } = manifest;
    if (!id || typeof id !== 'string') {
      throw new TypeError('registerApp: 清单必须包含字符串类型的 id');
    }
    if (!manifest.mount && !manifest.entry) {
      throw new TypeError(`registerApp("${id}"): 必须提供 mount 函数或 entry 模块路径`);
    }

    const existing = this.apps.get(id);
    const normalized = {
      id,
      name: manifest.name || id,
      icon: manifest.icon || 'hello',
      description: manifest.description || '',
      category: manifest.category || '应用',
      defaultSize: manifest.defaultSize || { width: 820, height: 560 },
      minSize: manifest.minSize || { width: 320, height: 220 },
      resizable: manifest.resizable !== false,
      maximizable: manifest.maximizable !== false,
      singleton: Boolean(manifest.singleton),
      showOnDesktop: manifest.showOnDesktop !== false,
      hidden: Boolean(manifest.hidden),
      fileExtensions: (manifest.fileExtensions || []).map((e) => String(e).toLowerCase().replace('.', '')),
      entry: manifest.entry || null,
      mount: manifest.mount || existing?.mount || null,
      version: manifest.version || '1.0.0',
      author: manifest.author || '',
      _loaded: Boolean(manifest.mount),
    };

    this.apps.set(id, normalized);
    for (const ext of normalized.fileExtensions) {
      if (!this._extMap.has(ext)) this._extMap.set(ext, id);
    }

    bus.emit(existing ? 'app:updated' : 'app:registered', { app: normalized });
    log.debug(`应用已注册: ${id} (${normalized.name})`);
    return normalized;
  }

  /**
   * 注销应用
   * @param {string} id
   */
  unregister(id) {
    const app = this.apps.get(id);
    if (!app) return false;
    this.apps.delete(id);
    for (const [ext, appId] of [...this._extMap]) {
      if (appId === id) this._extMap.delete(ext);
    }
    bus.emit('app:unregistered', { app });
    return true;
  }

  /** @param {string} id @returns {AppManifest|null} */
  get(id) {
    return this.apps.get(id) || null;
  }

  /** @param {string} id */
  has(id) {
    return this.apps.has(id);
  }

  /**
   * @param {{includeHidden?:boolean}} [opts]
   * @returns {AppManifest[]}
   */
  getAll(opts = {}) {
    const list = [...this.apps.values()];
    const filtered = opts.includeHidden ? list : list.filter((a) => !a.hidden);
    return filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  /**
   * 按文件扩展名查找默认关联应用
   * @param {string} pathOrExt
   * @returns {AppManifest|null}
   */
  getByFileExtension(pathOrExt) {
    const ext = pathOrExt.includes('.') || pathOrExt.includes('/')
      ? P.extname(pathOrExt)
      : String(pathOrExt).toLowerCase();
    if (!ext) return null;
    const id = this._extMap.get(ext);
    return id ? this.get(id) : null;
  }

  /**
   * 设置某扩展名的默认打开方式
   * @param {string} ext @param {string} appId
   */
  setDefaultApp(ext, appId) {
    const e = String(ext).toLowerCase().replace('.', '');
    if (!this.apps.has(appId)) throw new Error(`应用不存在：${appId}`);
    this._extMap.set(e, appId);
    bus.emit('app:association-changed', { ext: e, appId });
  }

  /** @returns {Array<{ext:string, appId:string}>} */
  getAssociations() {
    return [...this._extMap.entries()]
      .map(([ext, appId]) => ({ ext, appId }))
      .sort((a, b) => a.ext.localeCompare(b.ext));
  }

  /**
   * 确保应用模块已加载（懒加载核心）
   * @param {string} id
   * @returns {Promise<AppManifest>}
   */
  async load(id) {
    const app = this.apps.get(id);
    if (!app) throw new Error(`应用未注册：${id}`);
    if (app._loaded && typeof app.mount === 'function') return app;

    // 并发去重
    if (this._loading.has(id)) return this._loading.get(id);

    const task = (async () => {
      if (!app.entry) throw new Error(`应用 "${id}" 既无 mount 也无 entry`);
      const done = log.time(`加载应用模块 ${id}`);
      let mod;
      try {
        // entry 是相对于 src/ 的路径
        mod = await import(/* @vite-ignore */ new URL(app.entry, import.meta.url).href);
      } catch (err) {
        log.error(`加载应用模块失败：${id} (${app.entry})`, err);
        throw new Error(`无法加载应用 "${app.name}"：${err.message}`);
      }
      done();

      const mount = mod.mount || mod.default?.mount || (typeof mod.default === 'function' ? mod.default : null);
      if (typeof mount !== 'function') {
        throw new Error(`应用模块 "${app.entry}" 未导出 mount 函数`);
      }
      app.mount = mount;
      // 允许模块导出补充清单字段（如动态图标）
      if (mod.manifest && typeof mod.manifest === 'object') {
        Object.assign(app, { ...mod.manifest, id: app.id, entry: app.entry, mount });
      }
      app._loaded = true;
      this._loading.delete(id);
      bus.emit('app:loaded', { app });
      return app;
    })().catch((err) => {
      this._loading.delete(id);
      throw err;
    });

    this._loading.set(id, task);
    return task;
  }

  /**
   * 批量注册（内置应用清单）
   * @param {AppManifest[]} manifests
   */
  registerAll(manifests) {
    for (const m of manifests) {
      try {
        this.register(m);
      } catch (err) {
        log.error('注册应用失败', m?.id, err);
      }
    }
  }
}

export const appRegistry = new AppRegistry();
export default appRegistry;
