/**
 * 真实本地目录 Provider（File System Access API）
 *
 * 用户通过「挂载本地文件夹」授权后，该目录以额外驱动器（D:/E:/…）的形式
 * 接入统一文件系统门面，对上层应用与虚拟盘完全一致。
 *
 * 目录句柄持久化到 IndexedDB，刷新后可恢复（但需用户重新授予权限）。
 */

import { idb, STORES } from '../storage.js';
import { createLogger } from '../logger.js';
import * as P from './path-utils.js';

const log = createLogger('NativeFS');

export class NativeFSProvider {
  /**
   * @param {string} drive 盘符（大写单字母）
   * @param {FileSystemDirectoryHandle} handle
   * @param {string} [label]
   */
  constructor(drive, handle, label) {
    this.drive = drive.toUpperCase();
    this.rootHandle = handle;
    this.label = label || handle?.name || '本地文件夹';
    this.readonly = false;
    this._permissionGranted = false;
  }

  /** 浏览器是否支持 File System Access API */
  static isSupported() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  get isAvailable() {
    return Boolean(this.rootHandle);
  }

  /**
   * 弹出目录选择器
   * @returns {Promise<FileSystemDirectoryHandle|null>}
   */
  static async pickDirectory() {
    if (!NativeFSProvider.isSupported()) {
      throw new Error('当前浏览器不支持访问本地文件夹，请使用 Chrome / Edge 等基于 Chromium 的浏览器');
    }
    try {
      return await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (err) {
      if (err?.name === 'AbortError') return null;
      throw err;
    }
  }

  /**
   * 检查并请求读写权限
   * @param {boolean} [request=true]
   * @returns {Promise<boolean>}
   */
  async ensurePermission(request = true) {
    if (!this.rootHandle) return false;
    const opts = { mode: 'readwrite' };
    try {
      let state = await this.rootHandle.queryPermission(opts);
      if (state === 'granted') { this._permissionGranted = true; return true; }
      if (state === 'prompt' && request) {
        state = await this.rootHandle.requestPermission(opts);
      }
      this._permissionGranted = state === 'granted';
      return this._permissionGranted;
    } catch (err) {
      log.warn('权限检查失败', err);
      return false;
    }
  }

  async init() {
    await this.ensurePermission(false);
  }

  /* ==========================================================
     句柄定位
     ========================================================== */

  /**
   * @param {string} path
   * @param {{create?:boolean}} [opts]
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  async _dirHandle(path, opts = {}) {
    if (!this.rootHandle) throw new Error('驱动器未挂载');
    let h = this.rootHandle;
    for (const seg of P.segments(path)) {
      h = await h.getDirectoryHandle(seg, { create: Boolean(opts.create) });
    }
    return h;
  }

  /**
   * @param {string} path
   * @param {{create?:boolean}} [opts]
   * @returns {Promise<FileSystemFileHandle>}
   */
  async _fileHandle(path, opts = {}) {
    const dir = await this._dirHandle(P.dirname(path), { create: Boolean(opts.create) });
    return dir.getFileHandle(P.basename(path), { create: Boolean(opts.create) });
  }

  /** 统一错误转译 */
  _wrap(err, path) {
    if (err?.name === 'NotFoundError') return new Error(`路径不存在：${path}`);
    if (err?.name === 'NotAllowedError') return new Error('没有访问权限，请重新授权该文件夹');
    if (err?.name === 'TypeMismatchError') return new Error(`类型不匹配：${path}`);
    return err instanceof Error ? err : new Error(String(err));
  }

  /* ==========================================================
     公共 API
     ========================================================== */

  /** @param {string} path */
  async readDir(path) {
    if (!(await this.ensurePermission())) throw new Error('没有访问权限');
    try {
      const dir = await this._dirHandle(path);
      const base = P.normalize(path);
      const out = [];
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') {
          out.push({
            name, path: P.join(base, name), type: 'directory',
            size: 0, created: 0, modified: 0, ext: '',
          });
        } else {
          let size = 0;
          let modified = 0;
          try {
            const f = await handle.getFile();
            size = f.size;
            modified = f.lastModified;
          } catch { /* 个别文件读取失败不影响列表 */ }
          out.push({
            name, path: P.join(base, name), type: 'file',
            size, created: modified, modified, ext: P.extname(name),
          });
        }
      }
      return out;
    } catch (err) {
      throw this._wrap(err, path);
    }
  }

  /** @param {string} path */
  async stat(path) {
    if (P.isRoot(path)) {
      return { name: `${this.drive}:`, path: P.normalize(path), type: 'directory', size: 0, created: 0, modified: 0, ext: '' };
    }
    try {
      const fh = await this._fileHandle(path);
      const f = await fh.getFile();
      return {
        name: P.basename(path), path: P.normalize(path), type: 'file',
        size: f.size, created: f.lastModified, modified: f.lastModified, ext: P.extname(path),
      };
    } catch {
      try {
        await this._dirHandle(path);
        return {
          name: P.basename(path), path: P.normalize(path), type: 'directory',
          size: 0, created: 0, modified: 0, ext: '',
        };
      } catch (err) {
        throw this._wrap(err, path);
      }
    }
  }

  /** @param {string} path */
  async exists(path) {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} path
   * @param {'utf8'|'binary'|'dataurl'|'blob'} [encoding='utf8']
   */
  async readFile(path, encoding = 'utf8') {
    if (!(await this.ensurePermission())) throw new Error('没有访问权限');
    try {
      const fh = await this._fileHandle(path);
      const file = await fh.getFile();
      if (encoding === 'utf8') return await file.text();
      if (encoding === 'binary') return await file.arrayBuffer();
      if (encoding === 'blob') return file;
      if (encoding === 'dataurl') {
        return await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(fr.error);
          fr.readAsDataURL(file);
        });
      }
      return await file.text();
    } catch (err) {
      throw this._wrap(err, path);
    }
  }

  /**
   * @param {string} path
   * @param {string|ArrayBuffer|Blob} data
   */
  async writeFile(path, data) {
    if (!(await this.ensurePermission())) throw new Error('没有写入权限');
    try {
      const fh = await this._fileHandle(path, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
    } catch (err) {
      throw this._wrap(err, path);
    }
  }

  /** @param {string} path */
  async mkdir(path) {
    if (!(await this.ensurePermission())) throw new Error('没有写入权限');
    try {
      await this._dirHandle(path, { create: true });
    } catch (err) {
      throw this._wrap(err, path);
    }
  }

  /**
   * @param {string} path
   * @param {boolean} [recursive=true]
   */
  async remove(path, recursive = true) {
    if (!(await this.ensurePermission())) throw new Error('没有写入权限');
    if (P.isRoot(path)) throw new Error('不能删除驱动器根目录');
    try {
      const parent = await this._dirHandle(P.dirname(path));
      await parent.removeEntry(P.basename(path), { recursive });
    } catch (err) {
      throw this._wrap(err, path);
    }
  }

  /**
   * File System Access API 无原生重命名，采用「复制 + 删除」实现
   * @param {string} oldPath @param {string} newPath
   */
  async rename(oldPath, newPath) {
    if (P.normalize(oldPath) === P.normalize(newPath)) return;
    // Chrome 111+ 支持 move()
    try {
      const fh = await this._fileHandle(oldPath);
      if (typeof fh.move === 'function') {
        if (P.dirname(oldPath) === P.dirname(newPath)) {
          await fh.move(P.basename(newPath));
        } else {
          const targetDir = await this._dirHandle(P.dirname(newPath), { create: true });
          await fh.move(targetDir, P.basename(newPath));
        }
        return;
      }
    } catch { /* 落到通用路径 */ }

    await this.copy(oldPath, newPath);
    await this.remove(oldPath, true);
  }

  /** @param {string} src @param {string} dest */
  async copy(src, dest) {
    const st = await this.stat(src);
    if (st.type === 'file') {
      const blob = await this.readFile(src, 'blob');
      await this.writeFile(dest, blob);
      return;
    }
    await this.mkdir(dest);
    for (const item of await this.readDir(src)) {
      await this.copy(item.path, P.join(dest, item.name));
    }
  }

  async usage() {
    return { total: 0, files: 0, dirs: 0, unknown: true };
  }

  /* ==========================================================
     句柄持久化
     ========================================================== */

  /** @param {string} drive */
  async persistHandle(drive) {
    try {
      await idb.put(STORES.HANDLES, `mount:${drive}`, {
        handle: this.rootHandle,
        label: this.label,
        drive,
      });
    } catch (err) {
      log.warn('句柄持久化失败（部分浏览器不支持结构化克隆 handle）', err);
    }
  }

  /**
   * 恢复已保存的挂载点
   * @returns {Promise<Array<{drive:string, handle:FileSystemDirectoryHandle, label:string}>>}
   */
  static async restoreSaved() {
    if (!NativeFSProvider.isSupported()) return [];
    try {
      const keys = await idb.keys(STORES.HANDLES);
      const out = [];
      for (const k of keys) {
        if (typeof k !== 'string' || !k.startsWith('mount:')) continue;
        const rec = await idb.get(STORES.HANDLES, k);
        if (rec?.handle) out.push(rec);
      }
      return out;
    } catch (err) {
      log.warn('恢复挂载点失败', err);
      return [];
    }
  }

  /** @param {string} drive */
  static async forget(drive) {
    await idb.delete(STORES.HANDLES, `mount:${drive}`).catch(() => {});
  }
}

export default NativeFSProvider;
