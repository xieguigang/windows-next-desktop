/**
 * 锁屏：单击解锁，提供 lock 方法
 */
export class LockScreen {
  constructor(bus) {
    this.bus = bus;
    this.el = document.getElementById('lock-screen');
    this.timeEl = document.getElementById('lock-time');
    this.dateEl = document.getElementById('lock-date');
    this.locked = true;

    this._tick();
    setInterval(() => this._tick(), 1000);

    this.el.addEventListener('click', () => {
      if (!this.locked) return;
      this.unlock();
    });
  }

  _tick() {
    const now = new Date();
    if (this.timeEl) this.timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (this.dateEl) this.dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  unlock() {
    this.locked = false;
    this.el.classList.add('hidden');
    this.bus.emit('lock:unlocked', {});
  }

  lock() {
    this.locked = true;
    this.el.classList.remove('hidden');
    this._tick();
  }
}
