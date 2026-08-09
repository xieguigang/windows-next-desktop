/**
 * 终端命令实现
 *
 * 每个命令：(args, context) => string | Promise<string | void>
 * 通过 println 输出多行结果，或返回单个字符串。
 *
 * 约定：
 * - context.cwd 是当前工作目录（字符串），原地修改可改变路径，但建议调 setCwd()
 * - context.setCwd(path) 修改 cwd 并刷新提示符
 * - context.println(text, kind?) 追加输出行
 * - context.clearScreen() 清屏
 * - context.readLine() 读当前行
 */

import * as P from '../../core/fs/path-utils.js';
import { SHELL_FOLDERS } from '../../core/fs/fs-service.js';

export const COMMANDS = {
  help: {
    desc: '显示可用命令',
    run: (_args, { println }) => {
      println('可用命令：');
      for (const [name, c] of Object.entries(COMMANDS).sort()) {
        println(`  ${name.padEnd(12)} ${c.desc || ''}`);
      }
      println('');
      println('快捷键：');
      println('  ↑ / ↓         浏览历史');
      println('  Tab           路径补全');
      println('  Ctrl+L        清屏');
      println('  Ctrl+C        取消当前输入');
    },
  },

  pwd: {
    desc: '显示当前目录',
    run: (_args, { cwd, println }) => println(cwd),
  },

  cd: {
    desc: '切换目录（cd ~, cd .., cd <path>）',
    run: async (args, { cwd, ctx, setCwd, println }) => {
      let target = args[0] || SHELL_FOLDERS.home;
      if (target === '~' || target.startsWith('~/')) target = P.join(ctx.fs.folders.home, target.slice(1));
      if (!/^[a-zA-Z]:/.test(target)) target = P.join(cwd, target);
      target = P.normalize(target);
      const stat = await ctx.fs.stat(target).catch(() => null);
      if (!stat) throw new Error(`cd: ${target}: 没有那个目录`);
      if (stat.type !== 'directory') throw new Error(`cd: ${target}: 不是目录`);
      setCwd(target);
    },
  },

  ls: {
    desc: '列出目录（-l 详细信息，-a 显示隐藏）',
    run: async (args, { cwd, ctx, println }) => {
      const long = args.includes('-l') || args.includes('-la') || args.includes('-al');
      const showAll = args.includes('-a') || args.includes('-la') || args.includes('-al');
      const filtered = args.filter((a) => a.startsWith('-'));
      const target = args.filter((a) => !a.startsWith('-'))[0];
      const path = target ? (target.startsWith(':') || /^[a-zA-Z]:/.test(target) ? target : P.join(cwd, target)) : cwd;
      const entries = await ctx.fs.readDir(path);
      const list = (showAll ? entries : entries.filter((e) => !e.name.startsWith('.'))).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh');
      });
      if (!long) {
        println(list.map((e) => (e.type === 'directory' ? `${e.name}/` : e.name)).join('  ') || '(空)');
        return;
      }
      for (const e of list) {
        const t = e.type === 'directory' ? 'd' : '-';
        const size = e.type === 'directory' ? '-' : P.formatSize(e.size);
        println(`${t}rw-r--r--  1 user user  ${size.padStart(8)}  ${P.formatDate(e.modified)}  ${e.name}${e.type === 'directory' ? '/' : ''}`);
      }
    },
  },

  cat: {
    desc: '输出文件内容',
    run: async (args, { cwd, ctx, println }) => {
      if (!args.length) throw new Error('cat: 缺少文件参数');
      for (const arg of args) {
        const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
        try {
          const text = await ctx.fs.readFile(path, 'utf-8');
          println(typeof text === 'string' ? text : new TextDecoder().decode(text));
        } catch (err) {
          println(`cat: ${arg}: ${err?.message || '无法读取'}`, 'err');
        }
      }
    },
  },

  echo: {
    desc: '回显文本（echo hi > file 写入文件）',
    run: async (args, { cwd, ctx, println }) => {
      // 简易解析：echo "hi" > path
      const join = args.indexOf('>>');
      const over = args.indexOf('>');
      let target = null;
      let mode = 'w';
      if (over >= 0 && (join < 0 || over < join)) { target = args[over + 1]; mode = 'w'; args.splice(over, 2); }
      else if (join >= 0) { target = args[join + 1]; mode = 'a'; args.splice(join, 2); }

      const text = args.join(' ').replace(/^["']|["']$/g, '');
      if (!target) { println(text); return; }

      const path = /^[a-zA-Z]:/.test(target) ? target : P.join(cwd, target);
      let existing = '';
      if (mode === 'a') {
        try { existing = await ctx.fs.readFile(path, 'utf-8'); } catch { /* 不存在则忽略 */ }
      }
      await ctx.fs.writeFile(path, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + text);
    },
  },

  mkdir: {
    desc: '创建目录（mkdir <name>，-p 递归）',
    run: async (args, { cwd, ctx, println }) => {
      const recursive = args.includes('-p');
      const names = args.filter((a) => !a.startsWith('-'));
      if (!names.length) throw new Error('mkdir: 缺少目录名');
      for (const n of names) {
        const path = /^[a-zA-Z]:/.test(n) ? n : P.join(cwd, n);
        if (recursive) {
          const parts = [];
          for (const seg of path.split(/[\\/]/).filter(Boolean)) {
            parts.push(seg);
            const p = parts.join('/');
            try { await ctx.fs.mkdir(p.startsWith(':') ? `${parts[0]}/${parts.slice(1).join('/')}` : p); } catch { /* 目录已存在 */ }
          }
        } else {
          await ctx.fs.mkdir(path);
        }
      }
    },
  },

  touch: {
    desc: '创建空文件',
    run: async (args, { cwd, ctx }) => {
      if (!args.length) throw new Error('touch: 缺少文件名');
      for (const n of args) {
        const path = /^[a-zA-Z]:/.test(n) ? n : P.join(cwd, n);
        try { await ctx.fs.writeFile(path, ''); }
        catch { /* 已存在时无操作 */ }
      }
    },
  },

  rm: {
    desc: '删除文件或目录（-r 递归，-f 强制）',
    run: async (args, { cwd, ctx, println }) => {
      const recursive = args.includes('-r') || args.includes('-rf') || args.includes('-fr');
      const force = args.includes('-f') || args.includes('-rf') || args.includes('-fr');
      const names = args.filter((a) => !a.startsWith('-'));
      if (!names.length) throw new Error('rm: 缺少路径');
      for (const n of names) {
        const path = /^[a-zA-Z]:/.test(n) ? n : P.join(cwd, n);
        try {
          await ctx.fs.remove(path, recursive);
        } catch (err) {
          if (!force) println(`rm: ${n}: ${err?.message || '删除失败'}`, 'err');
        }
      }
    },
  },

  mv: {
    desc: '重命名或移动',
    run: async (args, { cwd, ctx, println }) => {
      if (args.length < 2) throw new Error('mv: 需要源与目标');
      const [src, dst] = args;
      const s = /^[a-zA-Z]:/.test(src) ? src : P.join(cwd, src);
      let d = /^[a-zA-Z]:/.test(dst) ? dst : P.join(cwd, dst);
      try {
        const dstStat = await ctx.fs.stat(d).catch(() => null);
        if (dstStat?.type === 'directory') d = P.join(d, P.basename(s));
        await ctx.fs.rename(s, d);
      } catch (err) {
        println(`mv: ${err?.message || '失败'}`, 'err');
      }
    },
  },

  cp: {
    desc: '复制文件或目录（-r 递归）',
    run: async (args, { cwd, ctx, println }) => {
      const recursive = args.includes('-r');
      const names = args.filter((a) => !a.startsWith('-'));
      if (names.length < 2) throw new Error('cp: 需要源与目标');
      const [src, dst] = names;
      const s = /^[a-zA-Z]:/.test(src) ? src : P.join(cwd, src);
      let d = /^[a-zA-Z]:/.test(dst) ? dst : P.join(cwd, dst);
      try {
        const dstStat = await ctx.fs.stat(d).catch(() => null);
        if (dstStat?.type === 'directory') d = P.join(d, P.basename(s));
        await ctx.fs.copy(s, d, recursive);
      } catch (err) {
        println(`cp: ${err?.message || '失败'}`, 'err');
      }
    },
  },

  clear: {
    desc: '清屏',
    run: (_args, { clearScreen }) => clearScreen(),
  },

  open: {
    desc: '用默认关联应用打开文件或目录',
    run: async (args, { cwd, ctx, println }) => {
      if (!args.length) throw new Error('open: 缺少路径');
      for (const a of args) {
        const path = /^[a-zA-Z]:/.test(a) ? a : P.join(cwd, a);
        try { await ctx.openPath(path); }
        catch (err) { println(`open: ${a}: ${err?.message || '失败'}`, 'err'); }
      }
    },
  },

  tree: {
    desc: '树形展示目录',
    run: async (args, { cwd, ctx, println }) => {
      const root = args[0] ? (/^[a-zA-Z]:/.test(args[0]) ? args[0] : P.join(cwd, args[0])) : cwd;
      const lines = [`${root}`];
      async function walk(path, prefix) {
        let entries;
        try { entries = await ctx.fs.readDir(path); } catch { return; }
        entries = entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'directory' ? -1 : 1);
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          const last = i === entries.length - 1;
          lines.push(`${prefix}${last ? '└─ ' : '├─ '}${e.name}${e.type === 'directory' ? '/' : ''}`);
          if (e.type === 'directory') await walk(e.path, prefix + (last ? '   ' : '│  '));
        }
      }
      await walk(root, '');
      println(lines.join('\n'));
    },
  },

  date: {
    desc: '显示当前日期时间',
    run: (_args, { println }) => println(new Date().toLocaleString('zh-CN')),
  },

  whoami: {
    desc: '显示当前用户',
    run: (_args, { ctx, println }) => println(ctx.settings.get('system.userName') || 'user'),
  },

  neofetch: {
    desc: '系统信息概览',
    run: async (_args, { ctx, println }) => {
      const ua = navigator.userAgent;
      const lines = [
        '       _______________       ',
        '      /               \\      ',
        '     /  WindowsNext    \\     ',
        '    /    ___________    \\    ',
        '    |   /           \\   |   ',
        '    |   |   _____   |   |   ',
        '    |   |   |   |   |   |   ',
        '    \\   |   |   |   |   /    ',
        '     \\  |___|___|___|  /     ',
        '      \\_______________/      ',
        '',
        `OS:       WindowsNext 1.0 (Web)`,
        `Host:     ${location.host}`,
        `Kernel:   ${ua.split(' ').slice(-1)[0] || 'unknown'}`,
        `UA:       ${ua.split(' ').slice(-2, -1)[0] || 'browser'}`,
        `Shell:    wnsh 1.0`,
        `Resolution: ${window.innerWidth}x${window.innerHeight}`,
        `Theme:    ${ctx.settings.get('appearance.theme')}`,
        `Accent:   ${ctx.settings.get('appearance.accent')}`,
        `Terminal: wnsh`,
        `User:     ${ctx.settings.get('system.userName') || 'user'}`,
      ];
      println(lines.join('\n'));
    },
  },
};

/**
 * 执行命令入口
 * @param {string} name
 * @param {string[]} args
 * @param {object} ctx
 */
export async function runCommand(name, args, ctx) {
  const cmd = COMMANDS[name];
  if (!cmd) throw new Error(`${name}: 命令未找到，输入 'help' 查看可用命令`);
  await cmd.run(args, ctx);
}