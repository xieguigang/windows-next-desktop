/**
 * 路径工具
 *
 * 全项目统一使用 `C:/dir/file.txt` 形式：
 *  - 盘符大写 + 冒号
 *  - 正斜杠分隔
 *  - 不以斜杠结尾（根目录除外，为 `C:/`）
 */

const DRIVE_RE = /^([a-zA-Z]):[/\\]?/;

/**
 * 规范化路径：统一分隔符、大写盘符、解析 `.` 与 `..`
 * @param {string} p
 * @returns {string}
 */
export function normalize(p) {
  if (!p) return 'C:/';
  let s = String(p).trim().replace(/\\/g, '/');

  const m = s.match(DRIVE_RE);
  let drive = 'C';
  if (m) {
    drive = m[1].toUpperCase();
    s = s.slice(m[0].length);
  } else {
    s = s.replace(/^\/+/, '');
  }

  const out = [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out.length ? `${drive}:/${out.join('/')}` : `${drive}:/`;
}

/**
 * 拼接路径片段
 * @param {...string} parts
 * @returns {string}
 */
export function join(...parts) {
  const filtered = parts.filter((p) => p !== undefined && p !== null && p !== '');
  if (!filtered.length) return 'C:/';
  return normalize(filtered.join('/'));
}

/**
 * 父目录
 * @param {string} p
 * @returns {string}
 */
export function dirname(p) {
  const n = normalize(p);
  if (isRoot(n)) return n;
  const idx = n.lastIndexOf('/');
  const head = n.slice(0, idx);
  // 'C:' → 'C:/'
  return head.endsWith(':') ? `${head}/` : head;
}

/**
 * 文件名（含扩展名）
 * @param {string} p
 * @returns {string}
 */
export function basename(p) {
  const n = normalize(p);
  if (isRoot(n)) return n;
  return n.slice(n.lastIndexOf('/') + 1);
}

/**
 * 扩展名（不含点，小写）
 * @param {string} p
 * @returns {string}
 */
export function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  if (i <= 0) return '';
  return b.slice(i + 1).toLowerCase();
}

/**
 * 去掉扩展名的文件名
 * @param {string} p
 */
export function stem(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? b : b.slice(0, i);
}

/**
 * 盘符（大写，不含冒号）
 * @param {string} p
 * @returns {string}
 */
export function driveOf(p) {
  const n = normalize(p);
  return n.slice(0, 1);
}

/**
 * 是否为盘根
 * @param {string} p
 */
export function isRoot(p) {
  const n = normalize(p);
  return /^[A-Z]:\/$/.test(n);
}

/**
 * 拆分为片段数组（不含盘符）
 * @param {string} p
 * @returns {string[]}
 */
export function segments(p) {
  const n = normalize(p);
  const body = n.slice(3); // 去掉 'C:/'
  return body ? body.split('/') : [];
}

/**
 * 面包屑：返回 [{name, path}]，首项为盘符
 * @param {string} p
 * @returns {{name:string, path:string}[]}
 */
export function breadcrumbs(p) {
  const n = normalize(p);
  const drive = driveOf(n);
  const out = [{ name: `${drive}:`, path: `${drive}:/` }];
  let cur = `${drive}:`;
  for (const seg of segments(n)) {
    cur += `/${seg}`;
    out.push({ name: seg, path: cur });
  }
  return out;
}

/**
 * child 是否在 parent 之下（含自身）
 * @param {string} parent
 * @param {string} child
 */
export function isSubPath(parent, child) {
  const a = normalize(parent);
  const b = normalize(child);
  if (a === b) return true;
  const prefix = a.endsWith('/') ? a : `${a}/`;
  return b.startsWith(prefix);
}

/**
 * 校验文件名合法性
 * @param {string} name
 * @returns {{ok:boolean, reason?:string}}
 */
export function validateName(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, reason: '名称不能为空' };
  if (n === '.' || n === '..') return { ok: false, reason: '名称无效' };
  if (/[/\\:*?"<>|]/.test(n)) return { ok: false, reason: '名称不能包含 \\ / : * ? " < > |' };
  if (n.length > 255) return { ok: false, reason: '名称过长' };
  return { ok: true };
}

/**
 * 在同目录下生成不重名的名称：`a.txt` → `a (2).txt`
 * @param {string} name
 * @param {Set<string>|string[]} existing
 * @returns {string}
 */
export function uniqueName(name, existing) {
  const set = existing instanceof Set ? existing : new Set(existing);
  if (!set.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!set.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/**
 * 人类可读的字节数
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * 格式化时间戳为 `2026/08/10 14:32`
 * @param {number} ts
 */
export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default {
  normalize, join, dirname, basename, extname, stem, driveOf,
  isRoot, segments, breadcrumbs, isSubPath, validateName, uniqueName,
  formatSize, formatDate,
};
