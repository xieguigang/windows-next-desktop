import { EventBus } from './event-bus.js';

/**
 * 主题管理器：维护 CSS 变量、Aero 强度、主题色、明暗模式
 */
export class ThemeManager {
  constructor(bus) {
    this.bus = bus;
    this.root = document.documentElement;
    this.state = {
      accent: '#0A84FF',
      mode: 'dark',
      aero: 18,
      saturation: 180,
    };
  }

  apply(patch = {}) {
    Object.assign(this.state, patch);
    const r = this.root.style;
    r.setProperty('--wn-theme-color', this.state.accent);
    r.setProperty('--wn-aero-strength', `${this.state.aero}px`);
    r.setProperty('--wn-saturation', `${this.state.saturation}%`);
    r.setProperty('--wn-mode', this.state.mode);

    if (this.state.mode === 'light') {
      r.setProperty('--wn-text-1', 'var(--wn-text-3)');
      r.setProperty('--wn-text-2', '#333336');
      r.setProperty('--wn-aero-light', 'rgba(255,255,255,0.55)');
      r.setProperty('--wn-aero-medium', 'rgba(255,255,255,0.42)');
      r.setProperty('--wn-aero-strong', 'rgba(255,255,255,0.72)');
      r.setProperty('--wn-aero-border', 'rgba(0,0,0,0.08)');
    } else {
      r.removeProperty('--wn-text-1');
      r.removeProperty('--wn-text-2');
      r.removeProperty('--wn-aero-light');
      r.removeProperty('--wn-aero-medium');
      r.removeProperty('--wn-aero-strong');
      r.removeProperty('--wn-aero-border');
    }
    this.bus?.emit('theme:changed', { ...this.state });
  }

  setAccent(color) { this.apply({ accent: color }); }
  setMode(mode) { this.apply({ mode }); }
  setAero(px) { this.apply({ aero: px }); }
}
