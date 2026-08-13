/**
 * 设置状态持久化与广播
 */
const STORAGE_KEY = 'wn-settings-v1';

const DEFAULTS = {
  username: 'User',
  email: 'user@windowsnext.local',
  accent: '#0A84FF',
  mode: 'dark',
  aero: 18,
  saturation: 180,
  wallpaper: { type: 'image', src: '/assets/wallpapers/windows-11-orange-pm.jpg' },
  pins: ['explorer', 'settings', 'notepad'],
  desktopIcons: ['explorer', 'settings', 'notepad', 'music', 'video', 'image-viewer'],
};

export class SettingsManager {
  constructor(bus) {
    this.bus = bus;
    this.state = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
    return { ...DEFAULTS };
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) { /* ignore */ }
  }

  get(key) {
    return key ? this.state[key] : { ...this.state };
  }

  set(patch) {
    Object.assign(this.state, patch);
    this._save();
    this.bus.emit('settings:changed', { ...this.state });
  }

  setWallpaper(wallpaper) {
    this.set({ wallpaper });
  }
}
