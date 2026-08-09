/**
 * 启动引导
 *
 * 严格按依赖顺序初始化：
 *   设置（要最先，因为它同步写 CSS 变量与主题）
 *   → 文件系统（VFS 种子数据 + 恢复已挂载的本地目录）
 *   → 内核 UI 服务（窗口管理、通知、右键菜单）
 *   → SDK 安装（此后 window.WinNext 可用）
 *   → 注册内置应用清单（只注册元数据，模块懒加载）
 *   → Shell（壁纸、桌面、任务栏、预览、开始菜单）
 *   → 恢复上次会话
 *
 * 任一阶段抛错都会被捕获并在启动遮罩上渲染可读的错误信息，
 * 而不是留下一个白屏。
 */

import bus from './core/event-bus.js';
import { createLogger, setLogLevel } from './core/logger.js';
import { settings } from './core/settings-store.js';
import { fileSystem } from './core/fs/fs-service.js';
import { windowManager } from './core/window-manager.js';
import { notifications } from './core/notification.js';
import { processManager } from './core/process-manager.js';
import { appRegistry } from './core/app-registry.js';
import { installSDK } from './sdk/index.js';
import { wallpaper } from './shell/wallpaper.js';
import { contextMenu } from './shell/context-menu.js';
import { desktop } from './shell/desktop.js';
import { taskbar } from './shell/taskbar.js';
import { taskbarPreview } from './shell/taskbar-preview.js';
import { startMenu } from './shell/start-menu.js';
import { BUILTIN_APPS } from './apps/manifests.js';

const log = createLogger('Boot');

/** 各层容器 */
const layers = {};

/** 已初始化的模块，供热重载/卸载时逆序清理 */
const disposables = [];

async function boot() {
  const t0 = performance.now();

  // ---------- 0. 取得各层容器 ----------
  for (const name of ['wallpaper', 'desktop', 'window', 'shell', 'overlay']) {
    const el = document.getElementById(`${name}-layer`);
    if (!el) throw new Error(`缺少容器 #${name}-layer，index.html 可能已被修改`);
    layers[name] = el;
  }

  // ---------- 1. 设置 ----------
  settings.init();
  setLogLevel(settings.get('system.logLevel'));
  settings.subscribe('system.logLevel', (v) => setLogLevel(v));
  log.info('设置已加载');

  // ---------- 2. 文件系统 ----------
  // 失败不应阻断桌面启动（例如 IndexedDB 被浏览器策略禁用），降级为只读提示
  let fsReady = true;
  try {
    await fileSystem.init();
    log.info('文件系统已就绪');
  } catch (err) {
    fsReady = false;
    log.error('文件系统初始化失败，相关功能将不可用', err);
  }

  // ---------- 3. 内核 UI 服务 ----------
  windowManager.init(layers.window);
  notifications.init(layers.overlay);
  contextMenu.init(layers.overlay);

  // ---------- 4. SDK ----------
  installSDK();

  // ---------- 5. 内置应用清单（仅元数据） ----------
  appRegistry.registerAll(BUILTIN_APPS);
  log.info(`已注册 ${BUILTIN_APPS.length} 个内置应用`);

  // ---------- 6. Shell ----------
  await wallpaper.init(layers.wallpaper);
  taskbarPreview.init(layers.overlay);
  taskbar.init(layers.shell);
  startMenu.init(layers.overlay);
  await desktop.init(layers.desktop);

  disposables.push(desktop, taskbar, taskbarPreview, startMenu, wallpaper, contextMenu);

  // ---------- 7. 全局交互 ----------
  installGlobalHandlers();

  // ---------- 8. 收尾 ----------
  hideBootScreen();
  bus.emit('system:ready', {});
  log.info(`桌面启动完成，用时 ${Math.round(performance.now() - t0)}ms`);

  if (!fsReady) {
    notifications.toast({
      title: '存储不可用',
      body: '浏览器阻止了本地存储访问，文件相关功能将无法使用。',
      type: 'error',
      duration: 10000,
    });
  } else if (!settings.get('system.welcomed')) {
    settings.set('system.welcomed', true);
    notifications.toast({
      title: '欢迎使用 WindowsNext',
      body: '双击桌面图标启动应用，右键桌面可更换壁纸。',
      type: 'info',
      duration: 7000,
    });
  }
}

/* ============================================================
   全局交互
   ============================================================ */

function installGlobalHandlers() {
  // 禁用浏览器原生右键（Shell 有自己的菜单），但保留输入框内的原生菜单
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && (t.closest('input, textarea, [contenteditable="true"]') || t.isContentEditable)) return;
    // 已被 Shell 组件处理过的不再拦截
    if (e.defaultPrevented) return;
    e.preventDefault();
  });

  // 阻止整页拖放导致浏览器直接打开文件
  ['dragover', 'drop'].forEach((type) => {
    document.addEventListener(type, (e) => {
      if (e.target?.closest?.('.desktop-grid, .window')) return;
      e.preventDefault();
    });
  });

  // 阻止双指缩放与 Ctrl+滚轮缩放，保持桌面稳定
  document.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );

  // 兜底错误上报：应用内未捕获的异常不应静默丢失
  window.addEventListener('error', (e) => {
    log.error('未捕获异常', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    log.error('未处理的 Promise 拒绝', e.reason);
  });

  // 离开前提示（有窗口打开时）
  window.addEventListener('beforeunload', (e) => {
    if (windowManager.getAll().length > 0 && settings.get('system.confirmExit')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/* ============================================================
   启动遮罩
   ============================================================ */

function hideBootScreen() {
  const el = document.getElementById('boot-screen');
  if (!el) return;
  el.classList.add('is-hidden');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // 兜底：若无过渡动画也要移除
  setTimeout(() => el.remove(), 1200);
}

/**
 * 在启动遮罩上渲染致命错误
 * @param {any} err
 */
function showBootError(err) {
  const box = document.getElementById('boot-error');
  const screen = document.getElementById('boot-screen');
  if (screen) screen.classList.remove('is-hidden');
  if (!box) {
    // 遮罩已被移除时兜底
    alert(`WindowsNext 启动失败：\n${err?.stack || err}`);
    return;
  }
  box.hidden = false;
  box.innerHTML = `<strong>启动失败</strong><br><code>${escapeHtml(String(err?.stack || err?.message || err))}</code>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ============================================================
   入口
   ============================================================ */

boot().catch((err) => {
  console.error('[WindowsNext] 启动失败', err);
  showBootError(err);
});

// 便于调试：仅在 debug 日志级别下暴露内部引用
if (new URLSearchParams(location.search).has('debug')) {
  window.__WN__ = { bus, settings, fileSystem, windowManager, appRegistry, processManager, desktop, taskbar, startMenu, wallpaper };
  setLogLevel('debug');
}
