/**
 * top - 系统进程监控工具
 *
 * 模拟 Linux top 命令，在终端风格界面中：
 * - 实时显示所有运行中的进程（CPU、内存、状态）
 * - 支持键盘导航（↑↓ 选择进程）
 * - 支持终止选中进程（k / Delete）
 * - 显示系统资源总览
 * - 自动刷新
 */

import processManager from '../../core/process-manager.js';

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
        <p>确定要终止进程 <strong id="top-confirm-name"></strong> (PID: <span id="top-confirm-pid"></span>) 吗？</p>
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
  const confirmNameEl = root.querySelector('#top-confirm-name');
  const confirmPidEl = root.querySelector('#top-confirm-pid');
  const pauseIcon = root.querySelector('.top-pause-icon');
  const pauseLabel = root.querySelector('.top-pause-label');

  // ── 状态 ────────────────────────────────────────────────
  let processes = [];
  let selectedIdx = -1;
  let paused = false;
  let startTime = Date.now();
  let selectedPid = null;

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
        <td class="col-name">${p.icon ? getIcon(p.icon) + ' ' : ''}${p.name}</td>`;
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
    // 滚动到可视区域
    const row = tbody.querySelector('.is-selected');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function killSelected() {
    if (selectedIdx < 0 || selectedIdx >= processes.length) return;
    const proc = processes[selectedIdx];
    if (proc.system) {
      // 系统进程终止会触发蓝屏
      showConfirm(proc);
      return;
    }
    processManager.kill(proc.pid);
    if (selectedIdx >= processes.length - 1) selectedIdx = Math.max(0, processes.length - 2);
    render();
  }

  function showConfirm(proc) {
    selectedPid = proc.pid;
    confirmNameEl.textContent = proc.name;
    confirmPidEl.textContent = proc.pid;
    confirmEl.hidden = false;
  }

  function hideConfirm() {
    confirmEl.hidden = true;
    selectedPid = null;
  }

  function doKill() {
    if (selectedPid !== null) {
      processManager.kill(selectedPid);
      if (selectedIdx >= processes.length - 1) selectedIdx = Math.max(0, processes.length - 2);
      render();
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

  // 确认对话框
  root.querySelector('#top-confirm-yes').addEventListener('click', doKill);
  root.querySelector('#top-confirm-no').addEventListener('click', hideConfirm);
  confirmEl.addEventListener('click', (e) => {
    if (e.target === confirmEl) hideConfirm();
  });

  // 键盘
  root.addEventListener('keydown', (e) => {
    if (!confirmEl.hidden) {
      if (e.key === 'Escape') hideConfirm();
      if (e.key === 'Enter') doKill();
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

  // ── 初始渲染 ────────────────────────────────────────────
  render();

  // ── 清理 ────────────────────────────────────────────────
  ctx.events.on('window:closed', (payload) => {
    if (payload.window === ctx.window) {
      clearInterval(timer);
      unsubStarted();
      unsubEnded();
    }
  });
}
