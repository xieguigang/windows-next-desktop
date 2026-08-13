import { getIcon } from '../ui/icons.js';

const PINNED = [
  { name: 'Documents', color: '#FCD34D' },
  { name: 'Downloads', color: '#34C759' },
  { name: 'Pictures', color: '#0A84FF' },
  { name: 'Music', color: '#FF3B30' },
  { name: 'Videos', color: '#A855F7' },
];

const TAGS = [
  { name: 'Work', color: '#EF4444' },
  { name: 'Games', color: '#3B82F6' },
  { name: 'Files', color: '#F59E0B' },
  { name: 'Important', color: '#22C55E' },
  { name: 'Movies', color: '#A855F7' },
];

const RECENT = [
  { name: 'Windows Utopia', folder: 'Documents > Work', time: '1h' },
  { name: 'Text Document', folder: 'Documents > Work', time: '16h' },
  { name: 'Windows 12.1', folder: 'Documents', time: 'yes' },
  { name: 'Windows 11 2020', folder: 'Documents > Work', time: '2d' },
];

const FAVORITES = [
  { name: 'Windows Logo', folder: 'Documents > Logos', time: '1y' },
  { name: 'Text Document', folder: 'Documents', time: '4m' },
  { name: 'Website', folder: 'Files', time: '12m' },
  { name: 'Windows 13', folder: 'Documents > Work', time: '3y' },
];

export function createExplorer(ctx) {
  const { fs, bus } = ctx;
  let currentPath = fs.normalizeDocPath();
  let view = 'home';
  const root = document.createElement('div');
  root.className = 'explorer';

  const homeView = () => {
    view = 'home';
    root.innerHTML = `
      <div class="explorer-toolbar">
        <button data-nav="back">‹</button>
        <button data-nav="forward">›</button>
        <button data-nav="up">↑</button>
        <div class="explorer-path">Home</div>
        <div class="explorer-search"><svg viewBox="0 0 24 24" width="14" height="14"><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="text" placeholder="Search Anything" /></div>
      </div>
      <div class="explorer-body">
        <aside class="explorer-sidebar">
          <div class="explorer-section-title">Pinned</div>
          <div class="explorer-nav-item active">${getIcon('folder', 16)} Home</div>
          <div class="explorer-section-title">Drives</div>
          <div class="explorer-nav-item" data-drive="C:">${getIcon('folder', 16)} System</div>
          <div id="explorer-mounts"></div>
          <button id="explorer-mount-btn" style="margin:8px 10px;padding:6px 10px;border-radius:6px;background:rgba(128,128,128,0.12);font-size:11px">Mount local folder</button>
        </aside>
        <main class="explorer-main">
          <div class="explorer-home">
            <div class="explorer-home-title">Home</div>
            <div class="explorer-home-search"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="text" placeholder="Search Anything" /></div>
            <div class="explorer-grid">
              <div class="explorer-card">
                <div class="explorer-card-title">📌 Pinned</div>
                <div class="explorer-card-grid" id="home-pinned"></div>
                <div class="explorer-card-title">🏷 Tags</div>
                <div class="explorer-card-grid" id="home-tags"></div>
              </div>
              <div class="explorer-card">
                <div class="explorer-card-title">Recent Items</div>
                <div id="home-recent"></div>
              </div>
              <div class="explorer-card">
                <div class="explorer-card-title">Favorites</div>
                <div id="home-favorites"></div>
              </div>
            </div>
          </div>
        </main>
      </div>
    `;
    const renderPinned = () => {
      const el = root.querySelector('#home-pinned');
      el.innerHTML = PINNED.map(p => `
        <div class="file-item" data-folder="${p.name}">
          <div class="file-icon">${getIcon('folder', 40)}</div>
          <div class="file-name">${p.name}</div>
        </div>
      `).join('');
    };
    const renderTags = () => {
      const el = root.querySelector('#home-tags');
      el.innerHTML = TAGS.map(t => `
        <div class="file-item">
          <div class="file-icon" style="color:${t.color}">${getIcon('folder', 40)}</div>
          <div class="file-name">${t.name}</div>
        </div>
      `).join('');
    };
    const renderList = (el, items) => {
      el.innerHTML = items.map(it => `
        <div class="file-list-item">
          ${getIcon('file', 18)}
          <div>
            <div>${it.name}</div>
            <div style="font-size:10px;opacity:0.55">${it.folder}</div>
          </div>
          <div class="file-meta">${it.time}</div>
        </div>
      `).join('');
    };
    renderPinned(); renderTags();
    renderList(root.querySelector('#home-recent'), RECENT);
    renderList(root.querySelector('#home-favorites'), FAVORITES);

    root.querySelectorAll('[data-folder]').forEach(el => el.addEventListener('click', () => {
      currentPath = `${fs.normalizeDocPath()}/${el.dataset.folder}`;
      folderView();
    }));
    bindSidebar();
  };

  const folderView = async () => {
    view = 'folder';
    root.innerHTML = `
      <div class="explorer-toolbar">
        <button data-nav="back">‹</button>
        <button data-nav="forward">›</button>
        <button data-nav="up">↑</button>
        <div class="explorer-path">${currentPath}</div>
        <div class="explorer-search"><svg viewBox="0 0 24 24" width="14" height="14"><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="text" placeholder="Search" /></div>
      </div>
      <div class="explorer-body">
        <aside class="explorer-sidebar">
          <div class="explorer-section-title">Pinned</div>
          <div class="explorer-nav-item" data-home>Home</div>
          <div class="explorer-section-title">Drives</div>
          <div class="explorer-nav-item" data-drive="C:">${getIcon('folder', 16)} System</div>
          <div id="explorer-mounts"></div>
        </aside>
        <main class="explorer-main" id="folder-main"></main>
      </div>
    `;
    const main = root.querySelector('#folder-main');
    const items = await fs.readDir(currentPath);
    const title = document.createElement('div');
    title.className = 'explorer-home-title';
    title.textContent = currentPath.split('/').pop() || 'Home';
    main.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'explorer-card-grid';
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'file-item';
      el.innerHTML = `<div class="file-icon">${getIcon(it.isDir ? 'folder' : iconFor(it.name), 40)}</div><div class="file-name">${it.name}</div>`;
      el.addEventListener('dblclick', () => {
        if (it.isDir) { currentPath = it.path; folderView(); }
        else bus.emit('file:open', { path: it.path });
      });
      grid.appendChild(el);
    }
    main.appendChild(grid);
    bindSidebar();
  };

  const iconFor = (name) => {
    const l = name.toLowerCase();
    if (/\.(png|jpg|jpeg|webp|gif)$/.test(l)) return 'image';
    if (/\.(mp4|webm|mov)$/.test(l)) return 'video';
    if (/\.(mp3|ogg|wav|flac)$/.test(l)) return 'music';
    return 'file';
  };

  const bindSidebar = () => {
    root.querySelector('[data-home]')?.addEventListener('click', homeView);
    root.querySelector('[data-drive="C:"]')?.addEventListener('click', () => {
      currentPath = `C:/Users/${fs.getUserName()}/Documents`; folderView();
    });
    const mountsEl = root.querySelector('#explorer-mounts');
    const drives = fs.getDrives().filter(d => d.type === 'local');
    if (mountsEl) {
      mountsEl.innerHTML = drives.map(d => `
        <div class="explorer-nav-item" data-drive="${d.letter}">${getIcon('folder', 16)} ${d.letter} ${d.label}</div>
      `).join('');
      mountsEl.querySelectorAll('[data-drive]').forEach(el => el.addEventListener('click', () => {
        currentPath = el.dataset.drive + '/';
        folderView();
      }));
    }
    root.querySelector('#explorer-mount-btn')?.addEventListener('click', mountLocal);
  };

  const mountLocal = async () => {
    if (!window.showDirectoryPicker) {
      alert('Your browser does not support local folder mounting.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      const drive = await fs.mountLocal(handle, 'D');
      alert(`Mounted as ${drive}`);
      if (view === 'home') homeView(); else folderView();
    } catch (e) {
      console.warn('mount cancelled', e);
    }
  };

  homeView();
  return root;
}

export const ExplorerApp = {
  id: 'explorer',
  name: 'File Manager',
  icon: 'explorer',
  open(args = {}) {
    return { title: 'File Manager', icon: 'explorer', width: 900, height: 580 };
  },
  mount(ctx, win) {
    win.setContent(createExplorer(ctx));
  },
};
