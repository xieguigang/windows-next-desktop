import { EventBus } from './core/event-bus.js';
import { WindowManager } from './core/window-manager.js';
import { ThemeManager } from './core/theme.js';
import { SettingsManager } from './core/settings.js';
import { NotifyManager } from './core/notify.js';
import { VFS } from './core/fs.js';

import { loadIconMap } from './ui/icons.js';

import { Desktop } from './shell/desktop.js';
import { Taskbar } from './shell/taskbar.js';
import { StartMenu } from './shell/start-menu.js';
import { LockScreen } from './shell/lock-screen.js';
import { Search } from './shell/search.js';

import { ExplorerApp } from './apps/explorer.js';
import { SettingsApp } from './apps/settings.js';
import { MusicApp } from './apps/music.js';
import { VideoApp } from './apps/video.js';
import { ImageViewerApp } from './apps/image-viewer.js';
import { NotepadApp } from './apps/notepad.js';

const APPS = {
  [ExplorerApp.id]: ExplorerApp,
  [SettingsApp.id]: SettingsApp,
  [MusicApp.id]: MusicApp,
  [VideoApp.id]: VideoApp,
  [ImageViewerApp.id]: ImageViewerApp,
  [NotepadApp.id]: NotepadApp,
};

async function boot() {
  const bus = new EventBus();
  const wm = new WindowManager(bus);
  const theme = new ThemeManager(bus);
  const settings = new SettingsManager(bus);
  const notify = new NotifyManager(bus);
  const fs = new VFS();
  await fs.ready;
  await fs.indexAssets('/assets');
  await loadIconMap();

  theme.apply({ accent: settings.get('accent'), mode: settings.get('mode'), aero: settings.get('aero'), saturation: settings.get('saturation') });

  const ctx = { bus, wm, theme, settings, notify, fs, apps: APPS };

  const desktop = new Desktop(wm, fs, settings, APPS);
  const taskbar = new Taskbar(wm, settings, APPS, bus);
  const startMenu = new StartMenu(wm, settings, APPS, bus);
  const lockScreen = new LockScreen(bus);
  const search = new Search(wm, fs, APPS, bus);

  // Wire taskbar center buttons to shell modules
  document.querySelectorAll('[data-action="start"]').forEach(b => b.addEventListener('click', () => startMenu.toggle()));
  document.querySelectorAll('[data-action="search"]').forEach(b => b.addEventListener('click', () => search.toggle()));

  // Power menu
  const powerMenu = document.getElementById('power-menu');
  powerMenu.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    const act = btn.dataset.action;
    if (act === 'lock') lockScreen.lock();
    else if (act === 'restart') { location.reload(); }
    else if (act === 'shutdown') {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#000;color:#fff;font-size:18px">It is now safe to turn off your browser.</div>';
    }
    powerMenu.classList.add('hidden');
  }));

  // File open dispatcher
  bus.on('file:open', async ({ path }) => {
    const blob = await fs.readFile(path);
    if (!blob) return notify.show({ title: 'File not found', body: path });
    const url = URL.createObjectURL(blob);
    const l = path.toLowerCase();
    if (/\.(png|jpg|jpeg|webp|gif)$/.test(l)) {
      const win = wm.open({ appId: 'image-viewer', ...ImageViewerApp.open() });
      ImageViewerApp.mount(ctx, win);
      setTimeout(() => {
        const img = win.bodyEl.querySelector('img');
        if (img) { img.src = url; img.style.display = 'block'; }
      }, 10);
    } else if (/\.(mp4|webm|mov)$/.test(l)) {
      const win = wm.open({ appId: 'video', ...VideoApp.open() });
      VideoApp.mount(ctx, win);
      setTimeout(() => { const v = win.bodyEl.querySelector('video'); if (v) v.src = url; }, 10);
    } else if (/\.(mp3|ogg|wav|flac)$/.test(l)) {
      const win = wm.open({ appId: 'music', ...MusicApp.open() });
      MusicApp.mount(ctx, win);
      setTimeout(() => {
        const root = win.bodyEl.firstElementChild;
        const audio = new Audio(url);
        root._audio = audio;
        const titleEl = root.querySelector('.music-title');
        const artistEl = root.querySelector('.music-artist');
        titleEl.textContent = path.split('/').pop().replace(/\.[^.]+$/, '');
        artistEl.textContent = 'VFS file';
        const bar = root.querySelector('.bar');
        const playBtn = root.querySelector('[data-act="play"]');
        audio.addEventListener('timeupdate', () => { if (audio.duration) bar.style.width = `${(audio.currentTime / audio.duration) * 100}%`; });
        audio.addEventListener('ended', () => { playBtn.textContent = '▶'; });
        playBtn.addEventListener('click', () => {
          if (audio.paused) { audio.play().catch(() => {}); playBtn.textContent = '⏸'; }
          else { audio.pause(); playBtn.textContent = '▶'; }
        });
      }, 10);
    } else {
      const text = typeof blob === 'string' ? blob : await blob.text();
      const win = wm.open({ appId: 'notepad', ...NotepadApp.open() });
      NotepadApp.mount(ctx, win);
      setTimeout(() => { const ta = win.bodyEl.querySelector('textarea'); if (ta) ta.value = text; }, 10);
    }
  });

  // App registration - window manager opens content via mount
  for (const app of Object.values(APPS)) {
    bus.on('app:open-' + app.id, (args) => {
      const win = wm.open({ appId: app.id, ...app.open(args) });
      app.mount(ctx, win);
    });
  }

  // Update window title on tab change
  bus.on('win:focused', ({ id }) => {
    // no-op handled by CSS active class
  });

  // Welcome toast
  setTimeout(() => {
    notify.show({ title: 'Welcome to WindowsNext', body: 'Click anywhere on the lock screen to enter.' });
  }, 800);

  window.WinNext = { bus, wm, fs, settings, theme, notify, apps: APPS, openApp: (id, args) => bus.emit('app:open-' + id, args) };
}

boot().catch(err => {
  console.error('Boot failed', err);
  document.body.innerHTML = `<pre style="padding:20px;color:red">Boot failed: ${err.message}\n${err.stack}</pre>`;
});
