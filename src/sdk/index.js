/**
 * WinNext 全局 SDK
 *
 * 挂载到 `window.WinNext`，是第三方扩展这个桌面环境的唯一入口。
 * 内置应用与第三方应用使用完全相同的这套接口。
 */

import bus from '../core/event-bus.js';
import settings from '../core/settings-store.js';
import notifications from '../core/notification.js';
import appRegistry from '../core/app-registry.js';
import processManager from '../core/process-manager.js';
import windowManager from '../core/window-manager.js';
import fileSystem, { SHELL_FOLDERS } from '../core/fs/fs-service.js';
import * as P from '../core/fs/path-utils.js';
import { createAppContext, loadSharedStyleSheet } from './app-context.js';
import { createLogger } from '../core/logger.js';
import { getIcon } from '../ui/icons.js';

const log = createLogger('SDK');

export const VERSION = '1.0.0';

/* ============================================================
   应用启动
   ============================================================ */

/**
 * 启动应用
 * @param {string} appId
 * @param {any} [args] 启动参数，例如 { filePath }
 * @param {{forceNew?:boolean}} [opts] forceNew 为 true 时忽略单实例约束，强制开新窗口
 * @returns {Promise<{window:any, ctx:any}|null>}
 */
export async function launchApp(appId, args, opts = {}) {
  const manifest = appRegistry.get(appId);
  if (!manifest) {
    notifications.toast({ title: '无法启动', body: `未找到应用：${appId}`, type: 'error' });
    log.error(`应用未注册：${appId}`);
    return null;
  }

  // 单实例应用：聚焦已有窗口并传递新参数
  if (manifest.singleton && !opts.forceNew) {
    const existing = windowManager.getByAppId(appId)[0];
    if (existing && !existing.isDestroyed) {
      windowManager.focus(existing);
      if (args && typeof existing._onRelaunch === 'function') {
        try { existing._onRelaunch(args); } catch (err) { log.error('relaunch 回调异常', err); }
      }
      return { window: existing, ctx: existing._ctx };
    }
  }

  // 加载模块（懒加载）
  let app;
  try {
    app = await appRegistry.load(appId);
  } catch (err) {
    notifications.toast({ title: '启动失败', body: err.message, type: 'error' });
    return null;
  }

  // 确保共享样式表已就绪，避免应用首帧无样式闪烁
  await loadSharedStyleSheet();

  // 沿用上次的窗口几何
  const saved = windowManager.getSavedGeometry(appId);
  const size = app.defaultSize;
  const win = windowManager.createWindow({
    appId,
    title: app.name,
    icon: app.icon,
    width: saved?.width || size.width,
    height: saved?.height || size.height,
    x: saved?.x,
    y: saved?.y,
    minWidth: app.minSize.width,
    minHeight: app.minSize.height,
    resizable: app.resizable,
    maximizable: app.maximizable,
  });

  const proc = processManager.register({
    appId,
    name: app.name,
    icon: app.icon,
    windowId: win.id,
  });
  win._pid = proc.pid;
  win.onDispose(() => processManager.unregister(proc.pid));

  const ctx = createAppContext({
    window: win,
    manifest: app,
    args,
    process: proc,
    launchApp,
    openPath,
  });
  win._ctx = ctx;

  // 挂载应用，捕获异常渲染错误边界
  try {
    const result = app.mount(ctx);
    if (result && typeof result.then === 'function') {
      await result;
    }
  } catch (err) {
    log.error(`应用 "${appId}" 挂载失败`, err);
    renderErrorBoundary(win, app, err);
  }

  bus.emit('app:launched', { appId, window: win, pid: proc.pid });
  return { window: win, ctx };
}

/**
 * 渲染「应用已停止响应」错误页
 * @param {import('../core/window.js').WinWindow} win
 * @param {any} app
 * @param {Error} err
 */
function renderErrorBoundary(win, app, err) {
  const box = document.createElement('div');
  box.className = 'app-error-boundary';
  box.innerHTML = `
    <span class="aeb-icon">${getIcon('error', 40)}</span>
    <div class="aeb-title">${escapeHtml(app.name)} 已停止响应</div>
    <div class="aeb-desc">该应用在启动时发生错误，桌面环境的其余部分不受影响。</div>
    <pre></pre>
    <button type="button">关闭窗口</button>
  `;
  box.querySelector('pre').textContent = String(err?.stack || err?.message || err);
  box.querySelector('button').addEventListener('click', () => win.close());

  // 错误页挂在 Shadow DOM 外层，避免受应用样式影响
  win.shadow.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = `
    :host { display:block; height:100%; font-family: var(--font-sans); }
    .app-error-boundary { display:flex; flex-direction:column; align-items:center; justify-content:center;
      height:100%; gap:12px; padding:32px; text-align:center; color: var(--fg-primary); }
    .aeb-icon { color: var(--danger); }
    .aeb-title { font-size:16px; font-weight:600; }
    .aeb-desc { font-size:13px; color: var(--fg-secondary); max-width:420px; line-height:1.6; }
    pre { max-width:100%; max-height:140px; overflow:auto; padding:10px 14px; border-radius:6px;
      background: var(--bg-subtle); border:1px solid var(--stroke-subtle); font-family: var(--font-mono);
      font-size:11px; color: var(--fg-secondary); text-align:left; user-select:text; margin:0; }
    button { padding:6px 20px; border-radius:4px; border:1px solid var(--stroke-default);
      background: var(--bg-layer); font-size:13px; cursor:default; color: var(--fg-primary); }
    button:hover { background: var(--bg-hover); }
  `;
  win.shadow.append(style, box);
}

/**
 * 用默认关联应用打开文件；目录则用资源管理器打开
 * @param {string} path
 * @returns {Promise<any>}
 */
export async function openPath(path) {
  const n = P.normalize(path);
  let stat;
  try {
    stat = await fileSystem.stat(n);
  } catch (err) {
    notifications.toast({ title: '无法打开', body: err.message, type: 'error' });
    return null;
  }

  if (stat.type === 'directory') {
    return launchApp('explorer', { path: n });
  }

  const app = appRegistry.getByFileExtension(n);
  if (!app) {
    // 无关联应用时提供「选择打开方式」
    const candidates = appRegistry.getAll().filter((a) => a.fileExtensions.length || a.id === 'notepad');
    const pick = await promptOpenWith(n, candidates);
    if (!pick) return null;
    return launchApp(pick, { filePath: n });
  }
  return launchApp(app.id, { filePath: n });
}

/**
 * 「打开方式」选择框
 * @param {string} path
 * @param {any[]} candidates
 * @returns {Promise<string|null>}
 */
async function promptOpenWith(path, candidates) {
  const names = candidates.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
  const input = await notifications.prompt(
    `没有为 .${P.extname(path) || '未知类型'} 文件关联的应用。\n请输入序号选择打开方式：\n\n${names}`,
    '1',
    '打开方式'
  );
  if (input === null) return null;
  const idx = parseInt(input, 10) - 1;
  return candidates[idx]?.id || null;
}

/* ============================================================
   全局 SDK 对象
   ============================================================ */

const WinNext = {
  version: VERSION,

  /* ---------- 应用注册与启动 ---------- */
  /**
   * 注册一个应用
   * @param {import('../core/app-registry.js').AppManifest} manifest
   */
  registerApp(manifest) {
    const app = appRegistry.register(manifest);
    return app;
  },

  /** 注销应用 */
  unregisterApp: (id) => appRegistry.unregister(id),

  /** 启动应用 */
  launchApp,

  /** 用关联应用打开文件路径 */
  openPath,

  /** 获取全部已注册应用 */
  getApps: (opts) => appRegistry.getAll(opts),

  /** 获取单个应用清单 */
  getApp: (id) => appRegistry.get(id),

  /** 设置文件扩展名的默认打开方式 */
  setDefaultApp: (ext, appId) => appRegistry.setDefaultApp(ext, appId),

  /** 获取运行中的应用（进程列表） */
  getRunningApps: () => processManager.list().filter((p) => !p.system),

  /** 关闭某应用的所有窗口 */
  closeApp: (appId) => windowManager.closeByAppId(appId),

  /* ---------- 窗口 ---------- */
  windows: {
    getAll: () => windowManager.getAll().map(toPublicWindow),
    getActive: () => (windowManager.activeWindow ? toPublicWindow(windowManager.activeWindow) : null),
    getByAppId: (id) => windowManager.getByAppId(id).map(toPublicWindow),
    focus: (id) => {
      const w = windowManager.get(id);
      if (w) windowManager.focus(w);
    },
    close: (id) => windowManager.get(id)?.close(),
    minimizeAll: () => windowManager.minimizeAll(),
    hasMaximized: () => windowManager.hasMaximizedWindow(),
  },

  /* ---------- 文件系统 ---------- */
  fs: {
    readDir: (p) => fileSystem.readDir(p),
    readFile: (p, e) => fileSystem.readFile(p, e),
    writeFile: (p, d) => fileSystem.writeFile(p, d),
    mkdir: (p) => fileSystem.mkdir(p),
    remove: (p, r) => fileSystem.remove(p, r),
    rename: (a, b) => fileSystem.rename(a, b),
    copy: (a, b) => fileSystem.copy(a, b),
    stat: (p) => fileSystem.stat(p),
    exists: (p) => fileSystem.exists(p),
    search: (r, k, o) => fileSystem.search(r, k, o),
    getDrives: () => fileSystem.getDrives(),
    mountLocalFolder: () => fileSystem.mountLocalFolder(),
    unmountDrive: (d) => fileSystem.unmountDrive(d),
    folders: SHELL_FOLDERS,
    path: P,
  },

  /* ---------- 设置 ---------- */
  settings: {
    get: (k, d) => settings.get(k, d),
    set: (k, v) => settings.set(k, v),
    getAll: () => settings.getAll(),
    subscribe: (k, fn) => settings.subscribe(k, fn),
    reset: (k) => settings.reset(k),
  },

  /* ---------- 通知与对话框 ---------- */
  notify: {
    toast: (o, t) => notifications.toast(o, t),
    info: (b, t) => notifications.toast({ body: b, title: t, type: 'info' }),
    success: (b, t) => notifications.toast({ body: b, title: t, type: 'success' }),
    warning: (b, t) => notifications.toast({ body: b, title: t, type: 'warning' }),
    error: (b, t) => notifications.toast({ body: b, title: t, type: 'error' }),
    history: () => [...notifications.history],
  },

  dialog: {
    alert: (m, t) => notifications.alert(m, t),
    confirm: (m, t, o) => notifications.confirm(m, t, o),
    prompt: (m, d, t) => notifications.prompt(m, d, t),
    pickFile: (o) => notifications.pickFile(o),
  },

  /* ---------- 事件总线 ---------- */
  events: {
    on: (e, fn) => bus.on(e, fn),
    once: (e, fn) => bus.once(e, fn),
    off: (e, fn) => bus.off(e, fn),
    emit: (e, p) => bus.emit(e, p),
  },

  /* ---------- 工具 ---------- */
  icons: { get: getIcon },
};

/** 窗口对象的公开视图，避免第三方直接操作内部实例 */
function toPublicWindow(w) {
  return {
    id: w.id,
    appId: w.appId,
    title: w.title,
    state: w.state,
    isActive: w.isActive,
    rect: w.getRect(),
    close: () => w.close(),
    focus: () => windowManager.focus(w),
    minimize: () => w.minimize(),
    maximize: () => w.maximize(),
    restore: () => w.restore(),
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 安装到全局 */
export function installSDK() {
  // 冻结顶层与各子命名空间，防止被意外覆盖
  for (const key of Object.keys(WinNext)) {
    const v = WinNext[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.freeze(v);
  }
  Object.freeze(WinNext);
  Object.defineProperty(window, 'WinNext', {
    value: WinNext,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  log.info(`WinNext SDK v${VERSION} 已就绪`);
  return WinNext;
}

export default WinNext;
