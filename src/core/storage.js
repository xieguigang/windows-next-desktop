/**
 * 存储抽象层
 *
 * - LocalStore：localStorage 命名空间封装，用于轻量配置（设置、图标布局、窗口状态）
 * - IDB：IndexedDB Promise 化封装，用于文件二进制内容与目录句柄
 */

import { createLogger } from './logger.js';

const log = createLogger('Storage');

const NS_PREFIX = 'winnext:';

/* ============================================================
   localStorage 封装
   ============================================================ */

export class LocalStore {
  /** @param {string} namespace */
  constructor(namespace) {
    this.ns = NS_PREFIX + namespace + ':';
    this._memoryFallback = new Map();
    this._available = LocalStore.isAvailable();
    if (!this._available) {
      log.warn('localStorage 不可用，已降级为内存存储（刷新后丢失）');
    }
  }

  static isAvailable() {
    try {
      const k = '__winnext_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @template T
   * @param {string} key
   * @param {T} [fallback]
   * @returns {T}
   */
  get(key, fallback = null) {
    const full = this.ns + key;
    try {
      const raw = this._available ? localStorage.getItem(full) : this._memoryFallback.get(full);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      log.warn(`读取 "${key}" 失败，返回默认值`, err);
      return fallback;
    }
  }

  /**
   * @param {string} key
   * @param {any} value
   * @returns {boolean} 是否写入成功
   */
  set(key, value) {
    const full = this.ns + key;
    let raw;
    try {
      raw = JSON.stringify(value);
    } catch (err) {
      log.error(`序列化 "${key}" 失败`, err);
      return false;
    }
    if (!this._available) {
      this._memoryFallback.set(full, raw);
      return true;
    }
    try {
      localStorage.setItem(full, raw);
      return true;
    } catch (err) {
      if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
        log.error(`存储配额已满，无法写入 "${key}"。请在设置中清理数据。`);
      } else {
        log.error(`写入 "${key}" 失败`, err);
      }
      return false;
    }
  }

  /** @param {string} key */
  remove(key) {
    const full = this.ns + key;
    if (this._available) localStorage.removeItem(full);
    this._memoryFallback.delete(full);
  }

  /** @returns {string[]} 该命名空间下的全部 key（不含前缀） */
  keys() {
    if (!this._available) {
      return [...this._memoryFallback.keys()].map((k) => k.slice(this.ns.length));
    }
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(this.ns)) out.push(k.slice(this.ns.length));
    }
    return out;
  }

  /** 清空该命名空间 */
  clear() {
    this.keys().forEach((k) => this.remove(k));
  }
}

/* ============================================================
   IndexedDB 封装
   ============================================================ */

const DB_NAME = 'winnext-db';
const DB_VERSION = 1;

/** 对象仓库名 */
export const STORES = /** @type {const} */ ({
  FILES: 'files',      // 文件内容：key = 规范化路径，value = { data, type }
  HANDLES: 'handles',  // FileSystemDirectoryHandle 持久化
  BLOBS: 'blobs',      // 用户上传的壁纸等大对象
});

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/** @returns {Promise<IDBDatabase>} */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      log.info('IndexedDB 结构已初始化');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        log.warn('IndexedDB 版本变更，连接已关闭');
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    req.onblocked = () => log.warn('IndexedDB 升级被其他标签页阻塞');
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

/**
 * @param {string} store
 * @param {IDBTransactionMode} mode
 * @param {(s: IDBObjectStore) => IDBRequest} work
 * @returns {Promise<any>}
 */
async function tx(store, mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = work(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB 事务中断'));
  });
}

export const idb = {
  /** @param {string} store @param {IDBValidKey} key */
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  /** @param {string} store @param {IDBValidKey} key @param {any} value */
  put: (store, key, value) => tx(store, 'readwrite', (s) => s.put(value, key)),
  /** @param {string} store @param {IDBValidKey} key */
  delete: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  /** @param {string} store */
  keys: (store) => tx(store, 'readonly', (s) => s.getAllKeys()),
  /** @param {string} store */
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
  /**
   * 估算已用存储空间
   * @returns {Promise<{usage:number, quota:number}>}
   */
  async estimate() {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota };
    }
    return { usage: 0, quota: 0 };
  },
};

/* ============================================================
   通用工具
   ============================================================ */

/**
 * 防抖包装。用于高频状态持久化（拖拽窗口 / 移动图标）。
 * @template {(...args:any[]) => any} F
 * @param {F} fn
 * @param {number} wait
 * @returns {F & { flush: () => void, cancel: () => void }}
 */
export function debounce(fn, wait = 300) {
  let timer = null;
  let lastArgs = null;
  const wrapped = (...args) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = lastArgs;
      lastArgs = null;
      fn(...a);
    }, wait);
  };
  wrapped.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    const a = lastArgs;
    lastArgs = null;
    if (a) fn(...a);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  return /** @type {any} */ (wrapped);
}

/**
 * 节流（尾随执行）
 * @template {(...args:any[]) => any} F
 * @param {F} fn
 * @param {number} interval
 * @returns {F}
 */
export function throttle(fn, interval = 100) {
  let last = 0;
  let timer = null;
  return /** @type {any} */ ((...args) => {
    const now = Date.now();
    const remain = interval - (now - last);
    if (remain <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, remain);
    }
  });
}
