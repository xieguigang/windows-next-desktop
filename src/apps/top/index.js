/**
 * top - 系统进程监控工具
 *
 * 模拟 Linux top 命令，在终端风格界面中：
 * - 实时显示所有运行中的进程（CPU、内存、状态）
 * - 支持键盘导航（↑↓ 选择进程）
 * - 支持终止选中进程（k / Delete），包括系统进程（触发蓝屏彩蛋）
 * - 显示系统资源总览
 * - 自动刷新
 *
 * 与任务管理器行为一致：
 * - 自动刷新应用列表
 * - 终止系统进程触发蓝屏重启
 */

import bus from '../../core/event-bus.js';
import { windowManager } from '../../core/window-manager.js';
import { processManager } from '../../core/process-manager.js';
import { settings } from '../../core/settings-store.js';
import { notifications } from '../../core/notification.js';

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./top.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'top-root';
  root.innerHTML = `
    <div class="top-header">
      <div class="top-title">
        <span class="top-icon">▣</span>
        <span>top - 系统进程监控</span>
      </div>
      <div class="top-controls">
        <button class="top-btn" data-action="kill" title="终止进程 (k)">终止进程</button>
        <button class="top-btn" data-action="refresh" title="刷新 (r)">刷新</button>
        <button class="top-btn" data-action="pause" title="暂停/恢复自动刷新 (Space)">
          <span class="top-pause-icon">⏸</span> <span class="top-pause-label">暂停</span>
        </button>
      </div>
    </div>
    <div class="top-summary">
      <div class="top-summary-item">
        <span class="top-label">任务:</span>
        <span class="top-val" id="top-tasks">0</span>
      </div>
      <div class="top-summary-item">
        <span class="top-label">CPU:</span>
        <span class="top-val" id="top-cpu">0%</span>
      </div>
      <div class="top-summary-item">
        <span class="top-label">内存:</span>
        <span class="top-val" id="top-mem">0 MB</span>
      </div>
      <div class="top-summary-item">
        <span class="top-label">运行时间:</span>
        <span class="top-val" id="top-uptime">0s</span>
      </div>
    </div>
    <div class="top-table-wrap">
      <table class="top-table">
        <thead>
          <tr>
            <th class="col-pid">PID</th>
            <th class="col-user">用户</th>
            <th class="col-cpu">CPU%</th>
            <th class="col-mem">内存</th>
            <th class="col-status">状态</th>
            <th class="col-name">进程名</th>
          </tr>
        </thead>
        <tbody id="top-tbody"></tbody>
      </table>
    </div>
    <div class="top-footer">
      <span>↑↓ 选择进程</span>
      <span class="top-sep">|</span>
      <span>k / Delete 终止进程</span>
      <span class="top-sep">|</span>
      <span>r 刷新</span>
      <span class="top-sep">|</span>
      <span>Space 暂停/恢复</span>
      <span class="top-sep">|</span>
      <span>q 退出</span>
    </div>
    <div class="top-confirm" id="top-confirm" hidden>
      <div class="top-confirm-box">
        <p id="top-confirm-msg">确定要终止该进程吗？</p>
        <div class="top-confirm-actions">
          <button class="top-btn top-btn-danger" id="top-confirm-yes">确认终止</button>
          <button class="top-btn" id="top-confirm-no">取消</button>
        </div>
      </div>
    </div>`;

  ctx.root.appendChild(root);

  // ── DOM 引用 ────────────────────────────────────────────
  const tbody = root.querySelector('#top-tbody');
  const tasksEl = root.querySelector('#top-tasks');
  const cpuEl = root.querySelector('#top-cpu');
  const memEl = root.querySelector('#top-mem');
  const uptimeEl = root.querySelector('#top-uptime');
  const confirmEl = root.querySelector('#top-confirm');
  const confirmMsgEl = root.querySelector('#top-confirm-msg');
  const confirmYesEl = root.querySelector('#top-confirm-yes');
  const confirmNoEl = root.querySelector('#top-confirm-no');
  const pauseIcon = root.querySelector('.top-pause-icon');
  const pauseLabel = root.querySelector('.top-pause-label');

  // ── 状态 ────────────────────────────────────────────────
  let processes = [];
  let selectedIdx = -1;
  let paused = false;
  let startTime = Date.now();
  let pendingKillPid = null;

  // ── 渲染 ────────────────────────────────────────────────
  function render() {
    const system = processManager.getSystemStats();
    tasksEl.textContent = `${system.processes} 个进程`;
    cpuEl.textContent = `${system.cpu}%`;
    memEl.textContent = `${system.memory} / ${system.memoryTotal} MB`;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    uptimeEl.textContent = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;

    processes = processManager.list().sort((a, b) => b.cpu - a.cpu);
    tbody.innerHTML = '';

    if (processes.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="6" class="top-empty">没有运行中的进程</td>';
      tbody.appendChild(tr);
      return;
    }

    // 确保 selectedIdx 有效
    if (selectedIdx >= processes.length) selectedIdx = processes.length - 1;

    for (let i = 0; i < processes.length; i++) {
      const p = processes[i];
      const tr = document.createElement('tr');
      tr.className = `top-row${i === selectedIdx ? ' is-selected' : ''}${p.system ? ' is-system' : ''}`;
      tr.dataset.index = i;
      tr.dataset.pid = p.pid;

      const cpuColor = p.cpu > 20 ? 'cpu-high' : p.cpu > 5 ? 'cpu-mid' : 'cpu-low';
      const memColor = p.memory > 200 ? 'mem-high' : p.memory > 80 ? 'mem-mid' : 'mem-low';
      const statusClass = p.status === 'running' ? 'status-running' : 'status-suspended';

      tr.innerHTML = `
        <td class="col-pid">${p.pid}</td>
        <td class="col-user">${p.system ? 'SYSTEM' : 'user'}</td>
        <td class="col-cpu ${cpuColor}">${p.cpu.toFixed(1)}</td>
        <td class="col-mem ${memColor}">${p.memory} MB</td>
        <td class="col-status ${statusClass}">${p.status === 'running' ? '运行中' : '已暂停'}</td>
        <td class="col-name">${getIcon(p.icon) + ' '}${escapeHtml(p.name)}</td>`;
      tbody.appendChild(tr);
    }
  }

  function getIcon(name) {
    const icons = {
      explorer: '📁', notepad: '📝', terminal: '⬛', calculator: '🔢',
      browser: '🌐', 'media-player': '🎬', 'image-viewer': '🖼',
      'task-manager': '📊', settings: '⚙', monitor: '🖥',
      hello: '👋',
    };
    return icons[name] || '📄';
  }

  function updateSelection(delta) {
    if (processes.length === 0) {
      selectedIdx = -1;
      return;
    }
    if (selectedIdx === -1) {
      selectedIdx = delta > 0 ? 0 : processes.length - 1;
    } else {
      selectedIdx = (selectedIdx + delta + processes.length) % processes.length;
    }
    render();
    const row = tbody.querySelector('.is-selected');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  // ── 终止进程（与 task-manager 行为一致） ─────────────────
  function killSelected() {
    if (selectedIdx < 0 || selectedIdx >= processes.length) return;
    const proc = processes[selectedIdx];

    // 系统进程需要确认
    if (proc.system) {
      showConfirm(proc);
      return;
    }

    // 普通进程直接终止
    doKillProcess(proc.pid);
  }

  function showConfirm(proc) {
    pendingKillPid = proc.pid;
    if (proc.system) {
      confirmMsgEl.textContent = '⚠ 警告：你即将终止系统关键进程「' + proc.name + '」。这可能导致桌面环境崩溃并触发蓝屏重启。确定要继续吗？';
    } else {
      confirmMsgEl.textContent = '确定要终止进程「' + proc.name + '」(PID: ' + proc.pid + ') 吗？';
    }
    confirmEl.hidden = false;
  }

  function hideConfirm() {
    confirmEl.hidden = true;
    pendingKillPid = null;
  }

  function doKillProcess(pid) {
    const proc = processManager.processes.get(pid);
    if (!proc) return;

    // 与 task-manager 行为一致：
    // processManager.kill 会发出 'process:kill-requested' 事件
    // 如果是系统进程，task-manager 中的监听器会触发 triggerBsodRestart
    processManager.kill(pid);

    // 更新选中索引
    if (selectedIdx >= processes.length - 1) {
      selectedIdx = Math.max(0, processes.length - 2);
    }
    render();
  }

  function confirmKill() {
    if (pendingKillPid !== null) {
      doKillProcess(pendingKillPid);
    }
    hideConfirm();
  }

  function togglePause() {
    paused = !paused;
    pauseIcon.textContent = paused ? '▶' : '⏸';
    pauseLabel.textContent = paused ? '恢复' : '暂停';
  }

  // ── 事件 ────────────────────────────────────────────────
  root.addEventListener('click', (e) => {
    // 处理确认对话框按钮
    if (e.target === confirmYesEl) {
      confirmKill();
      return;
    }
    if (e.target === confirmNoEl) {
      hideConfirm();
      return;
    }
    // 点击对话框背景关闭
    if (e.target === confirmEl) {
      hideConfirm();
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'kill') killSelected();
    else if (action === 'refresh') render();
    else if (action === 'pause') togglePause();
  });

  // 表格行点击选择
  tbody.addEventListener('click', (e) => {
    const row = e.target.closest('.top-row');
    if (!row) return;
    selectedIdx = parseInt(row.dataset.index);
    render();
  });

  // 双击行直接终止
  tbody.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.top-row');
    if (!row) return;
    selectedIdx = parseInt(row.dataset.index);
    killSelected();
  });

  // 键盘
  root.addEventListener('keydown', (e) => {
    if (!confirmEl.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); hideConfirm(); }
      if (e.key === 'Enter') { e.preventDefault(); confirmKill(); }
      return;
    }
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); updateSelection(-1); break;
      case 'ArrowDown': e.preventDefault(); updateSelection(1); break;
      case 'k': case 'Delete': e.preventDefault(); killSelected(); break;
      case 'r': e.preventDefault(); render(); break;
      case ' ': e.preventDefault(); togglePause(); break;
      case 'q': e.preventDefault(); ctx.window.close(); break;
      case 'Escape': e.preventDefault(); ctx.window.close(); break;
    }
  });

  // 自动聚焦
  root.tabIndex = 0;
  root.focus();

  ctx.events.on('window:focused', () => {
    if (ctx.window.isActive) root.focus();
  });

  // ── 自动刷新 ────────────────────────────────────────────
  let timer = setInterval(() => {
    if (!paused && !document.hidden) render();
  }, 1500);

  // 订阅进程事件
  const unsubStarted = ctx.events.on('process:started', () => { if (!paused) render(); });
  const unsubEnded = ctx.events.on('process:ended', () => { if (!paused) render(); });

  // 监听 kill-requested（与 task-manager 行为一致）：关闭对应窗口
  const unsubKillRequested = ctx.events.on('process:kill-requested', (payload) => {
    const proc = payload?.process;
    if (!proc) return;

    // 系统进程被结束 → 触发蓝屏重启（彩蛋）
    if (payload.isSystem && proc.appId === '_shell') {
      triggerBsodRestart();
      return;
    }

    // 普通进程：关闭对应窗口
    if (proc.windowId) {
      const win = windowManager.get(proc.windowId);
      if (win && !win.isDestroyed) {
        win.close();
      }
    }

    render();
  });

  // 窗口关闭时清理对应进程记录
  const unsubWindowClosed = ctx.events.on('window:closed', (payload) => {
    const windowId = payload?.id;
    if (!windowId) return;
    const proc = processManager.getByWindowId(windowId);
    if (proc) {
      processManager.unregister(proc.pid);
    }
    if (!paused) render();
  });

  // ── 初始渲染 ────────────────────────────────────────────
  render();

  // ── 清理 ────────────────────────────────────────────────
  const unsubCleanup = ctx.events.on('window:closed', (payload) => {
    if (payload.window === ctx.window) {
      clearInterval(timer);
      unsubStarted();
      unsubEnded();
      unsubKillRequested();
      unsubWindowClosed();
      unsubCleanup();
    }
  });

  // ── 蓝屏重启彩蛋（与 task-manager 行为一致） ────────────
  function triggerBsodRestart() {
    // 1. 关闭所有应用窗口
    for (const w of windowManager.getAll()) {
      if (!w.isDestroyed) {
        try { w.close(); } catch { /* 忽略 */ }
      }
    }

    // 2. 清除所有进程
    for (const p of processManager.list()) {
      try { processManager.unregister(p.pid); } catch { /* 忽略 */ }
    }

    // 3. 渲染蓝屏
    renderBsodScreen();
  }

  function renderBsodScreen() {
    let bootScreen = document.getElementById('boot-screen');
    if (!bootScreen) {
      bootScreen = document.createElement('div');
      bootScreen.id = 'boot-screen';
      bootScreen.className = 'boot-screen';
      document.body.appendChild(bootScreen);
    }

    document.body.setAttribute('data-bsod', 'true');
    document.documentElement.setAttribute('data-theme', 'dark');

    bootScreen.innerHTML = `
      <div class="bsod" role="alertdialog" aria-live="assertive">
        <p class="bsod-face">:(</p>
        <h1 class="bsod-title">你的电脑遇到问题，需要重新启动。</h1>
        <p class="bsod-reason">
          <strong>关键系统进程已终止</strong>
          &nbsp;WindowsNext 桌面外壳进程已被 top 强制结束，系统无法继续运行。
        </p>
        <p class="bsod-progress">我们正在收集一些错误信息，完成度&nbsp;
          <span class="bsod-percent" id="bsod-percent-js"></span>%，然后你可以重新启动。</p>
        <div class="bsod-detail">
          <div class="bsod-qr" aria-hidden="true"></div>
          <div class="bsod-info">
            <p class="bsod-label">若想了解详细信息，你以后可以联机搜索此错误：</p>
            <p class="bsod-code">停止代码：CRITICAL_PROCESS_DIED</p>
            <p class="bsod-code">失败的进程：WindowsNext 桌面外壳</p>
            <p class="bsod-code">错误来源：top (手动终止)</p>
          </div>
        </div>
        <div class="bsod-fix">
          <p>系统将在收集完错误信息后自动重新启动。</p>
        </div>
      </div>`;

    bootScreen.style.display = 'block';
    bootScreen.style.opacity = '1';
    bootScreen.style.visibility = 'visible';
    bootScreen.style.pointerEvents = 'auto';

    const percentEl = document.getElementById('bsod-percent-js');
    if (!percentEl) return;

    let progress = 0;
    const totalDuration = 9000;
    const steps = 100;
    const stepDuration = totalDuration / steps;

    const progressTimer = window.setInterval(() => {
      progress++;
      if (percentEl) percentEl.textContent = String(progress);
      if (progress >= 100) {
        clearInterval(progressTimer);
        window.setTimeout(() => restartShell(), 10000);
      }
    }, stepDuration);
  }

  function restartShell() {
    document.body.removeAttribute('data-bsod');
    document.documentElement.removeAttribute('data-theme');

    const bootScreen = document.getElementById('boot-screen');
    if (bootScreen) {
      bootScreen.innerHTML = `
        <div class="boot-logo">
          <svg viewBox="0 0 24 24" width="72" height="72" aria-hidden="true">
            <path fill="currentColor" d="M3 5.5 10.2 4.5v6.9H3V5.5Zm0 13L10.2 19.5v-6.8H3v5.8Zm8.4 1.2L21 21V12.7h-9.6v7Zm0-15.4v7.1H21V3l-9.6 1.3Z"/>
          </svg>
        </div>
        <div class="boot-spinner" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <div class="boot-text">正在重新启动 Windows Next …</div>
        <div class="boot-error" id="boot-error" hidden></div>`;
      bootScreen.style.display = '';
      bootScreen.style.opacity = '';
      bootScreen.style.visibility = '';
      bootScreen.style.pointerEvents = '';
    }

    window.setTimeout(async () => {
      try {
        const shellProc = processManager.register({
          appId: '_shell',
          name: 'WindowsNext 桌面外壳',
          icon: 'monitor',
          windowId: '',
        });
        shellProc.system = true;
        processManager._systemPid = shellProc.pid;

        const bs = document.getElementById('boot-screen');
        if (bs) {
          bs.classList.add('is-hidden');
          bs.addEventListener('transitionend', () => bs.remove(), { once: true });
          setTimeout(() => bs.remove(), 1200);
        }

        const savedTheme = settings.get('appearance.theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        bus.emit('system:ready', { restarted: true });

        notifications.toast({
          title: '系统已重启',
          body: 'WindowsNext 桌面外壳已成功重新启动。下次请不要随意终止系统进程哦~',
          type: 'info',
          duration: 8000,
        });
      } catch (err) {
        console.error('重启桌面外壳失败', err);
      }
    }, 2000);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
