/**
 * 全局事件总线 - 轻量发布订阅
 */
export class EventBus {
  constructor() {
    this._events = new Map();
  }
  on(event, handler) {
    if (!this._events.has(event)) this._events.set(event, new Set());
    this._events.get(event).add(handler);
    return () => this.off(event, handler);
  }
  off(event, handler) {
    this._events.get(event)?.delete(handler);
  }
  emit(event, data) {
    this._events.get(event)?.forEach(h => {
      try { h(data); } catch (e) { console.error(`[EventBus] ${event}`, e); }
    });
  }
  once(event, handler) {
    const wrap = (data) => {
      this.off(event, wrap);
      handler(data);
    };
    this.on(event, wrap);
  }
}
