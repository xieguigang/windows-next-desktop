import { getIcon } from '../ui/icons.js';

const CATEGORIES = [
  { id: 'system', name: 'System', icon: '🖥' },
  { id: 'devices', name: 'Devices', icon: '🖱' },
  { id: 'network', name: 'Network', icon: '🌐' },
  { id: 'apps', name: 'Apps', icon: '📦' },
  { id: 'accounts', name: 'Accounts', icon: '👤' },
  { id: 'personalization', name: 'Personalization', icon: '🎨' },
  { id: 'time', name: 'Time & Language', icon: '🕐' },
  { id: 'accessibility', name: 'Accessibility', icon: '♿' },
  { id: 'update', name: 'Update', icon: '🔄' },
  { id: 'privacy', name: 'Privacy', icon: '🔒' },
];

const WALLPAPERS = [
  { type: 'image', src: '/assets/wallpapers/windows-11-orange-pm.jpg', label: 'Orange PM' },
  { type: 'image', src: '/assets/wallpapers/windows-xp-bliss-4k-lu.jpg', label: 'Bliss' },
  { type: 'html', src: '/assets/html-wallpapers/aurora.html', label: 'Aurora' },
  { type: 'html', src: '/assets/html-wallpapers/matrix-rain.html', label: 'Matrix' },
  { type: 'html', src: '/assets/html-wallpapers/ocean-waves.html', label: 'Ocean' },
  { type: 'html', src: '/assets/html-wallpapers/particles.html', label: 'Particles' },
  { type: 'html', src: '/assets/html-wallpapers/starry-sky.html', label: 'Starry' },
];

export function createSettings(ctx) {
  const { settings, notify, bus, theme } = ctx;
  let page = 'personalization';
  const root = document.createElement('div');
  root.className = 'settings';

  const render = () => {
    root.innerHTML = '';
    const user = settings.get();
    const header = document.createElement('div');
    header.className = 'settings-header';
    header.innerHTML = `
      <div class="settings-user">
        <img class="settings-avatar" src="/assets/icons/icons8-bash-96.png" onerror="this.style.display='none'" alt="User" />
        <div>
          <div class="settings-user-name">${user.username}</div>
          <div class="settings-user-email">${user.email}</div>
        </div>
      </div>
      <div class="settings-title">Settings</div>
      <div class="settings-shortcuts">
        <div class="settings-shortcut"><div class="sc-icon">☁</div><div>Cloudbay</div></div>
        <div class="settings-shortcut"><div class="sc-icon">🔄</div><div>Update</div></div>
        <div class="settings-shortcut"><div class="sc-icon">🏆</div><div>Rewards</div></div>
      </div>
    `;
    root.appendChild(header);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'settings-search-wrap';
    searchWrap.innerHTML = `
      <div class="settings-search">
        <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input type="text" placeholder="Search Anything" />
      </div>
    `;
    root.appendChild(searchWrap);

    const tags = document.createElement('div');
    tags.className = 'settings-tags';
    tags.innerHTML = ['#Personalization', '#Comfortableeye', '#Malware', '#Security'].map(t => `<span class="settings-tag">${t}</span>`).join('');
    root.appendChild(tags);

    const body = document.createElement('div');
    body.className = 'settings-body';
    body.id = 'settings-pages';
    root.appendChild(body);
    renderPage(body);

    const nav = document.createElement('div');
    nav.className = 'settings-nav';
    for (const c of CATEGORIES) {
      const item = document.createElement('div');
      item.className = `settings-nav-item ${c.id === page ? 'active' : ''}`;
      item.innerHTML = `<div class="nav-icon">${c.icon}</div><span>${c.name}</span>`;
      item.addEventListener('click', () => { page = c.id; render(); });
      nav.appendChild(item);
    }
    root.appendChild(nav);
  };

  const renderPage = (body) => {
    body.innerHTML = '';
    if (page === 'personalization') {
      body.innerHTML = `
        <div class="settings-grid">
          <div class="settings-card">
            <div class="settings-card-header"><div class="settings-card-icon">🎨</div><div class="settings-card-title">Accent color</div></div>
            <div class="settings-card-body">
              <input type="color" id="accent-color" value="${settings.get('accent')}" style="width:100%;height:28px;border:0;border-radius:6px" />
            </div>
          </div>
          <div class="settings-card">
            <div class="settings-card-header"><div class="settings-card-icon">🌓</div><div class="settings-card-title">Mode</div></div>
            <div class="settings-card-body">
              <select id="theme-mode" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(128,128,128,0.2);background:transparent">
                <option value="dark" ${settings.get('mode') === 'dark' ? 'selected' : ''}>Dark</option>
                <option value="light" ${settings.get('mode') === 'light' ? 'selected' : ''}>Light</option>
              </select>
            </div>
          </div>
          <div class="settings-card">
            <div class="settings-card-header"><div class="settings-card-icon">🫗</div><div class="settings-card-title">Aero blur</div></div>
            <div class="settings-card-body">
              <input type="range" id="aero-range" min="0" max="60" value="${settings.get('aero')}" style="width:100%" />
            </div>
          </div>
        </div>
        <div style="margin-top:16px;font-weight:600;margin-bottom:10px">Wallpapers</div>
        <div class="explorer-card-grid" id="wallpaper-grid"></div>
        <div style="margin-top:14px">
          <label style="font-size:12px">Custom image: <input type="file" id="custom-wallpaper" accept="image/*" /></label>
        </div>
      `;
      body.querySelector('#accent-color').addEventListener('input', e => { theme.setAccent(e.target.value); settings.set({ accent: e.target.value }); });
      body.querySelector('#theme-mode').addEventListener('change', e => { theme.setMode(e.target.value); settings.set({ mode: e.target.value }); });
      body.querySelector('#aero-range').addEventListener('input', e => { theme.setAero(parseInt(e.target.value, 10)); settings.set({ aero: parseInt(e.target.value, 10) }); });
      const grid = body.querySelector('#wallpaper-grid');
      for (const wp of WALLPAPERS) {
        const el = document.createElement('div');
        el.className = 'file-item';
        const thumb = wp.type === 'image'
          ? `<img src="${wp.src}" style="width:56px;height:40px;object-fit:cover;border-radius:6px" onerror="this.style.display='none'" />`
          : `<div style="width:56px;height:40px;border-radius:6px;background:linear-gradient(135deg,#0A84FF,#c53aff);display:grid;place-items:center;font-size:20px">🖼</div>`;
        el.innerHTML = `<div class="file-icon">${thumb}</div><div class="file-name">${wp.label}</div>`;
        el.addEventListener('click', () => { settings.setWallpaper(wp); notify.show({ title: 'Wallpaper changed', body: wp.label }); });
        grid.appendChild(el);
      }
      body.querySelector('#custom-wallpaper').addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        const url = URL.createObjectURL(f);
        settings.setWallpaper({ type: 'image', src: url });
      });
    } else if (page === 'accounts') {
      body.innerHTML = `
        <div class="settings-card" style="max-width:400px">
          <div class="settings-card-header"><div class="settings-card-icon">👤</div><div class="settings-card-title">User profile</div></div>
          <div class="settings-card-body" style="display:flex;flex-direction:column;gap:10px">
            <label>Username<input id="set-username" value="${settings.get('username')}" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(128,128,128,0.2);background:transparent;color:inherit" /></label>
            <label>Email<input id="set-email" value="${settings.get('email')}" style="width:100%;padding:6px;border-radius:6px;border:1px solid rgba(128,128,128,0.2);background:transparent;color:inherit" /></label>
            <button id="save-user" style="padding:8px 16px;border-radius:8px;background:var(--wn-primary);color:#fff">Save</button>
          </div>
        </div>
      `;
      body.querySelector('#save-user').addEventListener('click', () => {
        settings.set({ username: body.querySelector('#set-username').value, email: body.querySelector('#set-email').value });
        notify.show({ title: 'Profile saved', body: 'Your account info has been updated.' });
      });
    } else if (page === 'system') {
      body.innerHTML = `
        <div class="settings-grid">
          <div class="settings-card"><div class="settings-card-header"><div class="settings-card-icon">ℹ</div><div class="settings-card-title">About</div></div>
          <div class="settings-card-body">WindowsNext v1.0<br>Built with vanilla ES modules. No build step.</div></div>
          <div class="settings-card"><div class="settings-card-header"><div class="settings-card-icon">💾</div><div class="settings-card-title">Storage</div></div>
          <div class="settings-card-body">Virtual file system backed by IndexedDB with local folder mounting.</div></div>
        </div>
      `;
    } else {
      body.innerHTML = `<div class="settings-card"><div class="settings-card-title">${CATEGORIES.find(c => c.id === page)?.name}</div><div class="settings-card-body">Settings content placeholder.</div></div>`;
    }
  };

  render();
  return root;
}

export const SettingsApp = {
  id: 'settings',
  name: 'Settings',
  icon: 'settings',
  open(args = {}) {
    return { title: 'Settings', icon: 'settings', width: 860, height: 600 };
  },
  mount(ctx, win) {
    win.setContent(createSettings(ctx));
  },
};
