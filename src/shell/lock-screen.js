/**
 * 锁屏界面（Lock Screen）
 *
 * 复刻 Windows 11 锁屏视觉：当前壁纸作为背景，叠加半透明深色模糊蒙版。
 * 居中大号时间与日期、顶部天气胶囊、底部媒体控制胶囊。
 *
 * 触发：开始菜单电源菜单「锁定」项 -> bus.emit('lockscreen:lock')
 * 解锁：
 *   - 点击锁屏界面空白处
 *   - 按住鼠标左键向上滑动超过阈值（120px）
 * 解锁后淡出并恢复桌面交互，不影响壁纸播放。
 *
 * 本锁屏为无密码展示型，不验证身份。
 */

import bus from '../core/event-bus.js';
import { createLogger } from '../core/logger.js';
import { getIcon } from '../ui/icons.js';

const log = createLogger('LockScreen');

const DRAG_THRESHOLD = 120; // 上滑解锁阈值(px)

export class LockScreen {
  constructor() {
    /** @type {HTMLElement|null} */
    this.layer = null;
    /** @type {HTMLElement|null} */
    this.content = null;
    this._open = false;
    this._clockTimer = null;
    this._rafId = null;
    this._dragging = false;
    this._startY = 0;
    this._animating = false;

    // 上滑手势状态
    this._pointerId = null;
    this._dragDy = 0;

    // 媒体播放状态（仅可视化）
    this._playing = false;

    this._onLock = this._onLock.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  /** 订阅锁屏触发事件 */
  init() {
    bus.on('lockscreen:lock', this._onLock);
    log.debug('LockScreen initialized');
  }

  get isOpen() {
    return this._open;
  }

  _onLock() {
    this.show();
  }

  /** 显示锁屏 */
  show() {
    if (this._open) return;
    this._open = true;

    // 先关闭所有可能浮于锁屏之上的弹出层（开始菜单等）
    bus.emit('shell:close-popups', { source: 'lockscreen' });

    this.layer = document.getElementById('lock-screen-layer');
    if (!this.layer) {
      log.error('lock-screen-layer not found in DOM');
      return;
    }

    this._render();
    document.body.setAttribute('data-locked', 'true');
    this.layer.setAttribute('aria-hidden', 'false');

    // 触发淡入
    requestAnimationFrame(() => {
      this.layer.classList.add('is-visible');
    });

    this._startClock();
    this._bindGesture();

    log.debug('Lock screen shown');
  }

  /** 隐藏/解锁锁屏 */
  hide() {
    if (!this._open || !this.layer) return;
    this._open = false;

    this.layer.classList.add('is-unlocking');

    const finish = () => {
      if (this.layer) {
        this.layer.classList.remove('is-visible', 'is-unlocking', 'is-dragging');
        this.layer.setAttribute('aria-hidden', 'true');
        this.layer.innerHTML = '';
      }
      document.body.removeAttribute('data-locked');
      this._teardownGesture();
      this._stopClock();
      this._open = false;
      bus.emit('lockscreen:unlock');
      log.debug('Lock screen hidden');
    };

    // 等待退出动画结束
    const onEnd = (e) => {
      if (e.target === this.layer) {
        this.layer.removeEventListener('transitionend', onEnd);
        finish();
      }
    };
    this.layer.addEventListener('transitionend', onEnd);
    // 兜底：动画事件未触发时强制收尾
    setTimeout(() => {
      if (!this.layer || this.layer.getAttribute('aria-hidden') === 'true') return;
      finish();
    }, 320);
  }

  // ---------------- 渲染 ----------------

  _render() {
    const now = new Date();
    const time = this._formatTime(now);
    const date = this._formatDate(now);

    this.layer.innerHTML = `
      <div class="lock-screen-content">
        <div class="ls-weather" id="ls-weather">
          ${getIcon('weather', 26)}
          <span class="ls-weather-temp">多云 28°</span>
        </div>

        <div class="ls-clock" id="ls-clock">${time}</div>
        <div class="ls-date" id="ls-date">${date}</div>

        <div class="ls-media" id="ls-media">
          <span class="ls-media-logo">${getIcon('windows', 20, { bare: true })}</span>
          <button class="ls-media-btn" data-act="prev" title="上一首" aria-label="上一首">${getIcon('prev', 20, { bare: true })}</button>
          <button class="ls-media-btn" data-act="playpause" title="播放/暂停" aria-label="播放或暂停">${getIcon('pause', 20, { bare: true })}</button>
          <button class="ls-media-btn" data-act="next" title="下一首" aria-label="下一首">${getIcon('next', 20, { bare: true })}</button>
        </div>

        <div class="ls-hint">点击任意处或上滑解锁</div>
      </div>
    `;

    this.content = this.layer.querySelector('.lock-screen-content');

    // 媒体控制按钮：阻止冒泡，避免误触发解锁
    const media = this.layer.querySelector('#ls-media');
    media.addEventListener('pointerdown', (e) => e.stopPropagation());
    media.addEventListener('click', (e) => {
      const btn = e.target.closest('.ls-media-btn');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'playpause') {
        this._playing = !this._playing;
        btn.innerHTML = getIcon(this._playing ? 'pause' : 'play', 20, { bare: true });
      }
      // prev/next 仅视觉反馈（无真实播放器）
    });
  }

  // ---------------- 实时时钟 ----------------

  _startClock() {
    this._stopClock();
    const tick = () => {
      if (!this._open || !this.layer) return;
      const clock = this.layer.querySelector('#ls-clock');
      const dateEl = this.layer.querySelector('#ls-date');
      const now = new Date();
      if (clock) clock.textContent = this._formatTime(now);
      if (dateEl) dateEl.textContent = this._formatDate(now);
      // 对齐到下一分钟边界更新（与任务栏时钟一致，避免每秒重绘）
      this._clockTimer = setTimeout(tick, this._msToNextMinute(now));
    };
    const now = new Date();
    if (this.layer.querySelector('#ls-clock')) {
      this.layer.querySelector('#ls-clock').textContent = this._formatTime(now);
    }
    this._clockTimer = setTimeout(tick, this._msToNextMinute(now));
  }

  _stopClock() {
    if (this._clockTimer) {
      clearTimeout(this._clockTimer);
      this._clockTimer = null;
    }
  }

  _msToNextMinute(now) {
    return (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  }

  _formatTime(now) {
    return now.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  _formatDate(now) {
    // 2026年8月14日 星期五
    const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()];
    return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${wd}`;
  }

  // ---------------- 手势交互 ----------------

  _bindGesture() {
    this.layer.addEventListener('pointerdown', this._onPointerDown);
  }

  _teardownGesture() {
    if (!this.layer) return;
    this.layer.removeEventListener('pointerdown', this._onPointerDown);
    this.layer.removeEventListener('pointermove', this._onPointerMove);
    this.layer.removeEventListener('pointerup', this._onPointerUp);
    this.layer.removeEventListener('pointercancel', this._onPointerUp);
  }

  _onPointerDown(e) {
    // 仅响应左键 / 触摸 / 笔
    if (e.button !== undefined && e.button !== 0) return;

    // 若点击在媒体胶囊内部，交由媒体按钮逻辑处理，不解锁
    if (e.target.closest('#ls-media')) return;

    this._dragging = true;
    this._pointerId = e.pointerId;
    this._startY = e.clientY;
    this._dragDy = 0;

    this.layer.classList.add('is-dragging');
    this.layer.setPointerCapture?.(e.pointerId);
    this.layer.addEventListener('pointermove', this._onPointerMove);
    this.layer.addEventListener('pointerup', this._onPointerUp);
    this.layer.addEventListener('pointercancel', this._onPointerUp);

    // 若按下后未移动（视为点击空白），在 pointerup 时按位移判断解锁
  }

  _onPointerMove(e) {
    if (!this._dragging) return;
    const dy = this._startY - e.clientY; // 向上为正
    this._dragDy = dy;
    // 仅允许上滑（dy>0）产生位移反馈
    const offset = Math.max(0, dy);
    if (this.content) {
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = requestAnimationFrame(() => {
        this.content.style.transform = `translateY(${-offset}px)`;
        this.content.style.opacity = String(Math.max(0.2, 1 - offset / 400));
      });
    }
  }

  _onPointerUp(e) {
    if (!this._dragging) return;
    this._dragging = false;

    const dy = this._dragDy;
    this.layer.classList.remove('is-dragging');
    this.layer.releasePointerCapture?.(this._pointerId);
    this.layer.removeEventListener('pointermove', this._onPointerMove);
    this.layer.removeEventListener('pointerup', this._onPointerUp);
    this.layer.removeEventListener('pointercancel', this._onPointerUp);

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (dy >= DRAG_THRESHOLD) {
      // 上滑达标 -> 解锁
      this.hide();
    } else if (dy > 6) {
      // 上滑未达标 -> 回弹归位
      this._rebound();
    } else {
      // 视为点击空白处 -> 解锁
      this.hide();
    }
  }

  _rebound() {
    if (!this.content) return;
    this.content.classList.add('is-rebounding');
    this.content.style.transform = 'translateY(0)';
    this.content.style.opacity = '1';
    const onEnd = (ev) => {
      if (ev.propertyName === 'transform') {
        this.content.classList.remove('is-rebounding');
        this.content.removeEventListener('transitionend', onEnd);
      }
    };
    this.content.addEventListener('transitionend', onEnd);
  }
}

export const lockScreen = new LockScreen();
