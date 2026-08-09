/**
 * 分级日志
 *
 * 级别受设置项 `system.logLevel` 控制，默认 warn，避免控制台刷屏。
 * 用法：`const log = createLogger('WindowManager'); log.info('...')`
 */

export const LOG_LEVELS = /** @type {const} */ (['debug', 'info', 'warn', 'error', 'silent']);

const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const LEVEL_STYLE = {
  debug: 'color:#8A8A8A',
  info: 'color:#0078D4',
  warn: 'color:#9D5D00',
  error: 'color:#C42B1C;font-weight:600',
};

let currentLevel = 'warn';

/**
 * 设置全局日志级别
 * @param {'debug'|'info'|'warn'|'error'|'silent'} level
 */
export function setLogLevel(level) {
  if (LEVEL_WEIGHT[level] === undefined) {
    console.warn(`[Logger] 未知日志级别 "${level}"，已忽略`);
    return;
  }
  currentLevel = level;
}

/** @returns {string} 当前日志级别 */
export function getLogLevel() {
  return currentLevel;
}

function timestamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * 创建带模块名前缀的日志器
 * @param {string} moduleName
 */
export function createLogger(moduleName) {
  const emit = (level, consoleFn, args) => {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel]) return;
    consoleFn(
      `%c${timestamp()} %c[${moduleName}]`,
      'color:#A0A0A0',
      LEVEL_STYLE[level],
      ...args
    );
  };

  return {
    debug: (...a) => emit('debug', console.debug, a),
    info: (...a) => emit('info', console.info, a),
    warn: (...a) => emit('warn', console.warn, a),
    error: (...a) => emit('error', console.error, a),
    /** 计时辅助，仅在 debug 级生效 */
    time: (label) => {
      if (LEVEL_WEIGHT.debug < LEVEL_WEIGHT[currentLevel]) return () => {};
      const t0 = performance.now();
      return () => emit('debug', console.debug, [`${label} 耗时 ${(performance.now() - t0).toFixed(1)}ms`]);
    },
  };
}

export default createLogger;
