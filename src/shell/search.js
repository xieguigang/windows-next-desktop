import { getIcon } from '../ui/icons.js';

/**
 * 桌面搜索：搜索应用与 VFS 文件
 */
export class Search {
  constructor(wm, fs, apps, bus) {
    this.wm = wm;
    this.fs = fs;
    this.apps = apps;
    this.bus = bus;

    this.el = document.getElementById('search-overlay');
    this.input = document.getElementById('search-input');
    this.results = document.getElementById('search-results');

    this.input.addEventListener('input', () => this._search(this.input.value));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  open() { this.el.classList.remove('hidden'); this.input.focus(); }
  close() { this.el.classList.add('hidden'); this.results.innerHTML = ''; this.input.value = ''; }
  toggle() { this.el.classList.contains('hidden') ? this.open() : this.close(); }

  async _search(q) {
    this.results.innerHTML = '';
    const term = q.trim().toLowerCase();
    if (!term) return;

    const appHits = Object.entries(this.apps)
      .filter(([id, a]) => a.name.toLowerCase().includes(term) || id.includes(term))
      .map(([id, a]) => ({ type: 'app', id, name: a.name, icon: a.icon }));

    const fileHits = await this._searchFiles(term);

    const addHeader = (text) => {
      const h = document.createElement('div');
      h.style.cssText = 'font-size:11px;opacity:0.6;padding:8px 4px 4px;text-transform:uppercase;letter-spacing:0.5px;';
      h.textContent = text;
      this.results.appendChild(h);
    };

    if (appHits.length) {
      addHeader('Apps');
      for (const hit of appHits) this._renderItem(hit.name, hit.icon, () => {
        this.wm.open({ appId: hit.id, ...this.apps[hit.id].open() });
        this.close();
      });
    }
    if (fileHits.length) {
      addHeader('Files');
      for (const f of fileHits) this._renderItem(f.name, f.isDir ? 'folder' : 'file', () => {
        this.bus.emit('file:open', { path: f.path });
        this.close();
      });
    }
    if (!appHits.length && !fileHits.length) {
      this.results.innerHTML = '<div style="padding:12px;opacity:0.7;text-align:center">No results</div>';
    }
  }

  async _searchFiles(term) {
    const root = this.fs.normalizeDocPath();
    const hits = [];
    const walk = async (path) => {
      const items = await this.fs.readDir(path);
      for (const item of items) {
        if (item.name.toLowerCase().includes(term)) hits.push(item);
        if (item.isDir) await walk(item.path);
      }
    };
    try { await walk(root); } catch (e) {}
    return hits.slice(0, 20);
  }

  _renderItem(label, icon, onClick) {
    const el = document.createElement('div');
    el.className = 'search-result-item';
    el.innerHTML = `${getIcon(icon, 20)} <span>${label}</span>`;
    el.addEventListener('click', onClick);
    this.results.appendChild(el);
  }
}
