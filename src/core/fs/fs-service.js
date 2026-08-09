/**
 * 文件系统门面
 *
 * 按盘符把请求路由到对应 Provider，对上层应用完全屏蔽虚拟盘 / 真实目录的差异。
 * 所有写操作后广播 `fs:changed`，Explorer 等应用据此刷新视图。
 */

import bus from '../event-bus.js';
import { createLogger } from '../logger.js';
import { VirtualFSProvider, mimeOf } from './virtual-fs-provider.js';
import { NativeFSProvider } from './native-fs-provider.js';
import * as P from './path-utils.js';

const log = createLogger('FileSystem');

/**
 * @typedef {Object} FileStat
 * @property {string} name
 * @property {string} path
 * @property {'file'|'directory'} type
 * @property {number} size
 * @property {number} created
 * @property {number} modified
 * @property {string} ext
 * @property {boolean} [readonly]
 */

/** 特殊目录快捷方式 */
export const SHELL_FOLDERS = Object.freeze({
  desktop: 'C:/Users/User/Desktop',
  documents: 'C:/Users/User/Documents',
  downloads: 'C:/Users/User/Downloads',
  pictures: 'C:/Users/User/Pictures',
  music: 'C:/Users/User/Music',
  videos: 'C:/Users/User/Videos',
  home: 'C:/Users/User',
  temp: 'C:/Temp',
});

class FileSystemService {
  constructor() {
    /** @type {Map<string, VirtualFSProvider|NativeFSProvider>} 盘符 → provider */
    this.providers = new Map();
    this._ready = false;
  }

  async init() {
    if (this._ready) return;
    const c = new VirtualFSProvider('C');
    await c.init();
    this.providers.set('C', c);

    // 尝试恢复此前挂载的真实目录（不主动请求权限，首次访问时再弹）
    if (NativeFSProvider.isSupported()) {
      try {
        for (const rec of await NativeFSProvider.restoreSaved()) {
          const p = new NativeFSProvider(rec.drive, rec.handle, rec.label);
          await p.init();
          this.providers.set(rec.drive, p);
          log.info(`已恢复挂载点 ${rec.drive}: ${rec.label}`);
        }
      } catch (err) {
        log.warn('恢复挂载点时出错', err);
      }
    }

    this._ready = true;
    log.info('文件系统已就绪');
  }

  /* ==========================================================
     驱动器
     ========================================================== */

  /** @returns {Array<{drive:string, label:string, type:'virtual'|'native', available:boolean}>} */
  getDrives() {
    return [...this.providers.entries()].map(([drive, p]) => ({
      drive,
      label: p.label,
      type: p instanceof NativeFSProvider ? 'native' : 'virtual',
      available: p.isAvailable,
      root: `${drive}:/`,
    }));
  }

  /**
   * @param {string} path
   * @returns {VirtualFSProvider|NativeFSProvider}
   */
  _route(path) {
    const drive = P.driveOf(path);
    const p = this.providers.get(drive);
    if (!p) throw new Error(`驱动器 ${drive}: 不存在`);
    return p;
  }

  /**
   * 当前浏览器是否支持挂载本地文件夹（File System Access API）
   * @returns {boolean}
   */
  isNativeFSSupported() {
    return NativeFSProvider.isSupported();
  }

  /**
   * 挂载真实本地文件夹为新驱动器
   * @returns {Promise<{drive:string, label:string}|null>}
   */
  async mountLocalFolder() {
    const handle = await NativeFSProvider.pickDirectory();
    if (!handle) return null;

    // 从 D 开始寻找空闲盘符
    let drive = null;
    for (let c = 68; c <= 90; c++) {
      const letter = String.fromCharCode(c);
      if (!this.providers.has(letter)) { drive = letter; break; }
    }
    if (!drive) throw new Error('可用盘符已耗尽');

    const provider = new NativeFSProvider(drive, handle, handle.name);
    const ok = await provider.ensurePermission(true);
    if (!ok) throw new Error('未获得该文件夹的读写权限');

    this.providers.set(drive, provider);
    await provider.persistHandle(drive);
    bus.emit('fs:drives-changed', { drives: this.getDrives() });
    log.info(`已挂载 ${drive}: → ${handle.name}`);
    return { drive, label: handle.name };
  }

  /**
   * 卸载驱动器
   * @param {string} drive
   */
  async unmountDrive(drive) {
    const d = String(drive).toUpperCase().replace(':', '');
    if (d === 'C') throw new Error('不能卸载系统盘');
    this.providers.delete(d);
    await NativeFSProvider.forget(d);
    bus.emit('fs:drives-changed', { drives: this.getDrives() });
    log.info(`已卸载 ${d}:`);
  }

  /* ==========================================================
     读操作
     ========================================================== */

  /**
   * 列出目录内容（目录优先，名称自然序）
   * @param {string} path
   * @returns {Promise<FileStat[]>}
   */
  async readDir(path) {
    const items = await this._route(path).readDir(P.normalize(path));
    return items.sort(compareEntries);
  }

  /**
   * @param {string} path
   * @param {'utf8'|'binary'|'dataurl'|'blob'} [encoding='utf8']
   */
  async readFile(path, encoding = 'utf8') {
    return this._route(path).readFile(P.normalize(path), encoding);
  }

  /** @param {string} path @returns {Promise<FileStat>} */
  async stat(path) {
    return this._route(path).stat(P.normalize(path));
  }

  /** @param {string} path @returns {Promise<boolean>} */
  async exists(path) {
    try {
      return await this._route(path).exists(P.normalize(path));
    } catch {
      return false;
    }
  }

  /**
   * 为媒体文件生成可直接用于 <img>/<video>/<audio> 的 URL。
   * 返回的 URL 由调用方在销毁时 revoke。
   * @param {string} path
   * @returns {Promise<{url:string, revoke:()=>void}>}
   */
  async createObjectURL(path) {
    const blob = await this.readFile(path, 'blob');
    const b = blob instanceof Blob ? blob : new Blob([blob], { type: mimeOf(path) });
    const url = URL.createObjectURL(b);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }

  /* ==========================================================
     写操作
     ========================================================== */

  /**
   * @param {string} path
   * @param {string|ArrayBuffer|Blob|Uint8Array} data
   */
  async writeFile(path, data) {
    const n = P.normalize(path);
    await this._route(n).writeFile(n, data);
    this._changed(P.dirname(n), 'write', n);
  }

  /** @param {string} path */
  async mkdir(path) {
    const n = P.normalize(path);
    await this._route(n).mkdir(n);
    this._changed(P.dirname(n), 'mkdir', n);
  }

  /**
   * @param {string} path
   * @param {boolean} [recursive=true]
   */
  async remove(path, recursive = true) {
    const n = P.normalize(path);
    await this._route(n).remove(n, recursive);
    this._changed(P.dirname(n), 'remove', n);
  }

  /**
   * @param {string} oldPath
   * @param {string} newPath
   */
  async rename(oldPath, newPath) {
    const from = P.normalize(oldPath);
    const to = P.normalize(newPath);
    if (P.driveOf(from) !== P.driveOf(to)) {
      // 跨驱动器：复制后删除
      await this.copy(from, to);
      await this.remove(from, true);
      return;
    }
    await this._route(from).rename(from, to);
    this._changed(P.dirname(from), 'rename', from);
    if (P.dirname(from) !== P.dirname(to)) this._changed(P.dirname(to), 'rename', to);
  }

  /**
   * 复制（支持跨驱动器）
   * @param {string} src
   * @param {string} dest
   */
  async copy(src, dest) {
    const from = P.normalize(src);
    const to = P.normalize(dest);
    if (from === to) {
      const dir = P.dirname(to);
      const siblings = (await this.readDir(dir)).map((i) => i.name);
      const unique = P.uniqueName(P.basename(to), siblings);
      return this.copy(from, P.join(dir, unique));
    }

    if (P.driveOf(from) === P.driveOf(to)) {
      await this._route(from).copy(from, to);
    } else {
      const st = await this.stat(from);
      if (st.type === 'file') {
        const blob = await this.readFile(from, 'blob');
        await this.writeFile(to, blob);
      } else {
        await this.mkdir(to);
        for (const item of await this.readDir(from)) {
          await this.copy(item.path, P.join(to, item.name));
        }
      }
    }
    this._changed(P.dirname(to), 'copy', to);
  }

  /**
   * 移动（等价于跨目录 rename）
   * @param {string} src @param {string} dest
   */
  async move(src, dest) {
    return this.rename(src, dest);
  }

  /**
   * 在目录中创建不重名的新项
   * @param {string} dir
   * @param {string} baseName
   * @param {'file'|'directory'} type
   * @param {string} [content='']
   * @returns {Promise<string>} 新建项的完整路径
   */
  async createUnique(dir, baseName, type, content = '') {
    const siblings = (await this.readDir(dir)).map((i) => i.name);
    const name = P.uniqueName(baseName, siblings);
    const full = P.join(dir, name);
    if (type === 'directory') await this.mkdir(full);
    else await this.writeFile(full, content);
    return full;
  }

  /**
   * 递归搜索
   * @param {string} root
   * @param {string} keyword
   * @param {{limit?:number, maxDepth?:number}} [opts]
   * @returns {Promise<FileStat[]>}
   */
  async search(root, keyword, opts = {}) {
    const limit = opts.limit ?? 200;
    const maxDepth = opts.maxDepth ?? 8;
    const kw = String(keyword).toLowerCase().trim();
    if (!kw) return [];
    const out = [];

    const walk = async (dir, depth) => {
      if (out.length >= limit || depth > maxDepth) return;
      let items;
      try {
        items = await this.readDir(dir);
      } catch {
        return;
      }
      for (const item of items) {
        if (out.length >= limit) return;
        if (item.name.toLowerCase().includes(kw)) out.push(item);
        if (item.type === 'directory') await walk(item.path, depth + 1);
      }
    };
    await walk(P.normalize(root), 0);
    return out;
  }

  /**
   * 磁盘用量
   * @param {string} [drive='C']
   */
  async usage(drive = 'C') {
    const p = this.providers.get(String(drive).toUpperCase());
    if (!p) return { total: 0, files: 0, dirs: 0 };
    return p.usage();
  }

  /** 重置虚拟盘 */
  async resetVirtualDrive() {
    const c = this.providers.get('C');
    if (c instanceof VirtualFSProvider) {
      await c.reset();
      this._changed('C:/', 'reset', 'C:/');
    }
  }

  /**
   * @param {string} dir
   * @param {string} action
   * @param {string} path
   */
  _changed(dir, action, path) {
    bus.emit('fs:changed', { dir: P.normalize(dir), action, path });
  }
}

/** 目录优先，之后按名称自然序 */
function compareEntries(a, b) {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

export const fileSystem = new FileSystemService();
export { P as pathUtils, mimeOf };
export default fileSystem;
