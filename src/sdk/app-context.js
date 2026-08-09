/**
 * AppContext 工厂
 *
 * 为每个应用实例构造运行时上下文，这是第三方应用能拿到的全部能力边界。
 * 设计原则：应用只与 ctx 交互，不直接触碰内核对象，便于未来加权限控制。
 */

import bus from '../core/event-bus.js';
import settings from '../core/settings-store.js';
import notifications from '../core/notification.js';
import fileSystem, { SHELL_FOLDERS } from '../core/fs/fs-service.js';
import * as P from '../core/fs/path-utils.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('AppContext');

/** 共享基础样式表，全局只构造一次 */
let sharedSheet = null;
let sharedSheetPromise = null;

/**
 * 载入 app-base.css 并构造为 CSSStyleSheet，
 * 之后所有应用的 Shadow DOM 通过 adoptedStyleSheets 复用同一份。
 * @returns {Promise<CSSStyleSheet|null>}
 */
export async function loadSharedStyleSheet() {
  if (sharedSheet) return sharedSheet;
  if (sharedSheetPromise) return sharedSheetPromise;

  sharedSheetPromise = (async () => {
    if (typeof CSSStyleSheet === 'undefined' || !('replace' in CSSStyleSheet.prototype)) {
      log.warn('浏览器不支持 Constructable Stylesheets，将回退为 <style> 注入');
      return null;
    }
    try {
      const url = new URL('../styles/app-base.css', import.meta.url).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const css = await res.text();
      const sheet = new CSSStyleSheet();
      await sheet.replace(css);
      sharedSheet = sheet;
      return sheet;
    } catch (err) {
      log.error('加载共享样式表失败', err);
      return null;
    }
  })();

  return sharedSheetPromise;
}

/** 回退方案：直接把 CSS 文本以 <link> 注入 Shadow DOM */
function injectFallbackStyle(shadow) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../styles/app-base.css', import.meta.url).href;
  shadow.appendChild(link);
}

/**
 * @typedef {Object} AppContext
 */

/**
 * 创建应用上下文
 * @param {{
 *   window: import('../core/window.js').WinWindow,
 *   manifest: import('../core/app-registry.js').AppManifest,
 *   args: any,
 *   process: any,
 *   launchApp: (id:string, args?:any) => Promise<any>,
 *   openPath: (path:string) => Promise<any>
 * }} deps
 * @returns {AppContext}
 */
export function createAppContext(deps) {
  const { window: win, manifest, args, process, launchApp, openPath } = deps;
  const shadow = win.shadow;

  // 注入共享设计系统样式
  if (sharedSheet && 'adoptedStyleSheets' in shadow) {
    shadow.adoptedStyleSheets = [sharedSheet];
  } else {
    injectFallbackStyle(shadow);
  }

  /** 应用自身的私有样式表缓存，避免重复注入 */
  const ownSheets = new Set();

  /** 统一收集需要在窗口关闭时释放的资源 */
  const revokables = new Set();

  const ctx = {
    /** 应用清单（只读副本） */
    manifest: Object.freeze({ ...manifest }),

    /** 应用 id */
    appId: manifest.id,

    /** 进程 id */
    pid: process?.pid ?? 0,

    /** Shadow Root，应用的全部 DOM 都应挂在这里 */
    root: shadow,

    /** 启动参数，例如 { filePath: 'C:/a.txt' } */
    args: args || {},

    /* ==========================================================
       窗口控制
       ========================================================== */
    window: {
      get id() { return win.id; },
      get state() { return win.state; },
      get isActive() { return win.isActive; },
      setTitle: (t) => win.setTitle(t),
      setIcon: (i) => win.setIcon(i),
      close: () => win.close(),
      minimize: () => win.minimize(),
      maximize: () => win.maximize(),
      restore: () => win.restore(),
      focus: () => win.manager.focus(win),
      resize: (w, h) => win.setRect({ width: w, height: h }),
      move: (x, y) => win.setRect({ x, y }),
      getRect: () => win.getRect(),
      /**
       * 注册关闭拦截器。返回 false 或 Promise<false> 可阻止关闭。
       * @param {() => boolean|Promise<boolean>} fn
       */
      onBeforeClose: (fn) => { win.beforeClose = fn; },
    },

    /* ==========================================================
       文件系统
       ========================================================== */
    fs: {
      readDir: (p) => fileSystem.readDir(p),
      readFile: (p, enc) => fileSystem.readFile(p, enc),
      writeFile: (p, d) => fileSystem.writeFile(p, d),
      mkdir: (p) => fileSystem.mkdir(p),
      remove: (p, r) => fileSystem.remove(p, r),
      rename: (a, b) => fileSystem.rename(a, b),
      copy: (a, b) => fileSystem.copy(a, b),
      move: (a, b) => fileSystem.move(a, b),
      stat: (p) => fileSystem.stat(p),
      exists: (p) => fileSystem.exists(p),
      search: (root, kw, o) => fileSystem.search(root, kw, o),
      getDrives: () => fileSystem.getDrives(),
      /**
       * 挂载本地真实文件夹为新驱动器（需 Chromium 内核）
       * @returns {Promise<{drive:string,label:string}|null>} 用户取消时返回 null
       */
      mountLocalFolder: () => fileSystem.mountLocalFolder(),
      /**
       * 卸载驱动器（系统盘 C: 不可卸载）
       * @param {string} drive
       */
      unmountDrive: (drive) => fileSystem.unmountDrive(drive),
      /** 当前浏览器是否支持挂载本地文件夹 */
      isNativeFSSupported: () => fileSystem.isNativeFSSupported(),
      /** 创建媒体 URL，窗口关闭时自动 revoke */
      createObjectURL: async (p) => {
        const { url, revoke } = await fileSystem.createObjectURL(p);
        revokables.add(revoke);
        return url;
      },
      /** 打开文件选择对话框 */
      pick: (o) => notifications.pickFile({ mode: 'open', ...o }),
      /** 打开保存对话框 */
      pickSave: (o) => notifications.pickFile({ mode: 'save', ...o }),
      /** 特殊目录常量 */
      folders: SHELL_FOLDERS,
      /** 路径工具 */
      path: P,
    },

    /* ==========================================================
       设置
       ========================================================== */
    settings: {
      get: (k, d) => settings.get(k, d),
      set: (k, v) => settings.set(k, v),
      /** 恢复某个设置项为默认值（省略 key 则恢复全部） */
      reset: (k) => settings.reset(k),
      subscribe: (k, fn) => {
        const off = settings.subscribe(k, fn);
        ctx.onDispose(off);
        return off;
      },
      /** 应用私有配置，自动加 `app.<id>.` 前缀 */
      getLocal: (k, d) => settings.get(`app.${manifest.id}.${k}`, d),
      setLocal: (k, v) => settings.set(`app.${manifest.id}.${k}`, v),
    },

    /* ==========================================================
       通知与对话框
       ========================================================== */
    notify: {
      toast: (o, t) => notifications.toast(o, t),
      info: (body, title) => notifications.toast({ body, title, type: 'info' }),
      success: (body, title) => notifications.toast({ body, title, type: 'success' }),
      warning: (body, title) => notifications.toast({ body, title, type: 'warning' }),
      error: (body, title) => notifications.toast({ body, title, type: 'error' }),
    },

    dialog: {
      alert: (m, t) => notifications.alert(m, t),
      confirm: (m, t, o) => notifications.confirm(m, t, o),
      prompt: (m, d, t) => notifications.prompt(m, d, t),
    },

    /* ==========================================================
       应用间交互
       ========================================================== */
    /** 启动另一个应用 */
    launchApp: (id, a) => launchApp(id, a),
    /** 用默认关联应用打开文件 */
    openPath: (p) => openPath(p),

    /* ==========================================================
       事件
       ========================================================== */
    events: {
      /** 订阅全局事件，窗口关闭时自动解绑 */
      on: (evt, fn) => {
        const off = bus.on(evt, fn);
        ctx.onDispose(off);
        return off;
      },
      once: (evt, fn) => bus.once(evt, fn),
      emit: (evt, payload) => bus.emit(`app:${manifest.id}:${evt}`, payload),
      /** 直接派发全局事件（谨慎使用） */
      emitGlobal: (evt, payload) => bus.emit(evt, payload),
    },

    /* ==========================================================
       生命周期
       ========================================================== */
    /**
     * 注册清理回调，窗口关闭时统一执行。
     * 所有定时器、Observer、ObjectURL、AudioContext 都应在此释放。
     * @param {() => void} fn
     */
    onDispose: (fn) => win.onDispose(fn),

    /**
     * 为任务栏缩略图提供摘要内容
     * @param {() => string} fn 返回纯文本
     */
    setPreviewProvider: (fn) => { win.previewProvider = fn; },

    /* ==========================================================
       工具
       ========================================================== */
    /**
     * 注入应用私有样式（幂等）
     * @param {string} css
     * @param {string} [key] 去重键
     */
    injectStyle(css, key) {
      const k = key || css.slice(0, 64);
      if (ownSheets.has(k)) return;
      ownSheets.add(k);
      const style = document.createElement('style');
      style.textContent = css;
      shadow.appendChild(style);
    },

    /**
     * 通过相对路径注入应用自己的 CSS 文件
     * @param {string} href 绝对 URL（通常用 new URL('./x.css', import.meta.url).href）
     */
    injectStyleSheet(href) {
      if (ownSheets.has(href)) return;
      ownSheets.add(href);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      shadow.appendChild(link);
    },

    /**
     * 创建自动清理的定时器
     * @param {Function} fn @param {number} ms
     */
    setInterval(fn, ms) {
      const id = setInterval(fn, ms);
      win.onDispose(() => clearInterval(id));
      return id;
    },

    setTimeout(fn, ms) {
      const id = setTimeout(fn, ms);
      win.onDispose(() => clearTimeout(id));
      return id;
    },

    /**
     * 监听元素尺寸变化，窗口关闭时自动断开
     * @param {Element} el
     * @param {ResizeObserverCallback} cb
     */
    observeResize(el, cb) {
      if (typeof ResizeObserver === 'undefined') return null;
      const ro = new ResizeObserver(cb);
      ro.observe(el);
      win.onDispose(() => ro.disconnect());
      return ro;
    },

    /** 日志器（带应用名前缀） */
    log: createLogger(manifest.name || manifest.id),
  };

  // 窗口关闭时释放所有 ObjectURL
  win.onDispose(() => {
    for (const revoke of revokables) {
      try { revoke(); } catch { /* 已释放 */ }
    }
    revokables.clear();
  });

  return ctx;
}

export default createAppContext;
