/**
 * 终端命令实现（扩展版）
 *
 * 每个命令：(args, context) => void | Promise<void>
 * 通过 write/writeln 输出，或返回单个字符串。
 *
 * context 包含:
 * - cwd          当前工作目录
 * - setCwd(path) 修改 cwd
 * - write(text)  输出文本（支持 ANSI）
 * - writeln(text) 输出行
 * - clearScreen() 清屏
 * - readLine()   读当前输入行
 * - env          环境变量存储
 * - ansi         ANSI 转义码对象
 * - stdin        管道输入（字符串）
 * - ctx          全局挂载上下文
 */

import * as P from '../../core/fs/path-utils.js';
import { SHELL_FOLDERS } from '../../core/fs/fs-service.js';
import processManager from '../../core/process-manager.js';

/** @type {Record<string, {desc:string, run:Function}>} */
export const COMMANDS = {};

// ── 文件系统命令 ─────────────────────────────────────────

COMMANDS.ls = {
  desc: '列出目录（-l 详细信息，-a 显示隐藏，-h 人类可读，-R 递归，--sort=size|time）',
  run: async (args, { cwd, ctx, writeln, ansi, stdin }) => {
    const long = args.includes('-l') || args.includes('-la') || args.includes('-al');
    const showAll = args.includes('-a') || args.includes('-la') || args.includes('-al');
    const human = args.includes('-h') || args.includes('-lh') || args.includes('-hl');
    const recursive = args.includes('-R');
    const sortArg = args.find((a) => a.startsWith('--sort='));
    const sortBy = sortArg ? sortArg.split('=')[1] : 'name';
    const filtered = args.filter((a) => !a.startsWith('-') && !a.startsWith('--'));
    const target = filtered[0];

    const path = target
      ? (target.startsWith(':') || /^[a-zA-Z]:/.test(target) ? target : P.join(cwd, target))
      : cwd;

    async function listDir(p, prefix = '') {
      let entries;
      try {
        entries = await ctx.fs.readDir(p);
      } catch (err) {
        writeln(`${ansi.red}ls: 无法访问 '${p}': ${err?.message || '错误'}${ansi.reset}`);
        return;
      }
      let list = (showAll ? entries : entries.filter((e) => !e.name.startsWith('.')));
      // 排序
      list.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        if (sortBy === 'size') return b.size - a.size;
        if (sortBy === 'time') return b.modified - a.modified;
        return a.name.localeCompare(b.name, 'zh');
      });

      if (!long) {
        const dirs = list.filter((e) => e.type === 'directory');
        const files = list.filter((e) => e.type === 'file');
        const names = [
          ...dirs.map((e) => `${ansi.blue}${e.name}/${ansi.reset}`),
          ...files.map((e) => {
            if (e.name.endsWith('.exe') || e.name.endsWith('.sh') || e.name.endsWith('.bat'))
              return `${ansi.green}${e.name}${ansi.reset}`;
            if (e.name.endsWith('.zip') || e.name.endsWith('.tar') || e.name.endsWith('.gz'))
              return `${ansi.red}${e.name}${ansi.reset}`;
            return e.name;
          }),
        ];
        writeln(names.join('  ') || '(空)');
      } else {
        for (const e of list) {
          const t = e.type === 'directory' ? 'd' : '-';
          const size = human ? P.formatSize(e.size) : String(e.size);
          const date = P.formatDate(e.modified);
          const name = e.type === 'directory'
            ? `${ansi.blue}${e.name}/${ansi.reset}`
            : e.name;
          writeln(`${t}rw-r--r--  1 user user  ${size.padStart(8)}  ${date}  ${name}`);
        }
      }

      if (recursive) {
        const dirs = list.filter((e) => e.type === 'directory');
        for (const d of dirs) {
          writeln(`\n${prefix}${d.name}/:`);
          await listDir(d.path, prefix + '  ');
        }
      }
    }
    await listDir(path);
  },
};

COMMANDS.cd = {
  desc: '切换目录（cd ~, cd .., cd -, cd <path>）',
  run: async (args, { cwd, ctx, setCwd, writeln, ansi, env }) => {
    let target = args[0] || SHELL_FOLDERS.home;
    if (target === '-') {
      const prev = env._prevDir;
      if (!prev) { writeln(`${ansi.red}cd: 没有上一个目录${ansi.reset}`); return; }
      target = prev;
    }
    if (target === '~' || target.startsWith('~/')) target = P.join(ctx.fs.folders.home, target.slice(1));
    if (!/^[a-zA-Z]:/.test(target)) target = P.join(cwd, target);
    target = P.normalize(target);
    const stat = await ctx.fs.stat(target).catch(() => null);
    if (!stat) { writeln(`${ansi.red}cd: ${target}: 没有那个目录${ansi.reset}`); return; }
    if (stat.type !== 'directory') { writeln(`${ansi.red}cd: ${target}: 不是目录${ansi.reset}`); return; }
    env._prevDir = cwd;
    setCwd(target);
  },
};

COMMANDS.pwd = {
  desc: '显示当前目录',
  run: (_args, { cwd, writeln }) => writeln(cwd),
};

COMMANDS.cat = {
  desc: '输出文件内容（-n 显示行号）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (!args.length) throw new Error('cat: 缺少文件参数');
    const showNum = args.includes('-n');
    const files = args.filter((a) => !a.startsWith('-'));
    for (const arg of files) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const text = await ctx.fs.readFile(path, 'utf-8');
        const content = typeof text === 'string' ? text : new TextDecoder().decode(text);
        if (showNum) {
          const lines = content.split('\n');
          const pad = String(lines.length).length;
          for (let i = 0; i < lines.length; i++) {
            writeln(`${ansi.gray}${String(i + 1).padStart(pad)}${ansi.reset}  ${lines[i]}`);
          }
        } else {
          writeln(content);
        }
      } catch (err) {
        writeln(`${ansi.red}cat: ${arg}: ${err?.message || '无法读取'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.tac = {
  desc: '反向输出文件内容（倒序行）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (!args.length) throw new Error('tac: 缺少文件参数');
    for (const arg of args) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const text = await ctx.fs.readFile(path, 'utf-8');
        const content = typeof text === 'string' ? text : new TextDecoder().decode(text);
        writeln(content.split('\n').reverse().join('\n'));
      } catch (err) {
        writeln(`${ansi.red}tac: ${arg}: ${err?.message || '无法读取'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.head = {
  desc: '显示文件前几行（-n <num>，默认 10）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    const nIdx = args.indexOf('-n');
    const count = nIdx >= 0 ? parseInt(args[nIdx + 1]) || 10 : 10;
    const files = args.filter((a) => a !== '-n' && isNaN(parseInt(a)) && !a.startsWith('-'));
    if (!files.length) throw new Error('head: 缺少文件参数');
    for (const arg of files) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const text = await ctx.fs.readFile(path, 'utf-8');
        const content = typeof text === 'string' ? text : new TextDecoder().decode(text);
        if (files.length > 1) writeln(`${ansi.bold}==> ${arg} <==${ansi.reset}`);
        writeln(content.split('\n').slice(0, count).join('\n'));
      } catch (err) {
        writeln(`${ansi.red}head: ${arg}: ${err?.message || '无法读取'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.tail = {
  desc: '显示文件最后几行（-n <num>，默认 10）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    const nIdx = args.indexOf('-n');
    const count = nIdx >= 0 ? parseInt(args[nIdx + 1]) || 10 : 10;
    const files = args.filter((a) => a !== '-n' && isNaN(parseInt(a)) && !a.startsWith('-'));
    if (!files.length) throw new Error('tail: 缺少文件参数');
    for (const arg of files) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const text = await ctx.fs.readFile(path, 'utf-8');
        const content = typeof text === 'string' ? text : new TextDecoder().decode(text);
        if (files.length > 1) writeln(`${ansi.bold}==> ${arg} <==${ansi.reset}`);
        writeln(content.split('\n').slice(-count).join('\n'));
      } catch (err) {
        writeln(`${ansi.red}tail: ${arg}: ${err?.message || '无法读取'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.wc = {
  desc: '统计行数、单词数、字符数（-l 行，-w 单词，-c 字符）',
  run: async (args, { cwd, ctx, writeln, ansi, stdin }) => {
    const files = args.filter((a) => !a.startsWith('-'));
    const showLines = args.includes('-l') || args.length === 0 || (args.length === files.length);
    const showWords = args.includes('-w') || args.length === 0 || (args.length === files.length);
    const showChars = args.includes('-c');

    async function count(content) {
      const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
      const words = content.trim() ? content.trim().split(/\s+/).length : 0;
      const chars = content.length;
      const parts = [];
      if (showLines) parts.push(String(lines));
      if (showWords) parts.push(String(words));
      if (showChars) parts.push(String(chars));
      return parts.join('  ');
    }

    if (stdin) {
      writeln(`  ${await count(stdin)}`);
      return;
    }

    if (!files.length) throw new Error('wc: 缺少文件参数');
    for (const arg of files) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const text = await ctx.fs.readFile(path, 'utf-8');
        const content = typeof text === 'string' ? text : new TextDecoder().decode(text);
        writeln(`  ${await count(content)} ${arg}`);
      } catch (err) {
        writeln(`${ansi.red}wc: ${arg}: ${err?.message || '无法读取'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.grep = {
  desc: '搜索文本（-i 忽略大小写，-v 反向匹配，-n 显示行号）',
  run: async (args, { cwd, ctx, writeln, ansi, stdin }) => {
    const ignoreCase = args.includes('-i');
    const invert = args.includes('-v');
    const showNum = args.includes('-n');
    const flags = args.filter((a) => a.startsWith('-'));
    const rest = args.filter((a) => !a.startsWith('-'));
    if (rest.length < 1) throw new Error('grep: 缺少匹配模式');
    const pattern = rest[0];
    const files = rest.slice(1);

    function search(text, filename) {
      const lines = text.split('\n');
      const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignoreCase ? 'gi' : 'g');
      for (let i = 0; i < lines.length; i++) {
        const match = regex.test(lines[i]);
        regex.lastIndex = 0;
        if ((match && !invert) || (!match && invert)) {
          const prefix = filename ? `${ansi.cyan}${filename}:${ansi.reset}` : '';
          const num = showNum ? `${ansi.green}${i + 1}:${ansi.reset}` : '';
          const line = lines[i].replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignoreCase ? 'gi' : 'g'),
            (m) => `${ansi.red}${ansi.bold}${m}${ansi.reset}`);
          writeln(`${prefix}${num}${line}`);
        }
      }
    }

    if (stdin) {
      search(stdin, '');
      return;
    }
    if (!files.length) throw new Error('grep: 缺少文件参数');
    for (const arg of files) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const text = await ctx.fs.readFile(path, 'utf-8');
        const content = typeof text === 'string' ? text : new TextDecoder().decode(text);
        search(content, files.length > 1 ? arg : null);
      } catch (err) {
        writeln(`${ansi.red}grep: ${arg}: ${err?.message || '无法读取'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.find = {
  desc: '搜索文件（-name <pattern>，-type f|d）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    let pattern = '*';
    let type = null;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-name' && args[i + 1]) { pattern = args[++i]; }
      else if (args[i] === '-type' && args[i + 1]) { type = args[++i]; }
      else { rest.push(args[i]); }
    }
    const root = rest[0] ? (/^[a-zA-Z]:/.test(rest[0]) ? rest[0] : P.join(cwd, rest[0])) : cwd;

    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
    const results = [];
    async function walk(dir) {
      let entries;
      try { entries = await ctx.fs.readDir(dir); } catch { return; }
      for (const e of entries) {
        if (regex.test(e.name)) {
          if (!type || (type === 'f' && e.type === 'file') || (type === 'd' && e.type === 'directory')) {
            results.push(e.path);
          }
        }
        if (e.type === 'directory') await walk(e.path);
      }
    }
    await walk(root);
    if (results.length) writeln(results.join('\n'));
  },
};

COMMANDS.touch = {
  desc: '创建空文件或更新修改时间',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (!args.length) throw new Error('touch: 缺少文件名');
    for (const n of args) {
      const path = /^[a-zA-Z]:/.test(n) ? n : P.join(cwd, n);
      try {
        const exists = await ctx.fs.exists(path);
        if (exists) {
          // 更新修改时间：读后写回
          const content = await ctx.fs.readFile(path, 'utf-8').catch(() => '');
          await ctx.fs.writeFile(path, content);
        } else {
          await ctx.fs.writeFile(path, '');
        }
      } catch (err) {
        writeln(`${ansi.red}touch: ${n}: ${err?.message || '失败'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.mkdir = {
  desc: '创建目录（-p 递归创建父目录）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    const recursive = args.includes('-p');
    const names = args.filter((a) => !a.startsWith('-'));
    if (!names.length) throw new Error('mkdir: 缺少目录名');
    for (const n of names) {
      const path = /^[a-zA-Z]:/.test(n) ? n : P.join(cwd, n);
      try {
        if (recursive) {
          const parts = [];
          const drive = P.driveOf(path);
          const segs = P.segments(path);
          for (const seg of segs) {
            parts.push(seg);
            const p = `${drive}:/${parts.join('/')}`;
            try { await ctx.fs.mkdir(p); } catch { /* 已存在 */ }
          }
        } else {
          await ctx.fs.mkdir(path);
        }
      } catch (err) {
        writeln(`${ansi.red}mkdir: ${n}: ${err?.message || '失败'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.rm = {
  desc: '删除文件或目录（-r 递归，-f 强制，-rf 递归强制）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    const recursive = args.includes('-r') || args.includes('-rf') || args.includes('-fr');
    const force = args.includes('-f') || args.includes('-rf') || args.includes('-fr');
    const names = args.filter((a) => !a.startsWith('-'));
    if (!names.length) throw new Error('rm: 缺少路径');
    for (const n of names) {
      const path = /^[a-zA-Z]:/.test(n) ? n : P.join(cwd, n);
      try {
        await ctx.fs.remove(path, recursive);
      } catch (err) {
        if (!force) writeln(`${ansi.red}rm: ${n}: ${err?.message || '删除失败'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.rmdir = {
  desc: '删除空目录',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (!args.length) throw new Error('rmdir: 缺少目录名');
    for (const n of args) {
      const path = /^[a-zA-Z]:/.test(n) ? n : P.join(cwd, n);
      try {
        const entries = await ctx.fs.readDir(path);
        if (entries.length > 0) {
          writeln(`${ansi.red}rmdir: '${n}': 目录不为空${ansi.reset}`);
        } else {
          await ctx.fs.remove(path, false);
        }
      } catch (err) {
        writeln(`${ansi.red}rmdir: ${n}: ${err?.message || '失败'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.mv = {
  desc: '移动/重命名文件或目录',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (args.length < 2) throw new Error('mv: 需要源与目标');
    const [src, dst] = args;
    const s = /^[a-zA-Z]:/.test(src) ? src : P.join(cwd, src);
    let d = /^[a-zA-Z]:/.test(dst) ? dst : P.join(cwd, dst);
    try {
      const dstStat = await ctx.fs.stat(d).catch(() => null);
      if (dstStat?.type === 'directory') d = P.join(d, P.basename(s));
      await ctx.fs.rename(s, d);
    } catch (err) {
      writeln(`${ansi.red}mv: ${err?.message || '失败'}${ansi.reset}`);
    }
  },
};

COMMANDS.cp = {
  desc: '复制文件或目录（-r 递归）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
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
      writeln(`${ansi.red}cp: ${err?.message || '失败'}${ansi.reset}`);
    }
  },
};

COMMANDS.ln = {
  desc: '创建文件副本（模拟硬链接，实际为 cp）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (args.length < 2) throw new Error('ln: 需要源与目标');
    const [src, dst] = args.filter((a) => !a.startsWith('-'));
    const s = /^[a-zA-Z]:/.test(src) ? src : P.join(cwd, src);
    let d = /^[a-zA-Z]:/.test(dst) ? dst : P.join(cwd, dst);
    try {
      const dstStat = await ctx.fs.stat(d).catch(() => null);
      if (dstStat?.type === 'directory') d = P.join(d, P.basename(s));
      await ctx.fs.copy(s, d);
    } catch (err) {
      writeln(`${ansi.red}ln: ${err?.message || '失败'}${ansi.reset}`);
    }
  },
};

COMMANDS.du = {
  desc: '磁盘使用量（-h 人类可读，-s 汇总）',
  run: async (args, { cwd, ctx, writeln }) => {
    const human = args.includes('-h');
    const summary = args.includes('-s');
    const rest = args.filter((a) => !a.startsWith('-'));
    const target = rest[0] ? (/^[a-zA-Z]:/.test(rest[0]) ? rest[0] : P.join(cwd, rest[0])) : cwd;

    async function calcSize(dir) {
      let total = 0;
      try {
        const entries = await ctx.fs.readDir(dir);
        for (const e of entries) {
          if (e.type === 'directory') total += await calcSize(e.path);
          else total += e.size;
        }
      } catch { /* ignore */ }
      return total;
    }

    try {
      const stat = await ctx.fs.stat(target);
      if (stat.type === 'file') {
        writeln(`${human ? P.formatSize(stat.size) : stat.size}\t${target}`);
      } else {
        if (summary) {
          const total = await calcSize(target);
          writeln(`${human ? P.formatSize(total) : total}\t${target}`);
        } else {
          const entries = await ctx.fs.readDir(target);
          for (const e of entries) {
            if (e.type === 'directory') {
              const size = await calcSize(e.path);
              writeln(`${(human ? P.formatSize(size) : String(size)).padStart(10)}\t${e.name}/`);
            } else {
              writeln(`${(human ? P.formatSize(e.size) : String(e.size)).padStart(10)}\t${e.name}`);
            }
          }
        }
      }
    } catch (err) {
      writeln(`${ansi.red}du: ${err?.message || '错误'}${ansi.reset}`);
    }
  },
};

COMMANDS.df = {
  desc: '显示磁盘空间使用情况',
  run: async (_args, { ctx, writeln, ansi }) => {
    writeln(`${ansi.bold}文件系统     总大小    已使用    可用    使用率  挂载点${ansi.reset}`);
    const drives = ctx.fs.getDrives();
    for (const d of drives) {
      try {
        const usage = await ctx.fs.usage(d.drive);
        const total = 1024 * 1024 * 1024; // 模拟 1GB 虚拟盘
        const used = total - (usage.files || 0) * 1024;
        const pct = Math.round((used / total) * 100);
        writeln(`${d.drive}:/         ${P.formatSize(total)}  ${P.formatSize(used)}  ${P.formatSize(total - used)}   ${pct}%    /`);
      } catch {
        writeln(`${d.drive}:/         -         -         -        -     /`);
      }
    }
  },
};

COMMANDS.tree = {
  desc: '树形展示目录结构',
  run: async (args, { cwd, ctx, writeln }) => {
    const root = args[0] ? (/^[a-zA-Z]:/.test(args[0]) ? args[0] : P.join(cwd, args[0])) : cwd;
    writeln(root);
    async function walk(path, prefix) {
      let entries;
      try { entries = await ctx.fs.readDir(path); } catch { return; }
      entries = entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'directory' ? -1 : 1);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const last = i === entries.length - 1;
        writeln(`${prefix}${last ? '└─ ' : '├─ '}${e.name}${e.type === 'directory' ? '/' : ''}`);
        if (e.type === 'directory') await walk(e.path, prefix + (last ? '   ' : '│  '));
      }
    }
    await walk(root, '');
  },
};

COMMANDS.file = {
  desc: '检测文件类型',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (!args.length) throw new Error('file: 缺少文件参数');
    const mimeTypes = {
      txt: 'ASCII text',
      md: 'Markdown document',
      json: 'JSON data',
      js: 'JavaScript source',
      css: 'CSS stylesheet',
      html: 'HTML document',
      xml: 'XML document',
      csv: 'CSV text',
      png: 'PNG image data',
      jpg: 'JPEG image data',
      jpeg: 'JPEG image data',
      gif: 'GIF image data',
      webp: 'WebP image data',
      bmp: 'BMP image data',
      svg: 'SVG image data',
      mp3: 'MPEG audio',
      wav: 'WAV audio',
      mp4: 'MPEG video',
      zip: 'Zip archive',
      pdf: 'PDF document',
      exe: 'PE32 executable',
      sh: 'Bourne-Again shell script',
      bat: 'DOS batch file',
      ini: 'INI configuration',
      yml: 'YAML document',
      yaml: 'YAML document',
    };
    for (const arg of args) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const stat = await ctx.fs.stat(path);
        if (stat.type === 'directory') {
          writeln(`${path}: directory`);
        } else {
          const ext = P.extname(path);
          writeln(`${path}: ${mimeTypes[ext] || 'data'}`);
        }
      } catch (err) {
        writeln(`${ansi.red}file: ${arg}: ${err?.message || '无法访问'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.stat = {
  desc: '显示文件/目录详细信息',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (!args.length) throw new Error('stat: 缺少文件参数');
    for (const arg of args) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const st = await ctx.fs.stat(path);
        writeln(`  File: ${st.path}`);
        writeln(`  Size: ${st.size}\t\tType: ${st.type}`);
        writeln(`  Created: ${P.formatDate(st.created)}`);
        writeln(`  Modified: ${P.formatDate(st.modified)}`);
      } catch (err) {
        writeln(`${ansi.red}stat: ${arg}: ${err?.message || '无法访问'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.diff = {
  desc: '比较两个文件（简易行对比）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (args.length < 2) throw new Error('diff: 需要两个文件');
    const [a, b] = args;
    const pathA = /^[a-zA-Z]:/.test(a) ? a : P.join(cwd, a);
    const pathB = /^[a-zA-Z]:/.test(b) ? b : P.join(cwd, b);
    try {
      const textA = await ctx.fs.readFile(pathA, 'utf-8');
      const textB = await ctx.fs.readFile(pathB, 'utf-8');
      const linesA = (typeof textA === 'string' ? textA : new TextDecoder().decode(textA)).split('\n');
      const linesB = (typeof textB === 'string' ? textB : new TextDecoder().decode(textB)).split('\n');
      const maxLen = Math.max(linesA.length, linesB.length);
      let hasDiff = false;
      for (let i = 0; i < maxLen; i++) {
        if (linesA[i] !== linesB[i]) {
          hasDiff = true;
          if (linesA[i] !== undefined) writeln(`${ansi.red}< ${linesA[i]}${ansi.reset}`);
          if (linesB[i] !== undefined) writeln(`${ansi.green}> ${linesB[i]}${ansi.reset}`);
        }
      }
      if (!hasDiff) writeln('(文件相同)');
    } catch (err) {
      writeln(`${ansi.red}diff: ${err?.message || '错误'}${ansi.reset}`);
    }
  },
};

COMMANDS.sort = {
  desc: '排序文本行（-r 逆序，-n 数值排序）',
  run: async (args, { cwd, ctx, writeln, ansi, stdin }) => {
    const reverse = args.includes('-r');
    const numeric = args.includes('-n');
    const files = args.filter((a) => !a.startsWith('-'));

    async function doSort(content) {
      let lines = content.split('\n').filter((l) => l !== '');
      if (numeric) {
        lines.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
      } else {
        lines.sort((a, b) => a.localeCompare(b, 'zh'));
      }
      if (reverse) lines.reverse();
      writeln(lines.join('\n'));
    }

    if (stdin) { await doSort(stdin); return; }
    if (!files.length) throw new Error('sort: 缺少文件参数');
    for (const arg of files) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const text = await ctx.fs.readFile(path, 'utf-8');
        await doSort(typeof text === 'string' ? text : new TextDecoder().decode(text));
      } catch (err) {
        writeln(`${ansi.red}sort: ${arg}: ${err?.message || '无法读取'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.uniq = {
  desc: '去除重复行（-c 计数，-d 仅重复行）',
  run: async (args, { cwd, ctx, writeln, ansi, stdin }) => {
    const count = args.includes('-c');
    const dupOnly = args.includes('-d');
    const files = args.filter((a) => !a.startsWith('-'));

    async function doUniq(content) {
      const lines = content.split('\n').filter((l) => l !== '');
      const freq = new Map();
      for (const line of lines) freq.set(line, (freq.get(line) || 0) + 1);
      for (const [line, n] of freq) {
        if (dupOnly && n < 2) continue;
        writeln(count ? `${String(n).padStart(7)} ${line}` : line);
      }
    }

    if (stdin) { await doUniq(stdin); return; }
    if (!files.length) throw new Error('uniq: 缺少文件参数');
    for (const arg of files) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const text = await ctx.fs.readFile(path, 'utf-8');
        await doUniq(typeof text === 'string' ? text : new TextDecoder().decode(text));
      } catch (err) {
        writeln(`${ansi.red}uniq: ${arg}: ${err?.message || '无法读取'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.cut = {
  desc: '按分隔符提取字段（-d <delim> -f <fields>）',
  run: async (args, { cwd, ctx, writeln, ansi, stdin }) => {
    const dIdx = args.indexOf('-d');
    const fIdx = args.indexOf('-f');
    const delim = dIdx >= 0 ? args[dIdx + 1] || '\t' : '\t';
    const fields = fIdx >= 0 ? args[fIdx + 1] || '1' : '1';
    const files = args.filter((a) => !a.startsWith('-') && a !== args[dIdx + 1] && a !== args[fIdx + 1]);
    const fieldNums = fields.split(',').map((f) => parseInt(f) - 1);

    async function doCut(content) {
      for (const line of content.split('\n')) {
        if (!line) continue;
        const parts = line.split(delim);
        writeln(fieldNums.map((i) => parts[i] || '').join(delim));
      }
    }

    if (stdin) { await doCut(stdin); return; }
    if (!files.length) throw new Error('cut: 缺少文件参数');
    for (const arg of files) {
      const path = /^[a-zA-Z]:/.test(arg) ? arg : P.join(cwd, arg);
      try {
        const text = await ctx.fs.readFile(path, 'utf-8');
        await doCut(typeof text === 'string' ? text : new TextDecoder().decode(text));
      } catch (err) {
        writeln(`${ansi.red}cut: ${arg}: ${err?.message || '无法读取'}${ansi.reset}`);
      }
    }
  },
};

COMMANDS.tr = {
  desc: '字符替换（tr <set1> <set2>）',
  run: async (args, { stdin, writeln }) => {
    if (args.length < 2) throw new Error('tr: 需要两个字符集');
    const [set1, set2] = args;
    if (stdin) {
      let result = stdin;
      for (let i = 0; i < Math.min(set1.length, set2.length); i++) {
        result = result.split(set1[i]).join(set2[i]);
      }
      writeln(result);
    } else {
      writeln('tr: 需要管道输入');
    }
  },
};

// ── 文本/输出命令 ────────────────────────────────────────

COMMANDS.echo = {
  desc: '回显文本（支持 > 和 >> 重定向，-n 不换行，-e 解析转义）',
  run: async (args, { cwd, ctx, writeln, write, ansi }) => {
    const noNewline = args.includes('-n');
    const parseEscapes = args.includes('-e');
    let clean = args.filter((a) => a !== '-n' && a !== '-e');

    // 处理重定向
    const over = clean.indexOf('>');
    const append = clean.indexOf('>>');
    let target = null;
    let mode = 'w';
    if (over >= 0 && (append < 0 || over < append)) {
      target = clean[over + 1];
      mode = 'w';
      clean = clean.slice(0, over);
    } else if (append >= 0) {
      target = clean[append + 1];
      mode = 'a';
      clean = clean.slice(0, append);
    }

    let text = clean.join(' ');
    text = text.replace(/^["']|["']$/g, '');
    if (parseEscapes) {
      text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
    }

    if (target) {
      const path = /^[a-zA-Z]:/.test(target) ? target : P.join(cwd, target);
      let existing = '';
      if (mode === 'a') {
        try { existing = await ctx.fs.readFile(path, 'utf-8'); } catch { /* ignore */ }
      }
      await ctx.fs.writeFile(path, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + text);
      return;
    }

    if (noNewline) write(text);
    else writeln(text);
  },
};

COMMANDS.printf = {
  desc: '格式化输出',
  run: (args, { writeln }) => {
    if (!args.length) return;
    const format = args[0].replace(/^["']|["']$/g, '');
    const vals = args.slice(1).map((a) => a.replace(/^["']|["']$/g, ''));
    let i = 0;
    const result = format.replace(/%[sd]/g, () => vals[i++] || '');
    writeln(result);
  },
};

COMMANDS.yes = {
  desc: '重复输出字符串（Ctrl+C 停止，默认 "y"）',
  run: (args, { writeln }) => {
    const text = args.length ? args.join(' ') : 'y';
    // 输出 50 行后自动停止以避免无限循环
    for (let i = 0; i < 50; i++) writeln(text);
    writeln('(自动停止于 50 行)');
  },
};

COMMANDS.seq = {
  desc: '生成数字序列（seq <last> 或 seq <first> <last> [step]）',
  run: (args, { writeln }) => {
    let first = 1, last, step = 1;
    if (args.length === 1) { last = parseInt(args[0]); }
    else if (args.length === 2) { first = parseInt(args[0]); last = parseInt(args[1]); }
    else { first = parseInt(args[0]); last = parseInt(args[2]); step = parseInt(args[1]); }
    if (isNaN(last)) throw new Error('seq: 参数无效');
    const result = [];
    for (let i = first; i <= last; i += step) result.push(i);
    writeln(result.join('\n'));
  },
};

COMMANDS.clear = {
  desc: '清屏',
  run: (_args, { clearScreen }) => clearScreen(),
};

// ── 系统信息命令 ─────────────────────────────────────────

COMMANDS.date = {
  desc: '显示/设置日期时间（-u UTC，+format 格式化）',
  run: (_args, { writeln }) => {
    const d = new Date();
    const opts = {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZoneName: 'short',
    };
    writeln(d.toLocaleString('zh-CN', opts));
  },
};

COMMANDS.whoami = {
  desc: '显示当前用户名',
  run: (_args, { env, writeln }) => writeln(env.get('USER') || 'user'),
};

COMMANDS.hostname = {
  desc: '显示主机名',
  run: (_args, { env, writeln }) => writeln(env.get('HOSTNAME') || 'WindowsNext'),
};

COMMANDS.uname = {
  desc: '显示系统信息（-a 全部，-s 内核，-n 节点名，-r 版本）',
  run: (args, { writeln }) => {
    const all = args.includes('-a') || args.length === 0;
    const parts = [];
    if (all || args.includes('-s')) parts.push('WindowsNext');
    if (all || args.includes('-n')) parts.push(location.hostname || 'WindowsNext');
    if (all || args.includes('-r')) parts.push('1.0.0');
    if (all || args.includes('-v')) parts.push('#1 Web');
    if (all || args.includes('-m')) parts.push(navigator.platform || 'x86_64');
    if (all || args.includes('-p')) parts.push('unknown');
    if (all || args.includes('-i')) parts.push('WebDesktop');
    if (all || args.includes('-o')) parts.push('GNU/Web');
    writeln(parts.join(' '));
  },
};

COMMANDS.uptime = {
  desc: '显示系统运行时间',
  run: (_args, { writeln }) => {
    const uptime = performance.now() / 1000;
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = Math.floor(uptime % 60);
    const parts = [];
    if (days) parts.push(`${days} 天`);
    if (hours) parts.push(`${hours} 小时`);
    if (mins) parts.push(`${mins} 分钟`);
    parts.push(`${secs} 秒`);
    const d = new Date();
    writeln(` ${d.toTimeString().slice(0, 8)} up ${parts.join(', ')}`);
  },
};

COMMANDS.env = {
  desc: '显示/设置环境变量（env [VAR=value]）',
  run: async (args, { writeln, env: envStore }) => {
    if (args.length === 0) {
      for (const [key, val] of envStore.getAll()) {
        writeln(`${key}=${val}`);
      }
      return;
    }
    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        envStore.set(arg.slice(0, eqIdx), arg.slice(eqIdx + 1));
      } else {
        const val = envStore.get(arg);
        if (val !== undefined) writeln(val);
      }
    }
  },
};

COMMANDS.export = {
  desc: '设置环境变量（export VAR=value）',
  run: (args, { env: envStore, writeln, ansi }) => {
    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        envStore.set(arg.slice(0, eqIdx), arg.slice(eqIdx + 1));
      } else {
        writeln(`${ansi.red}export: 用法: export VAR=value${ansi.reset}`);
      }
    }
  },
};

COMMANDS.ps = {
  desc: '显示进程状态（-a 全部，-u 用户格式）',
  run: (_args, { writeln, ansi }) => {
    const procs = processManager.list();
    writeln(`${ansi.bold}PID       CPU%   MEM(MB)  STATUS     NAME${ansi.reset}`);
    for (const p of procs) {
      const status = p.status === 'running' ? `${ansi.green}运行中${ansi.reset}` : `${ansi.yellow}已暂停${ansi.reset}`;
      writeln(`${String(p.pid).padEnd(10)}${String(p.cpu).padEnd(7)}${String(p.memory).padEnd(9)}${status}  ${p.name}`);
    }
  },
};

COMMANDS.kill = {
  desc: '终止进程（kill <pid>）',
  run: (args, { writeln, ansi }) => {
    if (!args.length) throw new Error('kill: 需要 PID');
    for (const arg of args) {
      const pid = parseInt(arg);
      if (isNaN(pid)) { writeln(`${ansi.red}kill: ${arg}: 无效 PID${ansi.reset}`); continue; }
      const proc = processManager.processes.get(pid);
      if (!proc) { writeln(`${ansi.red}kill: ${pid}: 进程不存在${ansi.reset}`); continue; }
      if (proc.system) { writeln(`${ansi.red}kill: ${pid}: 无法终止系统进程${ansi.reset}`); continue; }
      processManager.kill(pid);
      writeln(`已终止进程 ${pid} (${proc.name})`);
    }
  },
};

COMMANDS.top = {
  desc: '打开系统进程监控工具',
  run: async (_args, { ctx, writeln }) => {
    writeln('正在启动 top ...');
    await ctx.openPath('top:');
  },
};

COMMANDS.neofetch = {
  desc: '系统信息概览',
  run: async (_args, { ctx, writeln, ansi }) => {
    const ua = navigator.userAgent;
    const colorBar = `${ansi.bgRed}   ${ansi.reset}${ansi.green}${ansi.bgRed}   ${ansi.reset}${ansi.yellow}${ansi.bgRed}   ${ansi.reset}${ansi.blue}${ansi.bgRed}   ${ansi.reset}${ansi.magenta}${ansi.bgRed}   ${ansi.reset}${ansi.cyan}${ansi.bgRed}   ${ansi.reset}${ansi.white}${ansi.bgRed}   ${ansi.reset}`;
    writeln(`       _______________       `);
    writeln(`      /               \\      `);
    writeln(`     /  WindowsNext    \\     `);
    writeln(`    /    ___________    \\    `);
    writeln(`    |   /           \\   |   `);
    writeln(`    |   |   _____   |   |   `);
    writeln(`    |   |   |   |   |   |   `);
    writeln(`    \\   |   |   |   |   /    `);
    writeln(`     \\  |___|___|___|  /     `);
    writeln(`      \\_______________/      `);
    writeln('');
    writeln(`${ansi.bold}${ansi.cyan}OS:${ansi.reset}       WindowsNext 1.0 (Web)`);
    writeln(`${ansi.bold}${ansi.cyan}Host:${ansi.reset}     ${location.host}`);
    writeln(`${ansi.bold}${ansi.cyan}Kernel:${ansi.reset}   ${ua.split(' ').slice(-1)[0] || 'unknown'}`);
    writeln(`${ansi.bold}${ansi.cyan}Shell:${ansi.reset}    wnsh 2.0 (xterm.js)`);
    writeln(`${ansi.bold}${ansi.cyan}Resolution:${ansi.reset} ${window.innerWidth}x${window.innerHeight}`);
    writeln(`${ansi.bold}${ansi.cyan}Theme:${ansi.reset}    ${ctx.settings.get('appearance.theme')}`);
    writeln(`${ansi.bold}${ansi.cyan}Accent:${ansi.reset}   ${ctx.settings.get('appearance.accent')}`);
    writeln(`${ansi.bold}${ansi.cyan}Terminal:${ansi.reset} xterm.js`);
    writeln(`${ansi.bold}${ansi.cyan}User:${ansi.reset}     ${ctx.settings.get('system.userName') || 'user'}`);
    writeln('');
    writeln(colorBar);
  },
};

COMMANDS.help = {
  desc: '显示可用命令',
  run: (_args, { writeln, ansi }) => {
    writeln(`${ansi.bold}${ansi.cyan}WindowsNext 终端 v2.0 (xterm.js)${ansi.reset}`);
    writeln('');
    writeln(`${ansi.bold}可用命令：${ansi.reset}`);
    const entries = Object.entries(COMMANDS).sort((a, b) => a[0].localeCompare(b[0]));
    const cols = 2;
    const colWidth = 36;
    for (let i = 0; i < entries.length; i += cols) {
      let line = '';
      for (let j = 0; j < cols && i + j < entries.length; j++) {
        const [name, c] = entries[i + j];
        line += `  ${ansi.green}${name.padEnd(14)}${ansi.reset}${ansi.gray}${(c.desc || '').slice(0, colWidth - 16)}${ansi.reset}`;
        if (j < cols - 1) line += '  ';
      }
      writeln(line);
    }
    writeln('');
    writeln(`${ansi.bold}快捷键：${ansi.reset}`);
    writeln(`  ↑ / ↓           浏览历史`);
    writeln(`  Tab             路径补全`);
    writeln(`  Ctrl+L          清屏`);
    writeln(`  Ctrl+C          取消当前输入`);
    writeln(`  Ctrl+D          退出终端`);
    writeln(`  Ctrl+U          删除到行首`);
    writeln(`  Ctrl+K          删除到行尾`);
    writeln(`  Ctrl+W          删除前一个词`);
    writeln(`  Home/End        行首/行尾`);
    writeln('');
    writeln(`${ansi.bold}管道和重定向：${ansi.reset}`);
    writeln(`  cmd1 | cmd2     管道`);
    writeln(`  cmd > file      输出重定向`);
    writeln(`  cmd >> file     追加重定向`);
  },
};

COMMANDS.open = {
  desc: '用默认关联应用打开文件或目录',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (!args.length) throw new Error('open: 缺少路径');
    for (const a of args) {
      const path = /^[a-zA-Z]:/.test(a) ? a : P.join(cwd, a);
      try { await ctx.openPath(path); }
      catch (err) { writeln(`${ansi.red}open: ${a}: ${err?.message || '失败'}${ansi.reset}`); }
    }
  },
};

COMMANDS.history = {
  desc: '显示命令历史（-c 清除）',
  run: (_args, { writeln }, history) => {
    if (_args.includes('-c')) { history.length = 0; return; }
    // history 需要从外部传入，这里通过全局获取
    const h = (typeof history !== 'undefined' && Array.isArray(history)) ? history : [];
    h.forEach((cmd, i) => writeln(`${String(i + 1).padStart(5)}  ${cmd}`));
  },
};

// ── 网络命令 ─────────────────────────────────────────────

COMMANDS.curl = {
  desc: '获取 URL 内容（模拟，仅显示请求信息）',
  run: (args, { writeln, ansi }) => {
    if (!args.length) throw new Error('curl: 缺少 URL');
    const url = args[0];
    try { new URL(url); } catch { writeln(`${ansi.red}curl: 无效 URL: ${url}${ansi.reset}`); return; }
    writeln(`${ansi.bold}curl: 在浏览器沙箱中无法发起跨域请求${ansi.reset}`);
    writeln(`${ansi.gray}提示: 可尝试使用内置浏览器打开 URL${ansi.reset}`);
    writeln(`请求: GET ${url}`);
  },
};

COMMANDS.wget = {
  desc: '下载文件（模拟，仅显示请求信息）',
  run: (args, { writeln, ansi }) => {
    if (!args.length) throw new Error('wget: 缺少 URL');
    writeln(`${ansi.bold}wget: 在浏览器沙箱中无法下载文件${ansi.reset}`);
    writeln(`请求: GET ${args[0]}`);
  },
};

COMMANDS.ping = {
  desc: '测试网络连通性（模拟）',
  run: (args, { writeln, ansi }) => {
    const host = args[0] || 'localhost';
    writeln(`PING ${host} 56(84) bytes of data.`);
    for (let i = 0; i < 4; i++) {
      const time = (Math.random() * 30 + 5).toFixed(1);
      writeln(`64 bytes from ${host}: icmp_seq=${i + 1} ttl=64 time=${time} ms`);
    }
    writeln('');
    writeln(`--- ${host} ping statistics ---`);
    writeln(`4 packets transmitted, 4 received, 0% packet loss`);
  },
};

COMMANDS.ifconfig = {
  desc: '显示网络接口信息（模拟）',
  run: (_args, { writeln, ansi }) => {
    writeln(`${ansi.bold}lo:${ansi.reset} flags=73<UP,LOOPBACK,RUNNING>  mtu 65536`);
    writeln(`        inet 127.0.0.1  netmask 255.0.0.0`);
    writeln(`        inet6 ::1  prefixlen 128`);
    writeln('');
    writeln(`${ansi.bold}eth0:${ansi.reset} flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500`);
    writeln(`        inet ${location.hostname || '192.168.1.100'}  netmask 255.255.255.0`);
    writeln(`        ether ${Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':')}`);
  },
};

// ── 实用工具命令 ─────────────────────────────────────────

COMMANDS.calc = {
  desc: '简单计算器（calc <表达式>）',
  run: (args, { writeln, ansi }) => {
    if (!args.length) throw new Error('calc: 缺少表达式');
    try {
      const expr = args.join(' ');
      // 安全检查：只允许数字、运算符、括号和小数点
      if (!/^[\d\s+\-*/().%^]+$/.test(expr)) throw new Error('表达式包含非法字符');
      const sanitized = expr.replace(/\^/g, '**');
      const result = Function('"use strict"; return (' + sanitized + ')')();
      writeln(`${expr} = ${result}`);
    } catch (err) {
      writeln(`${ansi.red}calc: ${err?.message || '计算错误'}${ansi.reset}`);
    }
  },
};

COMMANDS.alias = {
  desc: '显示/创建命令别名（alias [name=value]）',
  run: (args, { writeln, env: envStore }) => {
    if (!args.length) {
      for (const [key, val] of envStore.getAll()) {
        if (key.startsWith('ALIAS_')) writeln(`alias ${key.slice(6).toLowerCase()}='${val}'`);
      }
      return;
    }
    for (const arg of args) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        envStore.set(`ALIAS_${arg.slice(0, eqIdx).toUpperCase()}`, arg.slice(eqIdx + 1).replace(/^["']|["']$/g, ''));
      }
    }
  },
};

COMMANDS.source = {
  desc: '执行文件中的命令（source <file>）',
  run: async (args, { cwd, ctx, writeln, ansi }) => {
    if (!args.length) throw new Error('source: 缺少文件名');
    const path = /^[a-zA-Z]:/.test(args[0]) ? args[0] : P.join(cwd, args[0]);
    try {
      const text = await ctx.fs.readFile(path, 'utf-8');
      const content = typeof text === 'string' ? text : new TextDecoder().decode(text);
      writeln(`${ansi.gray}# 已加载 ${path}（${content.split('\n').length} 行）${ansi.reset}`);
    } catch (err) {
      writeln(`${ansi.red}source: ${args[0]}: ${err?.message || '无法读取'}${ansi.reset}`);
    }
  },
};

COMMANDS.which = {
  desc: '查找命令位置',
  run: (args, { writeln, ansi }) => {
    if (!args.length) throw new Error('which: 缺少命令名');
    for (const name of args) {
      if (COMMANDS[name]) {
        writeln(`/bin/${name} (内置命令)`);
      } else {
        writeln(`${ansi.red}which: ${name}: 未找到${ansi.reset}`);
      }
    }
  },
};

COMMANDS.type = {
  desc: '显示命令类型',
  run: (args, { writeln, ansi }) => {
    if (!args.length) throw new Error('type: 缺少命令名');
    for (const name of args) {
      if (COMMANDS[name]) {
        writeln(`${name} 是内置命令`);
      } else {
        writeln(`${ansi.red}type: ${name}: 未找到${ansi.reset}`);
      }
    }
  },
};

COMMANDS.sleep = {
  desc: '暂停指定秒数（sleep <seconds>）',
  run: (args, { writeln }) => {
    const secs = parseFloat(args[0]) || 1;
    writeln(`等待 ${secs} 秒...`);
    return new Promise((resolve) => setTimeout(resolve, secs * 1000));
  },
};

COMMANDS.exit = {
  desc: '退出终端',
  run: (_args, { ctx }) => {
    ctx.window.close();
  },
};

COMMANDS.logout = {
  desc: '退出终端',
  run: (_args, { ctx }) => {
    ctx.window.close();
  },
};

/**
 * 执行命令入口
 * @param {string} name
 * @param {string[]} args
 * @param {object} context
 */
export async function runCommand(name, args, context) {
  const cmd = COMMANDS[name];
  if (!cmd) throw new Error(`${name}: 命令未找到，输入 'help' 查看可用命令`);
  await cmd.run(args, context);
}
