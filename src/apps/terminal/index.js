/**
 * 终端（基于 xterm.js 模拟 bash）
 *
 * 使用 xterm.js 提供真实的终端体验，支持：
 * - 完整的 bash 命令集（40+ 命令）
 * - 命令历史（↑↓ 翻阅）
 * - Tab 路径补全
 * - Ctrl+C / Ctrl+L / Ctrl+D 快捷键
 * - 输出颜色、粗体等 ANSI 转义
 * - 管道支持（|）
 * - 输出重定向（> 和 >>）
 * - 环境变量
 *
 * 命令实现见 ./commands.js。
 */

import * as P from '../../core/fs/path-utils.js';
import { COMMANDS, runCommand } from './commands.js';
import { env } from './env.js';

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
    <div class="tm-xterm-container"></div>`;
  ctx.root.appendChild(root);

  const container = root.querySelector('.tm-xterm-container');

  // ── 初始化 xterm.js ─────────────────────────────────────
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 13,
    fontFamily: '"Noto Sans Mono", "Cascadia Code", Consolas, monospace',
    theme: {
      background: '#0c0c0c',
      foreground: '#cccccc',
      cursor: '#6cc',
      cursorAccent: '#0c0c0c',
      selectionBackground: '#3a3a5c',
      black: '#0c0c0c',
      red: '#f87171',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#6cc',
      magenta: '#bd93f9',
      cyan: '#8be9fd',
      white: '#cccccc',
      brightBlack: '#555555',
      brightRed: '#ff5555',
      brightGreen: '#50fa7b',
      brightYellow: '#f1fa8c',
      brightBlue: '#6cc',
      brightMagenta: '#ff79c6',
      brightCyan: '#8be9fd',
      brightWhite: '#ffffff',
    },
    allowProposedApi: true,
    scrollback: 5000,
    tabStopWidth: 4,
  });

  const fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.open(container);

  // 自适应大小
  fitAddon.fit();
  const ro = new ResizeObserver(() => fitAddon.fit());
  ro.observe(container);

  // ── 状态 ─────────────────────────────────────────────
  /** @type {string} */
  let cwd = ctx.args?.cwd || ctx.fs.folders.home;
  const history = [];
  let historyCursor = -1;
  let draft = '';
  let inputBuffer = '';
  let cursorPos = 0;

  const userName = ctx.settings.get('system.userName') || 'user';
  const hostName = 'WindowsNext';

  // 初始化环境变量
  env.set('HOME', ctx.fs.folders.home);
  env.set('USER', userName);
  env.set('HOSTNAME', hostName);
  env.set('PWD', cwd);
  env.set('PATH', '/bin:/usr/bin');
  env.set('SHELL', '/bin/wnsh');
  env.set('TERM', 'xterm-256color');
  env.set('LANG', 'zh_CN.UTF-8');
  env.set('EDITOR', 'notepad');

  // ── 输出辅助 ──────────────────────────────────────────
  const ansi = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    bgRed: '\x1b[41m',
  };

  function write(text) {
    term.write(text);
  }

  function writeln(text = '') {
    term.writeln(text);
  }

  function printPrompt() {
    const pwd = cwd === ctx.fs.folders.home ? '~' : cwd;
    write(`\r\n${ansi.green}${userName}@${hostName}${ansi.reset}:${ansi.blue}${pwd}${ansi.reset}$ `);
  }

  function clearScreen() {
    term.clear();
  }

  function readLine() {
    return inputBuffer;
  }

  function resetLine() {
    inputBuffer = '';
    cursorPos = 0;
    historyCursor = -1;
    draft = '';
  }

  // ── 输入处理 ──────────────────────────────────────────
  term.onData(async (data) => {
    const code = data.charCodeAt(0);

    if (code === 13) { // Enter
      const line = inputBuffer;
      writeln('');
      if (line.trim()) history.push(line.trim());
      resetLine();
      await executeLine(line);
      printPrompt();
    } else if (code === 127) { // Backspace
      if (cursorPos > 0) {
        const before = inputBuffer.slice(0, cursorPos - 1);
        const after = inputBuffer.slice(cursorPos);
        inputBuffer = before + after;
        cursorPos--;
        write('\b \b');
        if (after) {
          write(after);
          write(`\x1b[${after.length}D`);
        }
      }
    } else if (code === 9) { // Tab - 路径补全
      const token = getLastToken(inputBuffer.slice(0, cursorPos));
      if (token) {
        try {
          const resolved = await resolvePath(cwd, token);
          const stat = await ctx.fs.stat(resolved).catch(() => null);
          const parent = stat ? resolved : P.dirname(resolved);
          let entries = [];
          try { entries = await ctx.fs.readDir(parent); } catch { /* ignore */ }
          const base = P.basename(resolved).toLowerCase();
          const matches = entries.filter((e) => e.name.toLowerCase().startsWith(base));
          if (matches.length === 1) {
            const m0 = matches[0];
            const replace = m0.type === 'directory' ? m0.name + '/' : m0.name;
            const before = inputBuffer.slice(0, cursorPos - token.length);
            const after = inputBuffer.slice(cursorPos);
            inputBuffer = before + replace + after;
            cursorPos = before.length + replace.length;
            const diff = replace.slice(token.length);
            write(diff);
            if (after) {
              write(after);
              write(`\x1b[${after.length}D`);
            }
          } else if (matches.length > 1) {
            writeln('');
            writeln('  ' + matches.map((m) => m.name + (m.type === 'directory' ? '/' : '')).join('  '));
            printPrompt();
            write(inputBuffer);
          }
        } catch { /* silent */ }
      }
    } else if (code === 27) { // Escape sequence
      if (data === '\x1b[A') { // Up
        if (!history.length) return;
        if (historyCursor === -1) {
          draft = inputBuffer;
          historyCursor = history.length - 1;
        } else if (historyCursor > 0) {
          historyCursor--;
        }
        replaceInput(history[historyCursor]);
      } else if (data === '\x1b[B') { // Down
        if (historyCursor === -1) return;
        if (historyCursor < history.length - 1) {
          historyCursor++;
          replaceInput(history[historyCursor]);
        } else {
          historyCursor = -1;
          replaceInput(draft);
        }
      } else if (data === '\x1b[C') { // Right
        if (cursorPos < inputBuffer.length) {
          cursorPos++;
          write('\x1b[C');
        }
      } else if (data === '\x1b[D') { // Left
        if (cursorPos > 0) {
          cursorPos--;
          write('\x1b[D');
        }
      } else if (data === '\x1b[H') { // Home
        write(`\x1b[${cursorPos}D`);
        cursorPos = 0;
      } else if (data === '\x1b[F') { // End
        const diff = inputBuffer.length - cursorPos;
        write(`\x1b[${diff}C`);
        cursorPos = inputBuffer.length;
      }
    } else if (code === 12) { // Ctrl+L - 清屏
      clearScreen();
    } else if (code === 3) { // Ctrl+C
      if (inputBuffer) {
        write('^C');
        writeln('');
        resetLine();
        printPrompt();
      }
    } else if (code === 4) { // Ctrl+D - 退出（空行时）
      if (!inputBuffer) {
        writeln('logout');
        ctx.window.close();
      }
    } else if (code === 21) { // Ctrl+U - 删除到行首
      write(`\x1b[${cursorPos}D\x1b[0K`);
      inputBuffer = inputBuffer.slice(cursorPos);
      write(inputBuffer);
      write(`\x1b[${inputBuffer.length - cursorPos}D`);
      cursorPos = 0;
    } else if (code === 11) { // Ctrl+K - 删除到行尾
      write('\x1b[0K');
      inputBuffer = inputBuffer.slice(0, cursorPos);
    } else if (code === 23) { // Ctrl+W - 删除前一个词
      const before = inputBuffer.slice(0, cursorPos);
      const m = before.match(/(.*\s+)?(\S+)$/);
      if (m) {
        const delLen = m[2] ? m[2].length : 0;
        const newPos = cursorPos - delLen;
        write(`\x1b[${delLen}D\x1b[0K`);
        inputBuffer = before.slice(0, newPos) + inputBuffer.slice(cursorPos);
        const after = inputBuffer.slice(newPos);
        write(after);
        write(`\x1b[${after.length}D`);
        cursorPos = newPos;
      }
    } else if (data.length === 1 && code >= 32 && code < 127) {
      // 可打印字符
      const before = inputBuffer.slice(0, cursorPos);
      const after = inputBuffer.slice(cursorPos);
      inputBuffer = before + data + after;
      cursorPos++;
      write(data);
      if (after) {
        write(after);
        write(`\x1b[${after.length}D`);
      }
    }
  });

  function replaceInput(text) {
    // 清除当前行
    write(`\x1b[${cursorPos}D\x1b[0K`);
    inputBuffer = text;
    cursorPos = text.length;
    write(text);
  }

  function getLastToken(text) {
    const m = text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+$/);
    if (!m) return text;
    const last = m[0];
    // 去掉引号
    if ((last.startsWith('"') && last.endsWith('"')) || (last.startsWith("'") && last.endsWith("'"))) {
      return last.slice(1, -1);
    }
    return last;
  }

  // ── 执行命令 ──────────────────────────────────────────
  async function executeLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    // 解析管道
    const pipeParts = trimmed.split('|').map((s) => s.trim());
    if (pipeParts.length > 1) {
      await executePipeline(pipeParts);
      return;
    }

    const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const [cmd, ...args] = parts;
    const cleanedArgs = args.map((a) => a.replace(/^["']|["']$/g, ''));

    try {
      await runCommand(cmd.toLowerCase(), cleanedArgs, {
        ctx,
        cwd,
        setCwd: (p) => {
          cwd = p;
          env.set('PWD', cwd);
        },
        write,
        writeln,
        clearScreen,
        readLine,
        env,
        ansi,
      });
    } catch (err) {
      if (err?.name === 'ExitInterrupt') return;
      writeln(`${ansi.red}${err?.message || String(err)}${ansi.reset}`);
    }
  }

  async function executePipeline(parts) {
    let prevOutput = '';
    for (let i = 0; i < parts.length; i++) {
      const cmdParts = parts[i].match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
      const [cmd, ...args] = cmdParts;
      const cleanedArgs = args.map((a) => a.replace(/^["']|["']$/g, ''));

      let captured = '';
      const pipeWrite = (text) => { captured += text; };
      const pipeWriteln = (text = '') => { captured += text + '\n'; };

      try {
        await runCommand(cmd.toLowerCase(), cleanedArgs, {
          ctx,
          cwd,
          setCwd: (p) => {
            cwd = p;
            env.set('PWD', cwd);
          },
          write: pipeWrite,
          writeln: pipeWriteln,
          clearScreen: () => {},
          readLine: () => '',
          env,
          ansi,
          stdin: prevOutput,
        });
      } catch (err) {
        writeln(`${ansi.red}${err?.message || String(err)}${ansi.reset}`);
        return;
      }
      prevOutput = captured.trimEnd();
    }
    if (prevOutput) writeln(prevOutput);
  }

  async function resolvePath(base, token) {
    let p = token;
    if (!p) return base;
    if (p === '~' || p.startsWith('~/')) p = P.join(ctx.fs.folders.home, p.slice(1));
    if (/^[a-zA-Z]:/.test(p)) return P.normalize(p);
    return P.normalize(P.join(base, p));
  }

  // ── 窗口交互 ──────────────────────────────────────────
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.btn')) return;
    term.focus();
  });

  ctx.events.on('window:focused', () => {
    if (ctx.window.isActive) term.focus();
  });

  // ── 启动 ──────────────────────────────────────────────
  writeln(`${ansi.bold}${ansi.cyan}WindowsNext 终端 v2.0 (xterm.js)${ansi.reset}`);
  writeln(`${ansi.gray}输入 'help' 查看可用命令。${ansi.reset}`);
  writeln(`${ansi.gray}当前工作目录：${cwd}${ansi.reset}`);
  printPrompt();
  term.focus();

  ctx.setPreviewProvider(() => {
    const buf = term.buffer.active;
    for (let i = buf.length - 1; i >= 0; i--) {
      const line = buf.getLine(i);
      if (line) {
        const text = line.translateToString().trim();
        if (text && !text.includes('@WindowsNext:')) return text.slice(0, 80);
      }
    }
    return cwd;
  });

  // 暴露给外部
  ctx.commands = COMMANDS;
}
