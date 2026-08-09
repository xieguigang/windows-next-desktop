/**
 * 虚拟文件系统 Provider（C: 盘）
 *
 * 设计：
 *  - 目录树元数据常驻内存，防抖回写 localStorage（体积小、读取快）
 *  - 文件内容单独存 IndexedDB（避开 localStorage 5MB 限制，支持二进制）
 *  - 首次启动种入标准目录与示例文件
 */

import { LocalStore, idb, STORES, debounce } from '../storage.js';
import { createLogger } from '../logger.js';
import * as P from './path-utils.js';

const log = createLogger('VirtualFS');

const META_KEY = 'tree';

/**
 * 节点结构
 * @typedef {Object} VNode
 * @property {'file'|'directory'} type
 * @property {number} size
 * @property {number} created
 * @property {number} modified
 * @property {Record<string, VNode>} [children] 仅目录
 * @property {boolean} [readonly]
 */

/** 内置示例内容 */
const SEED_FILES = {
  'C:/Users/User/Documents/欢迎使用 WindowsNext.txt': `欢迎使用 WindowsNext
==========================

这是一个完全运行在浏览器中的 Windows 风格桌面环境。

【已内置的应用】
  · 文件资源管理器  - 多标签页浏览虚拟磁盘，可挂载真实本地文件夹
  · 计算器          - 标准 / 科学计算，以及函数绘图
  · 终端            - 模拟 bash，输入 help 查看全部命令
  · 浏览器          - 多标签页网页浏览
  · 媒体播放器      - 音视频播放与频谱可视化
  · 记事本          - 就是你现在正在用的这个
  · 任务管理器      - 查看运行中的应用与资源占用
  · 设置            - 更换壁纸、调节 Aero 毛玻璃强度

【上手提示】
  1. 双击桌面图标启动应用
  2. 拖动窗口到屏幕边缘可以贴边分屏
  3. 把窗口最大化，观察任务栏的毛玻璃效果如何消失
  4. 桌面空白处点右键可以更换壁纸
  5. 鼠标悬停在任务栏图标上会弹出窗口预览

【键盘快捷键】
  Alt + Tab          切换窗口
  Alt + F4           关闭当前窗口
  Win  + 方向键      窗口贴边 / 最大化 / 最小化
  Win  + D           显示桌面
  Esc                关闭菜单

祝使用愉快。
`,
  'C:/Users/User/Documents/开发笔记.md': `# WindowsNext 开发笔记

## 架构

采用微内核 + 应用插件模式：

- \`src/core/\`  内核：窗口、进程、文件系统、设置、通知
- \`src/shell/\` 外壳：桌面、任务栏、开始菜单、右键菜单、壁纸
- \`src/sdk/\`   对外编程接口
- \`src/apps/\`  内置应用，与第三方应用走完全相同的注册流程

## 注册一个新应用

\`\`\`js
WinNext.registerApp({
  id: 'my-app',
  name: '我的应用',
  icon: 'hello',
  defaultSize: { width: 600, height: 400 },
  mount(ctx) {
    ctx.root.innerHTML = '<h1>Hello WindowsNext</h1>';
  },
});
\`\`\`

详见 \`docs/APP_SDK.md\`。
`,
  'C:/Users/User/Documents/待办事项.txt': `待办事项
--------
[x] 搭建窗口管理器
[x] 实现 Aero 毛玻璃联动
[x] 任务栏图标堆叠与预览
[ ] 写一个自己的应用试试
[ ] 换一张喜欢的壁纸
`,
  'C:/Users/User/Desktop/README.txt': `把文件放在 C:/Users/User/Desktop 下，就会出现在桌面上。

试试在终端里执行：
  echo "Hello" > C:/Users/User/Desktop/test.txt
`,
};

/** 需要创建的空目录 */
const SEED_DIRS = [
  'C:/Windows',
  'C:/Windows/System32',
  'C:/Program Files',
  'C:/Program Files/WindowsNext',
  'C:/Users',
  'C:/Users/User',
  'C:/Users/User/Desktop',
  'C:/Users/User/Documents',
  'C:/Users/User/Downloads',
  'C:/Users/User/Pictures',
  'C:/Users/User/Music',
  'C:/Users/User/Videos',
  'C:/Temp',
];

export class VirtualFSProvider {
  /** @param {string} [drive='C'] */
  constructor(drive = 'C') {
    this.drive = drive.toUpperCase();
    this.label = '本地磁盘';
    this.readonly = false;
    this._store = new LocalStore(`vfs-${this.drive}`);
    /** @type {VNode} */
    this._root = { type: 'directory', size: 0, created: Date.now(), modified: Date.now(), children: {} };
    this._flush = debounce(() => this._persist(), 300);
    this._ready = false;
  }

  get isAvailable() {
    return true;
  }

  async init() {
    if (this._ready) return;
    const saved = this._store.get(META_KEY, null);
    if (saved && saved.children) {
      this._root = saved;
      log.info(`虚拟盘 ${this.drive}: 已从本地恢复`);
    } else {
      await this._seed();
      log.info(`虚拟盘 ${this.drive}: 已初始化默认目录结构`);
    }
    this._ready = true;
  }

  async _seed() {
    const now = Date.now();
    this._root = { type: 'directory', size: 0, created: now, modified: now, children: {} };
    for (const dir of SEED_DIRS) {
      if (P.driveOf(dir) !== this.drive) continue;
      this._ensureDir(dir);
    }
    for (const [path, content] of Object.entries(SEED_FILES)) {
      if (P.driveOf(path) !== this.drive) continue;
      try {
        await this.writeFile(path, content);
      } catch (err) {
        log.warn(`种入示例文件失败 ${path}`, err);
      }
    }
    this._persist();
  }

  /* ==========================================================
     内部树操作
     ========================================================== */

  /**
   * 定位节点
   * @param {string} path
   * @returns {VNode|null}
   */
  _find(path) {
    const segs = P.segments(path);
    let node = this._root;
    for (const seg of segs) {
      if (node.type !== 'directory' || !node.children) return null;
      const next = node.children[seg];
      if (!next) return null;
      node = next;
    }
    return node;
  }

  /**
   * 创建目录（含中间层级）
   * @param {string} path
   * @returns {VNode}
   */
  _ensureDir(path) {
    const segs = P.segments(path);
    let node = this._root;
    const now = Date.now();
    for (const seg of segs) {
      if (!node.children) node.children = {};
      let next = node.children[seg];
      if (!next) {
        next = { type: 'directory', size: 0, created: now, modified: now, children: {} };
        node.children[seg] = next;
        node.modified = now;
      } else if (next.type !== 'directory') {
        throw new Error(`路径冲突：${seg} 已存在且不是目录`);
      }
      node = next;
    }
    return node;
  }

  /**
   * @param {string} path
   * @returns {{parent:VNode, name:string}}
   */
  _parentOf(path) {
    const dir = P.dirname(path);
    const name = P.basename(path);
    const parent = this._find(dir);
    if (!parent) throw new Error(`目录不存在：${dir}`);
    if (parent.type !== 'directory') throw new Error(`不是目录：${dir}`);
    if (!parent.children) parent.children = {};
    return { parent, name };
  }

  /**
   * @param {string} path
   * @param {VNode} node
   * @returns {import('./fs-service.js').FileStat}
   */
  _toStat(path, node) {
    const n = P.normalize(path);
    return {
      name: P.isRoot(n) ? `${this.drive}:` : P.basename(n),
      path: n,
      type: node.type,
      size: node.size || 0,
      created: node.created || 0,
      modified: node.modified || 0,
      ext: node.type === 'file' ? P.extname(n) : '',
      readonly: Boolean(node.readonly),
    };
  }

  _persist() {
    const ok = this._store.set(META_KEY, this._root);
    if (!ok) log.error('虚拟盘元数据写入失败（可能配额已满）');
  }

  /** IndexedDB 中文件内容的 key */
  _contentKey(path) {
    return P.normalize(path);
  }

  /* ==========================================================
     公共 API
     ========================================================== */

  /**
   * @param {string} path
   * @returns {Promise<import('./fs-service.js').FileStat[]>}
   */
  async readDir(path) {
    const node = this._find(path);
    if (!node) throw new Error(`目录不存在：${path}`);
    if (node.type !== 'directory') throw new Error(`不是目录：${path}`);
    const base = P.normalize(path);
    return Object.entries(node.children || {}).map(([name, child]) =>
      this._toStat(P.join(base, name), child)
    );
  }

  /**
   * @param {string} path
   * @returns {Promise<import('./fs-service.js').FileStat>}
   */
  async stat(path) {
    const node = this._find(path);
    if (!node) throw new Error(`路径不存在：${path}`);
    return this._toStat(path, node);
  }

  /** @param {string} path @returns {Promise<boolean>} */
  async exists(path) {
    return this._find(path) !== null;
  }

  /**
   * @param {string} path
   * @param {'utf8'|'binary'|'dataurl'} [encoding='utf8']
   * @returns {Promise<string|ArrayBuffer>}
   */
  async readFile(path, encoding = 'utf8') {
    const node = this._find(path);
    if (!node) throw new Error(`文件不存在：${path}`);
    if (node.type !== 'file') throw new Error(`不是文件：${path}`);

    let raw;
    try {
      raw = await idb.get(STORES.FILES, this._contentKey(path));
    } catch (err) {
      log.error(`读取文件内容失败 ${path}`, err);
      throw new Error('存储读取失败');
    }
    if (raw === undefined || raw === null) return encoding === 'binary' ? new ArrayBuffer(0) : '';

    return convert(raw, encoding, P.basename(path));
  }

  /**
   * @param {string} path
   * @param {string|ArrayBuffer|Blob|Uint8Array} data
   */
  async writeFile(path, data) {
    const { parent, name } = this._parentOf(path);
    const existing = parent.children[name];
    if (existing && existing.type === 'directory') throw new Error(`已存在同名目录：${name}`);
    if (existing?.readonly) throw new Error(`文件为只读：${name}`);

    const check = P.validateName(name);
    if (!check.ok) throw new Error(check.reason);

    let stored = data;
    if (data instanceof Uint8Array) stored = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const size = computeSize(stored);

    try {
      await idb.put(STORES.FILES, this._contentKey(path), stored);
    } catch (err) {
      log.error(`写入文件内容失败 ${path}`, err);
      throw new Error('存储写入失败，可能空间不足');
    }

    const now = Date.now();
    parent.children[name] = {
      type: 'file',
      size,
      created: existing?.created || now,
      modified: now,
    };
    parent.modified = now;
    this._flush();
  }

  /** @param {string} path */
  async mkdir(path) {
    const n = P.normalize(path);
    if (this._find(n)) throw new Error(`已存在：${P.basename(n)}`);
    const check = P.validateName(P.basename(n));
    if (!check.ok) throw new Error(check.reason);
    this._ensureDir(n);
    this._flush();
  }

  /**
   * @param {string} path
   * @param {boolean} [recursive=true]
   */
  async remove(path, recursive = true) {
    const n = P.normalize(path);
    if (P.isRoot(n)) throw new Error('不能删除根目录');
    const { parent, name } = this._parentOf(n);
    const node = parent.children[name];
    if (!node) throw new Error(`路径不存在：${n}`);
    if (node.readonly) throw new Error(`受保护的项目：${name}`);
    if (node.type === 'directory' && !recursive && Object.keys(node.children || {}).length) {
      throw new Error('目录非空');
    }

    // 收集需要清理内容的文件
    const files = [];
    const walk = (nd, p) => {
      if (nd.type === 'file') { files.push(p); return; }
      for (const [k, child] of Object.entries(nd.children || {})) walk(child, P.join(p, k));
    };
    walk(node, n);

    delete parent.children[name];
    parent.modified = Date.now();
    this._flush();

    await Promise.all(files.map((f) => idb.delete(STORES.FILES, this._contentKey(f)).catch(() => {})));
  }

  /**
   * @param {string} oldPath
   * @param {string} newPath
   */
  async rename(oldPath, newPath) {
    const from = P.normalize(oldPath);
    const to = P.normalize(newPath);
    if (from === to) return;
    if (P.isSubPath(from, to)) throw new Error('不能移动到自身的子目录');

    const src = this._parentOf(from);
    const node = src.parent.children[src.name];
    if (!node) throw new Error(`路径不存在：${from}`);
    if (node.readonly) throw new Error(`受保护的项目：${src.name}`);

    const dst = this._parentOf(to);
    const check = P.validateName(dst.name);
    if (!check.ok) throw new Error(check.reason);
    if (dst.parent.children[dst.name]) throw new Error(`目标已存在：${dst.name}`);

    // 迁移 IndexedDB 中的文件内容
    const moves = [];
    const walk = (nd, oldP, newP) => {
      if (nd.type === 'file') { moves.push([oldP, newP]); return; }
      for (const k of Object.keys(nd.children || {})) {
        walk(nd.children[k], P.join(oldP, k), P.join(newP, k));
      }
    };
    walk(node, from, to);

    delete src.parent.children[src.name];
    dst.parent.children[dst.name] = node;
    node.modified = Date.now();
    dst.parent.modified = Date.now();
    src.parent.modified = Date.now();
    this._flush();

    for (const [o, nn] of moves) {
      try {
        const content = await idb.get(STORES.FILES, this._contentKey(o));
        if (content !== undefined) {
          await idb.put(STORES.FILES, this._contentKey(nn), content);
          await idb.delete(STORES.FILES, this._contentKey(o));
        }
      } catch (err) {
        log.warn(`迁移文件内容失败 ${o} → ${nn}`, err);
      }
    }
  }

  /**
   * @param {string} src
   * @param {string} dest
   */
  async copy(src, dest) {
    const from = P.normalize(src);
    const to = P.normalize(dest);
    if (P.isSubPath(from, to)) throw new Error('不能复制到自身的子目录');
    const node = this._find(from);
    if (!node) throw new Error(`路径不存在：${from}`);

    if (node.type === 'file') {
      const content = await idb.get(STORES.FILES, this._contentKey(from)).catch(() => '');
      await this.writeFile(to, content ?? '');
      return;
    }
    await this.mkdir(to);
    for (const name of Object.keys(node.children || {})) {
      await this.copy(P.join(from, name), P.join(to, name));
    }
  }

  /** 递归统计已用空间 */
  async usage() {
    let total = 0;
    let files = 0;
    let dirs = 0;
    const walk = (nd) => {
      if (nd.type === 'file') { total += nd.size || 0; files++; return; }
      dirs++;
      for (const child of Object.values(nd.children || {})) walk(child);
    };
    walk(this._root);
    return { total, files, dirs: Math.max(0, dirs - 1) };
  }

  /** 清空并重建 */
  async reset() {
    await idb.clear(STORES.FILES).catch(() => {});
    this._store.remove(META_KEY);
    await this._seed();
    log.warn(`虚拟盘 ${this.drive}: 已重置`);
  }
}

/* ============================================================
   内容转换
   ============================================================ */

const MIME_MAP = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  txt: 'text/plain', md: 'text/markdown', html: 'text/html', css: 'text/css',
  js: 'text/javascript', json: 'application/json',
};

/** @param {string} filename */
export function mimeOf(filename) {
  return MIME_MAP[P.extname(filename)] || 'application/octet-stream';
}

function computeSize(data) {
  if (typeof data === 'string') return new Blob([data]).size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (data instanceof Blob) return data.size;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

/**
 * 把存储原值转换为请求的编码形式
 * @param {any} raw
 * @param {'utf8'|'binary'|'dataurl'|'blob'} encoding
 * @param {string} filename
 */
async function convert(raw, encoding, filename) {
  const mime = mimeOf(filename);

  if (encoding === 'utf8') {
    if (typeof raw === 'string') return raw;
    if (raw instanceof Blob) return await raw.text();
    if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
    return String(raw);
  }

  if (encoding === 'binary') {
    if (raw instanceof ArrayBuffer) return raw;
    if (raw instanceof Blob) return await raw.arrayBuffer();
    if (typeof raw === 'string') return new TextEncoder().encode(raw).buffer;
    return new ArrayBuffer(0);
  }

  if (encoding === 'blob') {
    if (raw instanceof Blob) return raw;
    return new Blob([raw], { type: mime });
  }

  if (encoding === 'dataurl') {
    const blob = raw instanceof Blob ? raw : new Blob([raw], { type: mime });
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  return raw;
}

export default VirtualFSProvider;
