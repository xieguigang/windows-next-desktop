const STACK_LIMIT = 5;
const DEFAULT_DURATION = 5000;

/**
 * Toast 通知队列，样式参考 Toast-Message.jpg 右下角
 */
export class NotifyManager {
  constructor(bus) {
    this.bus = bus;
    this.container = document.getElementById('toast-container');
    this.queue = [];
  }

  show({ title, body, app = 'WindowsNext', icon = null, duration = DEFAULT_DURATION }) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <div class="toast-header">
        <div class="toast-app">${icon ? `<span>${icon}</span>` : ''}<span>${app}</span></div>
      </div>
      <div class="toast-title">${title}</div>
      ${body ? `<div class="toast-body">${body}</div>` : ''}
    `;
    this.container.appendChild(toast);
    this.queue.push(toast);
    while (this.queue.length > STACK_LIMIT) {
      this._remove(this.queue[0]);
    }
    const timer = duration > 0 ? setTimeout(() => this._remove(toast), duration) : null;
    toast.addEventListener('pointerenter', () => timer && clearTimeout(timer));
    toast.addEventListener('pointerleave', () => duration > 0 && setTimeout(() => this._remove(toast), duration));
    toast.addEventListener('click', () => this._remove(toast));
  }

  _remove(toast) {
    if (!toast.isConnected) return;
    toast.classList.add('out');
    toast.addEventListener('animationend', () => {
      toast.remove();
      this.queue = this.queue.filter(t => t !== toast);
    });
  }
}
