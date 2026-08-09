/**
 * 计算器
 *
 * 三种模式：
 *   standard - 标准四则运算（默认窗口高度）
 *   scientific - 科学模式（多了函数/常量按钮与历史）
 *   plot - 函数绘图（ECharts 折线图，支持多函数、定义域设置）
 *
 * 体验细节：
 *   - 键盘直接输入（数字、+ - * / ^ ( )，Enter 计算，Esc 清空，Backspace 退格）
 *   - 错误用红色显示在表达式栏（不弹窗，不打断输入）
 *   - 历史记录：科学模式下侧栏展示；标准模式隐藏以节省空间
 */

import { compile, evaluate, sanitizeSamples } from './expression.js';
import { ensureECharts } from './echarts-loader.js';

const STANDARD_LAYOUT = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '0', '.', '='],
];
const SCI_LAYOUT = [
  ['sin', 'cos', 'tan', 'π', 'C'],
  ['asin', 'acos', 'atan', 'e', '±'],
  ['ln', 'log', '√', 'x²', '%'],
  ['(', ')', 'x^y', '÷', '×'],
  ['7', '8', '9', '−', '/'],
  ['4', '5', '6', '+', '%'],
  ['1', '2', '3', 'ln', 'log'],
  ['0', '.', 'x', '√x', '='],
];

const HISTORY_LIMIT = 20;

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./calculator.css', import.meta.url).href);

  let mode = ctx.settings.getLocal('mode', 'standard');
  let expression = '';
  let preview = '';
  let lastResult = '';
  let error = '';
  let history = ctx.settings.getLocal('history', []);

  const root = document.createElement('div');
  root.className = `calc-root mode-${mode}`;
  root.innerHTML = `
    <div class="calc-header">
      <div class="calc-mode">
        <button data-mode="standard" class="is-active">标准</button>
        <button data-mode="scientific">科学</button>
        <button data-mode="plot">绘图</button>
      </div>
    </div>
    <div class="calc-body"></div>`;
  ctx.root.appendChild(root);
  const body = root.querySelector('.calc-body');

  root.querySelector('.calc-mode').addEventListener('click', (e) => {
    const m = e.target.dataset.mode;
    if (!m) return;
    mode = m;
    ctx.settings.setLocal('mode', m);
    [...root.querySelectorAll('.calc-mode button')].forEach((b) => b.classList.toggle('is-active', b.dataset.mode === m));
    render();
  });

  function render() {
    root.className = `calc-root mode-${mode}`;
    body.innerHTML = '';
    if (mode === 'plot') return renderPlot(body);
    renderCalculator(body);
  }

  function renderCalculator(container) {
    const useSci = mode === 'scientific';
    container.innerHTML = `
      <div class="calc-display">
        <div class="calc-expr">${expression ? escapeHtml(expression) : '0'}</div>
        <div class="calc-preview ${preview ? '' : 'is-empty'}">${preview ? `= ${preview}` : (error || ' ')}</div>
      </div>
      <div class="calc-keys ${useSci ? 'is-sci' : ''}"></div>
      ${useSci ? '<div class="calc-history"><h4>历史记录</h4><div class="ch-list"></div></div>' : ''}
    `;
    const keysEl = container.querySelector('.calc-keys');
    const layout = useSci ? SCI_LAYOUT : STANDARD_LAYOUT;
    for (const row of layout) {
      const r = document.createElement('div');
      r.className = 'calc-row';
      for (const label of row) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'calc-key';
        btn.textContent = label;
        btn.dataset.key = label;
        if ('0123456789.'.includes(label)) btn.dataset.kind = 'num';
        else if ('+-×÷%'.includes(label)) btn.dataset.kind = 'op';
        else if (label === '=' || label === 'C') btn.dataset.kind = 'action';
        r.appendChild(btn);
      }
      keysEl.appendChild(r);
    }

    container.querySelectorAll('.calc-key').forEach((btn) => {
      btn.addEventListener('click', () => handleKey(btn.dataset.key));
    });

    if (useSci) {
      const list = container.querySelector('.ch-list');
      renderHistory(list);
    }
  }

  function renderHistory(container) {
    if (!history.length) {
      container.innerHTML = '<div class="ch-empty">暂无历史</div>';
      return;
    }
    container.innerHTML = '';
    for (const h of history.slice(-HISTORY_LIMIT).reverse()) {
      const el = document.createElement('button');
      el.className = 'ch-item';
      el.type = 'button';
      el.innerHTML = `<span class="ch-expr">${escapeHtml(h.expr)}</span><span class="ch-result">${escapeHtml(String(h.result))}</span>`;
      el.addEventListener('click', () => {
        expression = h.expr;
        refreshDisplay();
        refreshPreview();
      });
      container.appendChild(el);
    }
  }

  function refreshDisplay() {
    const exprEl = body.querySelector('.calc-expr');
    const prevEl = body.querySelector('.calc-preview');
    if (!exprEl) return;
    exprEl.textContent = expression || '0';
    if (error) {
      prevEl.textContent = error;
      prevEl.classList.add('is-err');
      prevEl.classList.remove('is-empty');
    } else if (preview) {
      prevEl.textContent = `= ${preview}`;
      prevEl.classList.remove('is-err', 'is-empty');
    } else {
      prevEl.textContent = ' ';
      prevEl.classList.add('is-empty');
      prevEl.classList.remove('is-err');
    }
  }

  function refreshPreview() {
    error = '';
    preview = '';
    if (!expression) return refreshDisplay();
    try {
      // 把可视化符号换回运算符再算
      const norm = expression
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')
        .replace(/π/g, 'pi');
      const v = evaluate(norm);
      if (Number.isFinite(v)) preview = formatResult(v);
      else { preview = ''; error = '∞'; }
    } catch (err) {
      // 表达式不完整时静默（不报红）
      if (err instanceof SyntaxError && err.message.includes('缺少操作数')) return refreshDisplay();
      error = err.message;
    }
    refreshDisplay();
  }

  function handleKey(key) {
    if (key === 'C') { expression = ''; preview = ''; error = ''; }
    else if (key === '±') {
      if (expression.startsWith('-')) expression = expression.slice(1);
      else expression = '-' + expression;
    } else if (key === '=') {
      commit();
      return;
    } else if (key === '%') {
      // 把「数字 %」换成「数字 / 100」
      expression += '/100';
    } else if (key === 'x²') {
      appendAtCursor('^2');
    } else if (key === 'x^y') {
      appendAtCursor('^');
    } else if (key === '√' || key === '√x') {
      appendAtCursor('sqrt(');
    } else if (key === 'x') {
      appendAtCursor('x');
    } else {
      appendAtCursor(key);
    }
    refreshPreview();
  }

  function appendAtCursor(s) {
    expression += s;
    refreshDisplay();
  }

  function commit() {
    if (!expression) return;
    try {
      const norm = expression
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')
        .replace(/π/g, 'pi');
      const v = evaluate(norm);
      if (!Number.isFinite(v)) {
        error = '结果未定义';
        return refreshDisplay();
      }
      const result = formatResult(v);
      // 写入历史
      history = [...history, { expr: expression, result, time: Date.now() }].slice(-100);
      ctx.settings.setLocal('history', history);
      lastResult = result;
      expression = String(result);
      preview = '';
      refreshDisplay();
      if (mode === 'scientific') renderHistory(body.querySelector('.ch-list'));
    } catch (err) {
      error = err.message;
      refreshDisplay();
    }
  }

  // 键盘输入
  ctx.root.addEventListener('keydown', (e) => {
    if (mode === 'plot') return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key;
    if (/[0-9.+\-*/^%()]/.test(k)) {
      e.preventDefault();
      appendAtCursor(k);
      refreshPreview();
    } else if (k === 'Enter' || k === '=') {
      e.preventDefault();
      commit();
    } else if (k === 'Escape' || k.toLowerCase() === 'c') {
      expression = '';
      preview = '';
      error = '';
      refreshDisplay();
    } else if (k === 'Backspace') {
      expression = expression.slice(0, -1);
      refreshPreview();
    } else if (k.toLowerCase() === 'x') {
      appendAtCursor('x');
      refreshPreview();
    }
  });

  /* ============================================================
     绘图模式
     ============================================================ */

  async function renderPlot(container) {
    container.innerHTML = `
      <div class="plot-side">
        <div class="plot-fn-list"></div>
        <button class="plot-add">+ 添加函数</button>
        <div class="plot-range">
          <label>x 最小 <input type="number" data-range="xMin" value="-10" step="any"></label>
          <label>x 最大 <input type="number" data-range="xMax" value="10" step="any"></label>
          <label>采样 <input type="number" data-range="samples" value="400" min="50" max="2000" step="50"></label>
        </div>
      </div>
      <div class="plot-chart-wrap"><div class="plot-chart"></div></div>`;

    /** @type {Array<{id:number, expr:string, color:string, valid:boolean, fn?:Function, error?:string}>} */
    let functions = ctx.settings.getLocal('plotFunctions', [{ id: 1, expr: 'sin(x)', color: '#0078D4' }]);
    let range = ctx.settings.getLocal('plotRange', { xMin: -10, xMax: 10, samples: 400 });
    let chart = null;

    const colors = ['#0078D4', '#D13438', '#107C10', '#CA5010', '#8764B8', '#038387'];

    container.querySelector('.plot-range').innerHTML = `
      <label>x 最小 <input type="number" data-range="xMin" value="${range.xMin}" step="any"></label>
      <label>x 最大 <input type="number" data-range="xMax" value="${range.xMax}" step="any"></label>
      <label>采样 <input type="number" data-range="samples" value="${range.samples}" min="50" max="2000" step="50"></label>
    `;
    container.querySelector('.plot-range').addEventListener('change', (e) => {
      const k = e.target.dataset.range;
      if (k) {
        range[k] = Number(e.target.value) || range[k];
        ctx.settings.setLocal('plotRange', range);
        render();
      }
    });

    container.querySelector('.plot-add').addEventListener('click', () => {
      functions.push({ id: Date.now(), expr: 'cos(x)', color: colors[functions.length % colors.length] });
      ctx.settings.setLocal('plotFunctions', functions);
      render();
    });

    const listEl = container.querySelector('.plot-fn-list');
    function renderList() {
      listEl.innerHTML = '';
      functions.forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'plot-fn-row';
        row.innerHTML = `
          <span class="plot-fn-color" style="background:${f.color}" data-action="color"></span>
          <input class="plot-fn-input" type="text" value="${escapeHtml(f.expr)}">
          <button class="plot-fn-del" title="删除">×</button>`;
        const input = row.querySelector('.plot-fn-input');
        let timer = 0;
        input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = window.setTimeout(() => {
            f.expr = input.value;
            ctx.settings.setLocal('plotFunctions', functions);
            compileAndPlot();
          }, 220);
        });
        row.querySelector('.plot-fn-color').addEventListener('click', () => {
          f.color = colors[(colors.indexOf(f.color) + 1) % colors.length];
          ctx.settings.setLocal('plotFunctions', functions);
          render();
        });
        row.querySelector('.plot-fn-del').addEventListener('click', () => {
          functions.splice(i, 1);
          ctx.settings.setLocal('plotFunctions', functions);
          render();
        });
        listEl.appendChild(row);
      });
    }
    renderList();

    // ECharts
    const chartEl = container.querySelector('.plot-chart');
    const echarts = await ensureEcharts();
    if (!echarts) {
      chartEl.innerHTML = `<div class="plot-error">无法加载 ECharts（请检查网络连接）</div>`;
      return;
    }
    chart = echarts.init(chartEl, null, { renderer: 'canvas' });
    ctx.observeResize(chartEl, () => chart?.resize());

    function compileAndPlot() {
      const xs = new Array(range.samples);
      const dx = (range.xMax - range.xMin) / (range.samples - 1);
      for (let i = 0; i < range.samples; i++) xs[i] = range.xMin + dx * i;

      const series = [];
      for (const f of functions) {
        if (!f.expr.trim()) continue;
        try {
          const fn = compile(f.expr);
          const ys = new Array(range.samples);
          for (let i = 0; i < range.samples; i++) ys[i] = [xs[i], fn({ x: xs[i] })];
          const safeYs = sanitizeSamples(ys.map((p) => p[1])).map((v, i) => v == null || !Number.isFinite(v) ? [xs[i], null] : [xs[i], v]);
          f.fn = fn;
          f.valid = true;
          f.error = '';
          series.push({
            name: `y = ${f.expr}`,
            type: 'line',
            smooth: false,
            showSymbol: false,
            sampling: 'lttb',
            lineStyle: { width: 2, color: f.color },
            itemStyle: { color: f.color },
            data: safeYs,
            connectNulls: false,
          });
        } catch (err) {
          f.valid = false;
          f.error = err.message;
          ctx.notify.warning(`y = ${f.expr}：${err.message}`);
        }
      }
      chart.setOption({
        animation: false,
        grid: { left: 56, right: 24, top: 24, bottom: 44 },
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        legend: { top: 0, right: 0, textStyle: { fontSize: 11 } },
        xAxis: {
          type: 'value',
          name: 'x',
          min: range.xMin,
          max: range.xMax,
          splitLine: { lineStyle: { type: 'dashed', color: '#ddd' } },
        },
        yAxis: {
          type: 'value',
          name: 'y',
          splitLine: { lineStyle: { type: 'dashed', color: '#ddd' } },
        },
        series,
      }, true);
    }
    compileAndPlot();

    ctx.onDispose(() => chart?.dispose());
  }

  render();
  refreshDisplay();

  ctx.setPreviewProvider(() => (expression ? `f(x) ${expression}` : (lastResult || '0')));
}

function formatResult(v) {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  if (Math.abs(v) < 1e-6 || Math.abs(v) >= 1e10) return v.toExponential(6);
  return Number(v.toPrecision(12)).toString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}