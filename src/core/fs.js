/**
 * 虚拟文件系统 VFS：
 * - assets 映射为 C:/Users/<User>/Documents
 * - IndexedDB 用户覆盖层
 * - File System Access API 本地目录挂载为盘符
 */
const DB_NAME = 'wn-vfs';
const DB_STORE = 'files';

function pathJoin(...parts) {
  return parts.join('/').replace(/\/+/g, '/').replace(/^\//, '') || '';
}

function parsePath(p) {
  const clean = p.replace(/\\/g, '/').replace(/\/$/, '').replace(/^\//, '');
  const segs = clean ? clean.split('/') : [];
  return { drive: segs[0] || '', segs };
}

export class VFS {
  constructor() {
    this.tree = { __files: {} };
    this.mounts = new Map(); // drive -> { handle, name }
    this.userFiles = new Map(); // path -> content
    this.ready = this._initDB();
  }

  async _initDB() {
    return new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'path' });
      };
      req.onsuccess = (e) => { this.db = e.target.result; this._loadUserFiles().then(resolve); };
      req.onerror = () => { this.db = null; resolve(); };
    });
  }

  async _loadUserFiles() {
    if (!this.db) return;
    const tx = this.db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const all = await new Promise((res) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    });
    for (const f of all) this.userFiles.set(f.path, f.data);
  }

  async _writeUserFile(path, data) {
    this.userFiles.set(path, data);
    if (!this.db) return;
    const tx = this.db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.put({ path, data, updated: Date.now() });
    return new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = rej;
    });
  }

  setAssetsRoot(files) {
    // files: [{ name, path, isDir, size? }]
    const root = { __files: {} };
    for (const f of files) {
      const segs = f.path.split('/');
      let cur = root;
      for (let i = 0; i < segs.length - 1; i++) {
        const s = segs[i];
        if (!cur[s]) cur[s] = { __files: {} };
        cur = cur[s];
      }
      const last = segs[segs.length - 1];
      if (f.isDir) {
        if (!cur[last]) cur[last] = { __files: {} };
      } else {
        cur.__files[last] = { ...f, isAsset: true };
      }
    }
    this.tree['C:'] = { __files: { Users: { __files: { [this.getUserName()]: { __files: { Documents: root } } } } } };
  }

  getUserName() { return localStorage.getItem('wn-username') || 'User'; }

  async indexAssets(baseUrl = '/assets') {
    const list = [];
    const walk = async (rel) => {
      try {
        const res = await fetch(`${baseUrl}${rel}`, { method: 'GET' });
        if (!res.ok) return;
        const text = await res.text();
        // naive directory listing parse
        const matches = [...text.matchAll(/href="([^"]+)"/g)];
        for (const m of matches) {
          const name = decodeURIComponent(m[1]).replace(/\/$/, '');
          if (name === '..' || name === '.' || name.startsWith('?')) continue;
          const isDir = m[1].endsWith('/');
          const itemPath = `${rel}/${name}`.replace(/\/+/g, '/');
          list.push({ name, path: itemPath, isDir, size: 0 });
          if (isDir) await walk(itemPath);
        }
      } catch (e) { /* serve.js 默认不列出目录，这里降级为已知预设文件 */ }
    };
    // 已知静态资源结构
    const known = [
      'icons/icons8-file-explorer-new-96.png', 'icons/icons8-code-file-96.png', 'icons/icons8-bash-96.png',
      'wallpapers/windows-11-orange-pm.jpg', 'wallpapers/windows-xp-bliss-4k-lu.jpg',
      'html-wallpapers/aurora.html', 'html-wallpapers/matrix-rain.html', 'html-wallpapers/ocean-waves.html',
      'html-wallpapers/particles.html', 'html-wallpapers/starry-sky.html',
      'media/os.mp4', 'media/windows-sample.mp4', 'media/windows-welcome.ogg',
    ];
    for (const f of known) list.push({ name: f.split('/').pop(), path: `/${f}`, isDir: false, size: 0 });
    this.setAssetsRoot(list);
  }

  _navigate(path) {
    const { drive, segs } = parsePath(path);
    if (drive === 'C:') {
      let cur = this.tree['C:'];
      for (const s of segs.slice(1)) {
        if (!cur || !cur[s]) return null;
        cur = cur[s];
      }
      return { node: cur, drive, mount: null };
    }
    if (this.mounts.has(drive)) {
      return { node: null, drive, mount: this.mounts.get(drive), segs: segs.slice(1) };
    }
    return null;
  }

  async readDir(path) {
    await this.ready;
    const nav = this._navigate(path);
    if (!nav) return [];
    const { node, mount, segs, drive } = nav;
    if (mount) {
      let cur = mount.handle;
      for (const s of segs) {
        try { cur = await cur.getDirectoryHandle(s); } catch { return []; }
      }
      const out = [];
      for await (const [name, handle] of cur.entries()) {
        out.push({ name, path: pathJoin(drive, ...segs, name), isDir: handle.kind === 'directory', size: 0 });
      }
      return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    }
    if (!node) return [];
    const dirs = Object.keys(node).filter(k => k !== '__files');
    const files = Object.keys(node.__files || {});
    return [
      ...dirs.map(name => ({ name, path: pathJoin(drive, ...segs, name), isDir: true, size: 0 })),
      ...files.map(name => ({ name, path: pathJoin(drive, ...segs, name), isDir: false, size: node.__files[name].size || 0 })),
    ];
  }

  async fileStat(path) {
    await this.ready;
    const items = await this.readDir(path.replace(/\/[^/]*$/, ''));
    return items.find(i => i.path === path) || null;
  }

  async readFile(path) {
    await this.ready;
    const user = this.userFiles.get(path);
    if (user !== undefined) return user;

    const nav = this._navigate(path);
    if (!nav) return null;
    const { node, mount, segs, drive } = nav;
    if (mount) {
      const fileName = segs[segs.length - 1];
      const parentSegs = segs.slice(0, -1);
      let cur = mount.handle;
      for (const s of parentSegs) cur = await cur.getDirectoryHandle(s);
      const fh = await cur.getFileHandle(fileName);
      return await fh.getFile();
    }
    if (!node) return null;
    const fileName = segs[segs.length - 1];
    const file = node.__files?.[fileName];
    if (!file) return null;
    const url = `/assets${file.path}`;
    const res = await fetch(url);
    return res.ok ? await res.blob() : null;
  }

  async writeFile(path, data) {
    await this._writeUserFile(path, data);
  }

  async mkdir(path) {
    // VFS only: create stub dir in memory + persist marker
    await this._writeUserFile(path + '/', { __dir: true });
  }

  async mountLocal(handle, driveLetter) {
    const drive = `${driveLetter.toUpperCase()}:`;
    this.mounts.set(drive, { handle, name: handle.name });
    return drive;
  }

  async unmount(drive) {
    this.mounts.delete(drive);
  }

  getDrives() {
    const list = [{ letter: 'C:', label: 'System', type: 'system' }];
    for (const [drive, info] of this.mounts) {
      list.push({ letter: drive, label: info.name, type: 'local' });
    }
    return list;
  }

  normalizeDocPath() {
    return `C:/Users/${this.getUserName()}/Documents`;
  }
}
