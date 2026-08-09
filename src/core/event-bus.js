/**
 * 轻量事件总线
 *
 * 所有跨模块通信统一走总线，避免模块间直接 import 实例造成循环依赖。
 * 支持精确订阅与 `前缀:*` 通配订阅。
 */

/** @typedef {(payload: any, event: string) => void} BusHandler */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<BusHandler>>} */
    this._handlers = new Map();
    /** @type {Map<string, Set<BusHandler>>} 通配订阅，key 为不含 `*` 的前缀 */
    this._wildcards = new Map();
  }

  /**
   * 订阅事件
   * @param {string} event 事件名，支持 `ns:*` 形式的前缀通配
   * @param {BusHandler} handler
   * @returns {() => void} 取消订阅函数
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('EventBus.on: handler 必须是函数');
    }
    const target = event.endsWith('*') ? this._wildcards : this._handlers;
    const key = event.endsWith('*') ? event.slice(0, -1) : event;
    let set = target.get(key);
    if (!set) {
      set = new Set();
      target.set(key, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  /**
   * 订阅一次后自动解绑
   * @param {string} event
   * @param {BusHandler} handler
   * @returns {() => void}
   */
  once(event, handler) {
    const wrapped = (payload, name) => {
      off();
      handler(payload, name);
    };
    const off = this.on(event, wrapped);
    return off;
  }

  /**
   * 取消订阅
   * @param {string} event
   * @param {BusHandler} [handler] 省略时清空该事件的全部订阅
   */
  off(event, handler) {
    const target = event.endsWith('*') ? this._wildcards : this._handlers;
    const key = event.endsWith('*') ? event.slice(0, -1) : event;
    const set = target.get(key);
    if (!set) return;
    if (handler) {
      set.delete(handler);
      if (set.size === 0) target.delete(key);
    } else {
      target.delete(key);
    }
  }

  /**
   * 派发事件。回调异常被隔离，不影响其他订阅者。
   * @param {string} event
   * @param {any} [payload]
   */
  emit(event, payload) {
    const exact = this._handlers.get(event);
    if (exact && exact.size) {
      // 复制迭代，允许回调内部增删订阅
      for (const fn of Array.from(exact)) {
        this._invoke(fn, payload, event);
      }
    }
    if (this._wildcards.size) {
      for (const [prefix, set] of this._wildcards) {
        if (!event.startsWith(prefix)) continue;
        for (const fn of Array.from(set)) {
          this._invoke(fn, payload, event);
        }
      }
    }
  }

  /**
   * @param {BusHandler} fn
   * @param {any} payload
   * @param {string} event
   */
  _invoke(fn, payload, event) {
    try {
      fn(payload, event);
    } catch (err) {
      console.error(`[EventBus] 处理 "${event}" 时发生异常:`, err);
    }
  }

  /** 返回某事件当前订阅者数量（含通配） */
  listenerCount(event) {
    let n = this._handlers.get(event)?.size ?? 0;
    for (const [prefix, set] of this._wildcards) {
      if (event.startsWith(prefix)) n += set.size;
    }
    return n;
  }

  /** 清空全部订阅 */
  clear() {
    this._handlers.clear();
    this._wildcards.clear();
  }
}

/** 全局单例总线 */
export const bus = new EventBus();
export default bus;
