/**
 * 终端环境变量
 *
 * 模拟 bash 的环境变量系统，支持设置、获取、展开和变量替换。
 */

class EnvStore {
  constructor() {
    /** @type {Map<string, string>} */
    this._vars = new Map();
  }

  /**
   * 设置环境变量
   * @param {string} key
   * @param {string} value
   */
  set(key, value) {
    this._vars.set(key.toUpperCase(), String(value));
  }

  /**
   * 获取环境变量
   * @param {string} key
   * @returns {string|undefined}
   */
  get(key) {
    return this._vars.get(key.toUpperCase());
  }

  /**
   * 删除环境变量
   * @param {string} key
   */
  unset(key) {
    this._vars.delete(key.toUpperCase());
  }

  /**
   * 获取所有环境变量
   * @returns {Map<string, string>}
   */
  getAll() {
    return new Map([...this._vars.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }

  /**
   * 展开字符串中的环境变量 ($VAR, ${VAR})
   * @param {string} str
   * @returns {string}
   */
  expand(str) {
    return str.replace(/\$\{?(\w+)\}?/g, (match, name) => {
      const val = this._vars.get(name.toUpperCase());
      return val !== undefined ? val : match;
    });
  }
}

export const env = new EnvStore();
export default env;
