/**
 * 进程管理
 *
 * 每个运行中的应用实例对应一个进程记录，任务管理器以此为数据源。
 * CPU / 内存为模拟值：基于应用类型的基线 + 随机游走，
 * 目的是让任务管理器呈现合理的动态曲线，而非声称真实测量。
 */

import bus from './event-bus.js';
import { createLogger } from './logger.js';

const log = createLogger('ProcessManager');

/** 不同应用类型的资源基线：[CPU 基线%, 内存基线 MB] */
const BASELINE = {
  browser: [4.2, 180],
  'media-player': [3.6, 145],
  calculator: [0.6, 42],
  explorer: [1.2, 68],
  terminal: [0.4, 28],
  notepad: [0.3, 34],
  'task-manager': [1.8, 52],
  settings: [0.8, 58],
  _default: [0.8, 45],
};

let pidSeq = 1000;

/**
 * @typedef {Object} ProcessInfo
 * @property {number} pid
 * @property {string} appId
 * @property {string} name
 * @property {string} icon
 * @property {number} startedAt
 * @property {string} windowId
 * @property {'running'|'suspended'} status
 * @property {number} cpu
 * @property {number} memory   MB
 * @property {number} disk     MB/s
 * @property {number} network  Mbps
 */

class ProcessManager {
  constructor() {
    /** @type {Map<number, ProcessInfo>} */
    this.processes = new Map();
    this._timer = null;
    this._subscribers = 0;
    /** 系统进程（始终存在，代表桌面外壳自身） */
    this._systemPid = ++pidSeq;
    this.processes.set(this._systemPid, {
      pid: this._systemPid,
      appId: '_shell',
      name: 'WindowsNext 桌面外壳',
      icon: 'monitor',
      startedAt: Date.now(),
      windowId: '',
      status: 'running',
      cpu: 1.4,
      memory: 96,
      disk: 0,
      network: 0,
      system: true,
    });
  }

  /**
   * 注册一个新进程
   * @param {{appId:string, name:string, icon:string, windowId:string}} info
   * @returns {ProcessInfo}
   */
  register(info) {
    const [cpu, mem] = BASELINE[info.appId] || BASELINE._default;
    const proc = {
      pid: ++pidSeq,
      appId: info.appId,
      name: info.name,
      icon: info.icon,
      startedAt: Date.now(),
      windowId: info.windowId,
      status: 'running',
      cpu: round1(cpu * (0.7 + Math.random() * 0.6)),
      memory: Math.round(mem * (0.85 + Math.random() * 0.35)),
      disk: 0,
      network: 0,
      _baseCpu: cpu,
      _baseMem: mem,
    };
    this.processes.set(proc.pid, proc);
    bus.emit('process:started', { process: proc });
    log.debug(`进程已启动 pid=${proc.pid} ${info.appId}`);
    return proc;
  }

  /** @param {number} pid */
  unregister(pid) {
    const proc = this.processes.get(pid);
    if (!proc) return;
    this.processes.delete(pid);
    bus.emit('process:ended', { process: proc });
    log.debug(`进程已结束 pid=${pid}`);
  }

  /** @param {string} windowId */
  getByWindowId(windowId) {
    for (const p of this.processes.values()) {
      if (p.windowId === windowId) return p;
    }
    return null;
  }

  /** @param {string} appId @returns {ProcessInfo[]} */
  getByAppId(appId) {
    return [...this.processes.values()].filter((p) => p.appId === appId);
  }

  /** @returns {ProcessInfo[]} */
  list() {
    return [...this.processes.values()];
  }

  /**
   * 结束进程（同时关闭其窗口）
   * @param {number} pid
   * @returns {boolean}
   */
  kill(pid) {
    const proc = this.processes.get(pid);
    if (!proc) return false;
    if (proc.system) {
      log.warn('系统进程不能被结束');
      return false;
    }
    bus.emit('process:kill-requested', { process: proc });
    return true;
  }

  /**
   * @param {number} pid
   * @param {'running'|'suspended'} status
   */
  setStatus(pid, status) {
    const p = this.processes.get(pid);
    if (p) p.status = status;
  }

  /**
   * 汇总系统资源占用
   * @returns {{cpu:number, memory:number, memoryTotal:number, processes:number}}
   */
  getSystemStats() {
    let cpu = 0;
    let memory = 0;
    for (const p of this.processes.values()) {
      cpu += p.cpu;
      memory += p.memory;
    }
    return {
      cpu: Math.min(100, round1(cpu)),
      memory: Math.round(memory),
      memoryTotal: 8192,
      processes: this.processes.size,
    };
  }

  /**
   * 开始资源采样。多个订阅者共享同一个定时器，
   * 全部取消订阅后自动停止，避免后台空转。
   * @param {(stats:{processes:ProcessInfo[], system:any}) => void} onTick
   * @param {number} [interval=1000]
   * @returns {() => void} 取消订阅
   */
  subscribe(onTick, interval = 1000) {
    this._subscribers++;
    const handler = (payload) => onTick(payload);
    const off = bus.on('process:tick', handler);
    if (!this._timer) this._startSampling(interval);
    return () => {
      off();
      this._subscribers = Math.max(0, this._subscribers - 1);
      if (this._subscribers === 0) this._stopSampling();
    };
  }

  _startSampling(interval) {
    this._timer = setInterval(() => {
      // 页面不可见时跳过采样，节省资源
      if (document.hidden) return;
      for (const p of this.processes.values()) {
        const baseCpu = p._baseCpu ?? p.cpu;
        const baseMem = p._baseMem ?? p.memory;
        // 随机游走并向基线回归，避免曲线无限漂移
        const cpuTarget = baseCpu * (p.status === 'suspended' ? 0.15 : 1);
        p.cpu = round1(clamp(p.cpu + (Math.random() - 0.5) * baseCpu * 0.9 + (cpuTarget - p.cpu) * 0.25, 0, 92));
        p.memory = Math.round(clamp(p.memory + (Math.random() - 0.5) * 6 + (baseMem - p.memory) * 0.15, 8, 4096));
        p.disk = round1(Math.max(0, p.disk + (Math.random() - 0.55) * 1.6));
        p.network = round1(Math.max(0, p.network + (Math.random() - 0.55) * 2.2));
      }
      bus.emit('process:tick', {
        processes: this.list(),
        system: this.getSystemStats(),
      });
    }, interval);
  }

  _stopSampling() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

export const processManager = new ProcessManager();
export default processManager;
