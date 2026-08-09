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

  // 进程变化时刷新
  ctx.events.on('process:changed', () => {
    if (activeTab === 'processes') render();
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