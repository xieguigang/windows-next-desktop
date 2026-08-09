/**
 * 终端（模拟 bash）
 *
 * 实现：ls/cd/pwd/cat/echo/mkdir/touch/rm/mv/cp/clear/help/date/whoami/neofetch/open/tree。
 * 命令实现见 ./commands.js。
 *
 * 体验细节：
 * - 命令历史（↑↓ 翻阅）
 * - Tab 路径补全（文件/目录）
 * - Ctrl+C 中断当前输入，Ctrl+L 清屏
 * - 输出自动滚到底，输出行数有上限（5000 行）防内存膨胀
 */

import * as P from '../../core/fs/path-utils.js';
import { COMMANDS, runCommand } from './commands.js';

const MAX_LINES = 5000;

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./terminal.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'tm-root';
  root.innerHTML = `
    <div class="tm-tabs">
      <div class="tm-tab is-active">
        <span>终端</span>
      </div>
      <div class="tm-actions">
        <button class="btn tm-new" title="新建终端 (Ctrl+Shift+T)">＋</button>
      </div>
    </div>
    <div class="tm-output" tabindex="0"></div>
    <div class="tm-input-row">
      <span class="tm-prompt"></span>
      <input class="tm-input" type="text" autocomplete="off" spellcheck="false" aria-label="命令行输入">
    </div>`;
  ctx.root.appendChild(root);

  const outEl = root.querySelector('.tm-output');
  const inputEl = root.querySelector('.tm-input');
  const promptEl = root.querySelector('.tm-prompt');

  /** @type {string} */
  let cwd = ctx.args?.cwd || ctx.fs.folders.home;
  /** @type {string[]} */
  const history = [];
  /** @type {number} 历史游标（-1 = 不在历史中） */
  let historyCursor = -1;
  /** @type {string} 输入缓冲（翻历史时被修改，恢复要还原） */
  let draft = '';

  // ── 输出管理 ─────────────────────────────────────────
  function println(text = '', kind = '') {
    for (const line of String(text).split('\n')) {
      const el = document.createElement('div');
      el.className = `tm-line${kind ? ` tm-${kind}` : ''}`;
      el.textContent = line || '\u00A0';
      outEl.appendChild(el);
    }
    pruneOutput();
    outEl.scrollTop = outEl.scrollHeight;
  }

  function printPrompt() {
    promptEl.textContent = `${ctx.settings.get('system.userName') || 'user'}@WindowsNext:${cwd}$`;
  }

  function pruneOutput() {
    while (outEl.children.length > MAX_LINES) outEl.removeChild(outEl.firstChild);
  }

  function clearScreen() {
    outEl.innerHTML = '';
  }

  // ── 输入处理 ─────────────────────────────────────────
  function readLine() {
    return inputEl.value;
  }
  function resetLine() {
    inputEl.value = '';
    historyCursor = -1;
    draft = '';
  }

  inputEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = inputEl.value;
      println(`${promptEl.textContent} ${line}`, 'cmd');
      await executeLine(line);
      resetLine();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      if (historyCursor === -1) {
        draft = inputEl.value;
        historyCursor = history.length - 1;
      } else if (historyCursor > 0) {
        historyCursor--;
      }
      inputEl.value = history[historyCursor];
      requestAnimationFrame(() => inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyCursor === -1) return;
      if (historyCursor < history.length - 1) {
        historyCursor++;
        inputEl.value = history[historyCursor];
      } else {
        historyCursor = -1;
        inputEl.value = draft;
      }
      requestAnimationFrame(() => inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const v = inputEl.value;
      const cursor = inputEl.selectionStart;
      const before = v.slice(0, cursor);
      const after = v.slice(cursor);
      // 取最后一个 token
      const m = before.match(/^([^\s]*\s+)*(\S*)$/);
      const token = m ? m[2] : before;
      try {
        const resolved = await resolvePath(cwd, token);
        const stat = await ctx.fs.stat(resolved).catch(() => null);
        const parent = stat ? resolved : P.dirname(resolved);
        let entries = [];
        try {
          entries = await ctx.fs.readDir(parent);
        } catch {
          /* 目录不存在时退化为无补全 */
        }
        const base = P.basename(resolved).toLowerCase();
        const matches = entries.filter((e) => e.name.toLowerCase().startsWith(base));
        if (matches.length === 1) {
          const m0 = matches[0];
          const replace = (m0.type === 'directory' ? m0.name + '/' : m0.name);
          const newBefore = before.slice(0, before.length - token.length) + replace;
          inputEl.value = newBefore + after;
          inputEl.selectionStart = inputEl.selectionEnd = newBefore.length;
        } else if (matches.length > 1) {
          println('  ' + matches.map((m) => m.name + (m.type === 'directory' ? '/' : '')).join('  '));
        }
      } catch { /* 静默 */ }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      clearScreen();
    } else if (e.key === 'c' && e.ctrlKey) {
      if (inputEl.value) {
        e.preventDefault();
        println(`${promptEl.textContent} ${inputEl.value}^C`, 'cmd');
        resetLine();
      }
    }
  });

  // 任意位置点击聚焦输入
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tm-input, .btn')) return;
    inputEl.focus();
    // 选中当前点击位置的字（如果点的是输出文本），否则把光标放末尾
    const sel = window.getSelection();
    if (!sel || sel.toString()) return;
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  });

  // 窗口激活时自动聚焦
  ctx.events.on('window:focused', () => {
    if (ctx.window.isActive) inputEl.focus();
  });

  // ── 执行命令 ─────────────────────────────────────────
  async function executeLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    history.push(trimmed);
    const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const [cmd, ...args] = parts;
    try {
      await runCommand(cmd.toLowerCase(), args, {
        ctx,
        cwd,
        setCwd: (p) => { cwd = p; printPrompt(); },
        println,
        clearScreen,
        readLine,
      });
    } catch (err) {
      if (err?.name === 'ExitInterrupt') return;
      println(err?.message || String(err), 'err');
    }
  }

  async function resolvePath(base, token) {
    let p = token;
    if (!p) return base;
    if (p === '~' || p.startsWith('~/')) p = P.join(ctx.fs.folders.home, p.slice(1));
    if (/^[a-zA-Z]:/.test(p)) return P.normalize(p);
    return P.normalize(P.join(base, p));
  }

  // ── 启动横幅 ─────────────────────────────────────────
  println(`WindowsNext 终端 v1.0 — 输入 'help' 查看可用命令。`, 'info');
  println(`当前工作目录：${cwd}`, 'info');
  println('');
  printPrompt();
  inputEl.focus();

  ctx.setPreviewProvider(() => {
    const last = [...outEl.querySelectorAll('.tm-line')]
      .reverse()
      .find((el) => !el.classList.contains('cmd') && el.textContent.trim());
    return last?.textContent?.slice(0, 80) || cwd;
  });

  // 暴露给 SDK（neofetch 等可能用到）
  ctx.commands = COMMANDS;
}