/**
 * 任务管理器
 *
 * 两个标签页：
 *   - 进程：列出运行中的应用（来自 ProcessManager），含模拟的 CPU/内存占用，
 *           可右键结束任务
 *   - 性能：ECharts 实时绘制 CPU 与内存占用率曲线（采样间隔 1s，环形缓冲 60 点）
 *
 * 进程示例：系统进程（含 shell 自身）由 processManager 报告，应用进程与窗口一一对应。
 * 模拟数据采用 1s 间隔的随机游走，让曲线看起来「活的」又不至于太剧烈。
 *
 * 窗口最小化时通过监听 window:minimized 暂停采样。
 *
 * 彩蛋：用户可以结束「WindowsNext 桌面外壳」系统进程，触发蓝屏重启序列。
 */

import bus from '../../core/event-bus.js';
import { ensureECharts } from '../calculator/echarts-loader.js';
import { windowManager } from '../../core/window-manager.js';
import { processManager } from '../../core/process-manager.js';
import { contextMenu } from '../../shell/context-menu.js';

const SAMPLE_INTERVAL = 1000;
const BUFFER_SIZE = 60;

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./task-manager.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'tm2-root';
  root.innerHTML = `
    <div class="tm2-tabs">
      <button class="is-active" data-tab="processes">进程</button>
      <button data-tab="performance">性能</button>
      <div class="tm2-spacer"></div>
      <button class="tm2-refresh" title="刷新">刷新</button>
    </div>
    <div class="tm2-body"></div>`;
  ctx.root.appendChild(root);

  const tabsEl = root.querySelector('.tm2-tabs');
  const body = root.querySelector('.tm2-body');

  let activeTab = 'processes';
  let samplingTimer = 0;
  let chart = null;
  const buffer = { cpu: [], mem: [], labels: [] };

  function render() {
    body.innerHTML = '';
    for (const b of tabsEl.querySelectorAll('button')) b.classList.toggle('is-active', b.dataset.tab === activeTab);
    if (activeTab === 'processes') renderProcesses(body);
    else renderPerformance(body);
  }

  /* ============================================================
     进程
     ============================================================ */

  function renderProcesses(container) {
    container.innerHTML = `
      <div class="tm2-table">
        <div class="tm2-row tm2-head">
          <span>应用</span>
          <span>PID</span>
          <span>状态</span>
          <span>CPU</span>
          <span>内存</span>
          <span>窗口</span>
        </div>
        <div class="tm2-list"></div>
      </div>`;
    const list = container.querySelector('.tm2-list');
    const processes = processManager.list();

    for (const p of processes) {
      // 通过 windowId 查找对应窗口（一个进程对应一个窗口）
      const procWindows = p.windowId
        ? windowManager.getAll().filter((w) => w.id === p.windowId && !w.isDestroyed)
        : [];
      const windowCount = procWindows.length;

      const row = document.createElement('div');
      row.className = 'tm2-row';
      row.innerHTML = `
        <span class="tm2-app">${escapeHtml(p.name)}</span>
        <span class="tm2-pid">${p.pid}</span>
        <span class="tm2-state">${p.system ? '系统' : (windowCount ? '运行中' : '已停止')}</span>
        <span class="tm2-cpu">${(p.cpu || 0).toFixed(1)}%</span>
        <span class="tm2-mem">${formatMb(p.memory || 0)}</span>
        <span class="tm2-windows">${windowCount}</span>`;
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        // "切换到"：聚焦第一个关联窗口
        const focusWindow = procWindows[0];
        const items = [
          {
            id: 'focus',
            label: '切换到',
            icon: 'window',
            disabled: !focusWindow,
            onClick: () => focusWindow && windowManager.focus(focusWindow),
          },
        ];

        // "结束任务"：系统进程也可以结束（彩蛋），但需要确认
        items.push({
          id: 'close',
          label: '结束任务',
          icon: 'close',
          danger: true,
          disabled: false,
          onClick: async () => {
            const confirmMsg = p.system
              ? '警告：您即将结束系统关键进程「WindowsNext 桌面外壳」。\n这可能导致桌面环境崩溃。确定要继续吗？'
              : `确定要结束任务「${p.name}」吗？`;
            const ok = await ctx.dialog.confirm(confirmMsg, '结束任务', { okLabel: p.system ? '强制结束' : '结束任务' });
            if (ok) processManager.kill(p.pid);
          },
        });

        contextMenu.open(items, e.clientX, e.clientY);
      });
      list.appendChild(row);
    }
  }

  /* ============================================================
     性能
     ============================================================ */

  async function renderPerformance(container) {
    container.innerHTML = `
      <div class="perf-grid">
        <div class="perf-card">
          <div class="perf-title">CPU 使用率</div>
          <div class="perf-value" data-perf="cpu">0%</div>
          <div class="perf-chart"><div class="perf-chart-inner" data-chart="cpu"></div></div>
        </div>
        <div class="perf-card">
          <div class="perf-title">内存</div>
          <div class="perf-value" data-perf="mem">0 / 0 MB</div>
          <div class="perf-chart"><div class="perf-chart-inner" data-chart="mem"></div></div>
        </div>
      </div>`;

    const echarts = await ensureECharts();
    if (!echarts) {
      container.querySelector('[data-chart="cpu"]').textContent = '无法加载 ECharts';
      return;
    }

    const cpuChart = echarts.init(container.querySelector('[data-chart="cpu"]'), null, { renderer: 'canvas' });
    const memChart = echarts.init(container.querySelector('[data-chart="mem"]'), null, { renderer: 'canvas' });
    chart = { cpu: cpuChart, mem: memChart };

    ctx.observeResize(container.querySelector('[data-chart="cpu"]'), () => cpuChart.resize());
    ctx.observeResize(container.querySelector('[data-chart="mem"]'), () => memChart.resize());

    const option = (name, color) => ({
      animation: false,
      grid: { left: 36, right: 12, top: 8, bottom: 22 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      xAxis: {
        type: 'category',
        data: buffer.labels,
        show: false,
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: name === 'cpu' ? 25 : 600,
        splitLine: { lineStyle: { type: 'dashed', color: '#ddd' } },
        axisLabel: { color: '#888', fontSize: 10 },
        splitNumber: 4,
      },
      series: [{
        name,
        type: 'line',
        smooth: true,
        showSymbol: false,
        sampling: 'lttb',
        areaStyle: { color: color + '30' },
        lineStyle: { width: 1.5, color },
        itemStyle: { color },
        data: buffer[name],
      }],
    });
    cpuChart.setOption(option('cpu', '#0078D4'));
    memChart.setOption(option('mem', '#107C10'));

    startSampling();
  }

  function startSampling() {
    stopSampling();
    // 立即推一个点避免图表空
    pushSample();
    samplingTimer = ctx.setInterval(pushSample, SAMPLE_INTERVAL);
  }

  function stopSampling() {
    if (samplingTimer) clearInterval(samplingTimer);
    samplingTimer = 0;
  }

  function pushSample() {
    // 聚合：CPU/内存 = 所有进程均值（系统进程含内核/Shell）
    const procs = processManager.list();
    const cpu = procs.length ? procs.reduce((s, p) => s + (p.cpu || 0), 0) / procs.length : 0;
    const mem = procs.reduce((s, p) => s + (p.memory || 0), 0);
    const memPct = Math.min(100, (mem / (1024 * 4)) * 100); // 假设 4GB 上限

    buffer.cpu.push(Number(cpu.toFixed(1)));
    buffer.mem.push(Number(memPct.toFixed(1)));
    buffer.labels.push('');
    if (buffer.cpu.length > BUFFER_SIZE) {
      buffer.cpu.shift();
      buffer.mem.shift();
      buffer.labels.shift();
    }
    if (chart) {
      chart.cpu.setOption({
        xAxis: { data: buffer.labels },
        series: [{ data: buffer.cpu }],
      });
      chart.mem.setOption({
        xAxis: { data: buffer.labels },
        series: [{ data: buffer.mem }],
      });
    }
    const cpuEl = body.querySelector('[data-perf="cpu"]');
    const memEl = body.querySelector('[data-perf="mem"]');
    if (cpuEl) cpuEl.textContent = `${cpu.toFixed(1)}%`;
    if (memEl) memEl.textContent = `${formatMb(mem)} / 4096 MB`;
  }

  // ── 事件 ────────────────────────────────────────────
  tabsEl.addEventListener('click', (e) => {
    const t = e.target.dataset.tab;
    if (!t) return;
    if (t === activeTab) return;
    stopSampling();
    if (chart) { chart.cpu.dispose(); chart.mem.dispose(); chart = null; }
    activeTab = t;
    render();
  });

  root.querySelector('.tm2-refresh').addEventListener('click', () => {
    if (activeTab === 'processes') render();
    else pushSample();
  });

  // 进程启动时刷新进程列表
  ctx.events.on('process:started', () => {
    if (activeTab === 'processes') render();
  });

  // 进程结束时刷新进程列表
  ctx.events.on('process:ended', () => {
    if (activeTab === 'processes') render();
  });

  // 监听 kill-requested：关闭对应窗口，并检测彩蛋
  const onKillRequested = (payload) => {
    const proc = payload?.process;
    if (!proc) return;

    // 彩蛋：系统进程被结束 → 触发蓝屏重启
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

    // 刷新进程列表
    if (activeTab === 'processes') render();
  };
  ctx.events.on('process:kill-requested', onKillRequested);

  // 窗口关闭时清理对应进程记录
  ctx.events.on('window:closed', (payload) => {
    const windowId = payload?.id;
    if (!windowId) return;
    const proc = processManager.getByWindowId(windowId);
    if (proc) {
      processManager.unregister(proc.pid);
    }
  });

  // 窗口最小化时暂停采样
  let sampling = true;
  ctx.events.on('window:minimized', (payload) => {
    if (payload?.window?.id === ctx.window.id) {
      sampling = false;
      stopSampling();
    }
  });
  ctx.events.on('window:restored', (payload) => {
    if (payload?.window?.id === ctx.window.id && !sampling) {
      sampling = true;
      if (activeTab === 'performance') startSampling();
    }
  });

  ctx.onDispose(() => {
    stopSampling();
    chart?.cpu?.dispose();
    chart?.mem?.dispose();
  });

  render();

  ctx.setPreviewProvider(() => {
    const procs = processManager.list();
    return `${procs.length} 个进程 · CPU ${procs.length ? (procs.reduce((s, p) => s + (p.cpu || 0), 0) / procs.length).toFixed(0) : 0}%`;
  });

  /* ============================================================
     彩蛋：终止 WindowsNext 桌面外壳 → 蓝屏重启
     ============================================================ */

  function triggerBsodRestart() {
    // 1. 关闭所有应用窗口
    for (const w of windowManager.getAll()) {
      if (!w.isDestroyed) {
        try { w.close(); } catch { /* 忽略关闭错误 */ }
      }
    }

    // 2. 清除 processManager 中的所有进程
    for (const p of processManager.list()) {
      try { processManager.unregister(p.pid); } catch { /* 忽略 */ }
    }

    // 3. 渲染蓝屏
    renderBsodScreen();
  }

  function renderBsodScreen() {
    const bootScreen = document.getElementById('boot-screen');
    if (!bootScreen) return;

    // 设置蓝屏状态
    document.body.setAttribute('data-bsod', 'true');
    document.documentElement.setAttribute('data-theme', 'dark');

    // 注入蓝屏 HTML 结构
    bootScreen.innerHTML = `
      <div class="bsod" role="alertdialog" aria-live="assertive">
        <p class="bsod-face">:(</p>
        <h1 class="bsod-title">你的电脑遇到问题，需要重新启动。</h1>
        <p class="bsod-reason">
          <strong>关键系统进程已终止</strong>
          &nbsp;WindowsNext 桌面外壳进程已被强制结束，系统无法继续运行。
        </p>
        <p class="bsod-progress">我们正在收集一些错误信息，完成度&nbsp;
          <span class="bsod-percent" id="bsod-percent-js"></span>%，然后你可以重新启动。</p>
        <div class="bsod-detail">
          <div class="bsod-qr" aria-hidden="true"></div>
          <div class="bsod-info">
            <p class="bsod-label">若想了解详细信息，你以后可以联机搜索此错误：</p>
            <p class="bsod-code">停止代码：CRITICAL_PROCESS_DIED</p>
            <p class="bsod-code">失败的进程：WindowsNext 桌面外壳 (PID: ${processManager._systemPid || 'N/A'})</p>
            <p class="bsod-code">错误来源：task-manager (手动终止)</p>
          </div>
        </div>
        <div class="bsod-fix">
          <p>系统将在收集完错误信息后自动重新启动。</p>
        </div>
      </div>`;

    // 确保蓝屏可见（覆盖 boot-screen 的原有样式）
    bootScreen.style.display = 'block';
    bootScreen.style.opacity = '1';
    bootScreen.style.visibility = 'visible';
    bootScreen.style.pointerEvents = 'auto';

    // 4. JS 驱动的进度条动画（0% → 100%，约 9 秒）
    const percentEl = document.getElementById('bsod-percent-js');
    if (!percentEl) return;

    let progress = 0;
    const totalDuration = 9000;  // 9 秒总动画时长
    const steps = 100;
    const stepDuration = totalDuration / steps;

    const progressTimer = setInterval(() => {
      progress++;
      percentEl.textContent = String(progress);
      if (progress >= 100) {
        clearInterval(progressTimer);
        // 5. 进度到 100% 后等待 10 秒，然后自动重启
        setTimeout(() => restartShell(), 10000);
      }
    }, stepDuration);
  }

  function restartShell() {
    // 移除蓝屏状态
    document.body.removeAttribute('data-bsod');
    document.documentElement.removeAttribute('data-theme');

    const bootScreen = document.getElementById('boot-screen');
    if (bootScreen) {
      // 显示重启引导画面
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

    // 延迟后执行「重启」：重新初始化桌面外壳
    setTimeout(async () => {
      try {
        // 重新注册系统进程（使用 register 方法确保 pid 正确递增）
        const shellProc = processManager.register({
          appId: '_shell',
          name: 'WindowsNext 桌面外壳',
          icon: 'monitor',
          windowId: '',
        });
        // 标记为系统进程
        shellProc.system = true;
        processManager._systemPid = shellProc.pid;

        // 隐藏启动遮罩
        const bs = document.getElementById('boot-screen');
        if (bs) {
          bs.classList.add('is-hidden');
          bs.addEventListener('transitionend', () => bs.remove(), { once: true });
          setTimeout(() => bs.remove(), 1200);
        }

        // 恢复主题
        const savedTheme = ctx.settings.get('appearance.theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        // 发送系统就绪事件，让桌面恢复正常
        bus.emit('system:ready', { restarted: true });

        ctx.notify.toast({
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

function formatMb(mb) {
  // input is already MB (from ProcessManager baseline / sampling)
  if (!mb) return '0 MB';
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}