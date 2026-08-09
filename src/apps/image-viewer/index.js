/**
 * 图片查看器
 *
 * 能力：
 * - 缩放（滚轮以指针为锚点 / 按钮 / 适应窗口 / 原始大小）
 * - 拖拽平移、左右旋转 90°、水平翻转
 * - 自动扫描同目录图片，支持上一张 / 下一张与底部缩略图条
 * - 顶部工具栏展示文件名、序号、原始尺寸与当前缩放比
 *
 * 性能考量：
 * - 变换用单个 transform 合成（GPU 层），不改 width/height，避免重排
 * - 缩略图 ObjectURL 懒加载：只为当前视口附近的若干张创建，
 *   否则上百张图片的目录会瞬间创建大量 blob 导致内存暴涨
 */

import * as P from '../../core/fs/path-utils.js';
import { getIcon } from '../../ui/icons.js';

/** 支持的图片扩展名（与 manifest 的 fileExtensions 保持一致） */
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'];

/** 缩放级别范围 */
const MIN_SCALE = 0.05;
const MAX_SCALE = 32;

/** 缩略图两侧各预加载的数量 */
const THUMB_PRELOAD_RADIUS = 8;

export default async function main(ctx) {
  ctx.injectStyleSheet(new URL('./image-viewer.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'iv-root';
  root.tabIndex = 0;
  root.innerHTML = `
    <div class="iv-toolbar">
      <span class="iv-name" title="">未打开图片</span>
      <span class="iv-index"></span>
      <span class="iv-spacer"></span>
      <span class="iv-dims"></span>
      <span class="iv-zoom-text">100%</span>
      <div class="iv-tools">
        <button class="iv-btn" data-act="zoom-out" title="缩小 (-)">${getIcon('zoomOut', 16)}</button>
        <button class="iv-btn" data-act="zoom-in" title="放大 (+)">${getIcon('zoomIn', 16)}</button>
        <button class="iv-btn" data-act="fit" title="适应窗口 (0)">${getIcon('fitScreen', 16)}</button>
        <button class="iv-btn" data-act="actual" title="原始大小 (1)">${getIcon('actualSize', 16)}</button>
        <span class="iv-sep"></span>
        <button class="iv-btn" data-act="rotate-left" title="向左旋转 (Shift+R)">${getIcon('rotateLeft', 16)}</button>
        <button class="iv-btn" data-act="rotate-right" title="向右旋转 (R)">${getIcon('rotateRight', 16)}</button>
        <button class="iv-btn" data-act="flip" title="水平翻转 (F)">${getIcon('flipHorizontal', 16)}</button>
        <span class="iv-sep"></span>
        <button class="iv-btn" data-act="open" title="打开图片">${getIcon('folderOpenSm', 16)}</button>
      </div>
    </div>

    <div class="iv-stage">
      <button class="iv-nav iv-prev" title="上一张 (←)">${getIcon('chevronLeft', 22)}</button>
      <img class="iv-image" alt="" draggable="false">
      <button class="iv-nav iv-next" title="下一张 (→)">${getIcon('chevronRight', 22)}</button>
      <div class="iv-placeholder">未打开任何图片</div>
    </div>

    <div class="iv-thumbs"></div>
  `;
  ctx.root.appendChild(root);

  const stageEl = root.querySelector('.iv-stage');
  const imgEl = root.querySelector('.iv-image');
  const thumbsEl = root.querySelector('.iv-thumbs');
  const nameEl = root.querySelector('.iv-name');
  const indexEl = root.querySelector('.iv-index');
  const dimsEl = root.querySelector('.iv-dims');
  const zoomTextEl = root.querySelector('.iv-zoom-text');
  const placeholderEl = root.querySelector('.iv-placeholder');

  /** 同目录下的图片路径列表 @type {string[]} */
  let files = [];
  /** 当前图片在 files 中的索引 */
  let index = -1;
  /** 已创建的缩略图 URL，key 为路径，dispose 时统一释放 */
  const thumbUrls = new Map();
  /** 当前大图的 ObjectURL */
  let currentUrl = '';

  /* ---------------- 视图变换状态 ---------------- */
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let rotation = 0;   // 0 / 90 / 180 / 270
  let flipped = false;
  /** 是否处于「适应窗口」模式：窗口 resize 时需要重新适配 */
  let fitMode = true;

  function applyTransform() {
    imgEl.style.transform =
      `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg) scale(${scale * (flipped ? -1 : 1)}, ${scale})`;
    zoomTextEl.textContent = `${Math.round(scale * 100)}%`;
  }

  /** 计算「适应窗口」的缩放比并居中 */
  function fitToWindow() {
    if (!imgEl.naturalWidth) return;
    const rect = stageEl.getBoundingClientRect();
    // 旋转 90/270 时宽高互换
    const rotated = rotation % 180 !== 0;
    const w = rotated ? imgEl.naturalHeight : imgEl.naturalWidth;
    const h = rotated ? imgEl.naturalWidth : imgEl.naturalHeight;
    const pad = 32;
    // 小图不放大，保持原始大小，避免糊化
    const next = Math.min((rect.width - pad) / w, (rect.height - pad) / h, 1);
    scale = Math.max(MIN_SCALE, next);
    offsetX = 0;
    offsetY = 0;
    fitMode = true;
    applyTransform();
  }

  function setActualSize() {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    fitMode = false;
    applyTransform();
  }

  /**
   * 以舞台中的某点为锚点缩放，保证该点在缩放前后位置不变。
   * @param {number} factor 缩放倍率
   * @param {number} [anchorX] 相对舞台中心的 x 偏移
   * @param {number} [anchorY] 相对舞台中心的 y 偏移
   */
  function zoomBy(factor, anchorX = 0, anchorY = 0) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    const ratio = next / scale;
    if (ratio === 1) return;
    // 锚点保持不动：新偏移 = 锚点 + (旧偏移 - 锚点) * ratio
    offsetX = anchorX + (offsetX - anchorX) * ratio;
    offsetY = anchorY + (offsetY - anchorY) * ratio;
    scale = next;
    fitMode = false;
    applyTransform();
  }

  /* ---------------- 加载图片 ---------------- */

  /**
   * 载入指定索引的图片
   * @param {number} i
   */
  async function loadIndex(i) {
    if (i < 0 || i >= files.length) return;
    index = i;
    const path = files[i];

    // 释放上一张的大图 URL，避免长时间浏览累积内存
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = '';
    }

    try {
      currentUrl = await ctx.fs.createObjectURL(path);
    } catch (err) {
      ctx.notify.error(`无法打开 ${P.basename(path)}：${err?.message || err}`);
      return;
    }

    // 重置变换
    rotation = 0;
    flipped = false;

    imgEl.src = currentUrl;
    imgEl.alt = P.basename(path);
    nameEl.textContent = P.basename(path);
    nameEl.title = path;
    indexEl.textContent = files.length > 1 ? `${i + 1} / ${files.length}` : '';
    placeholderEl.hidden = true;
    imgEl.hidden = false;

    ctx.window.setTitle(`${P.basename(path)} - 图片查看器`);
    updateNavButtons();
    renderThumbs();
  }

  imgEl.addEventListener('load', () => {
    dimsEl.textContent = `${imgEl.naturalWidth} × ${imgEl.naturalHeight}`;
    fitToWindow();
  });

  imgEl.addEventListener('error', () => {
    // SVG 等格式在极少数情况下会因沙箱策略拒绝以 blob 渲染
    dimsEl.textContent = '';
    imgEl.hidden = true;
    placeholderEl.hidden = false;
    placeholderEl.textContent = `无法显示 ${imgEl.alt || '该图片'}`;
  });

  function updateNavButtons() {
    const multi = files.length > 1;
    root.querySelector('.iv-prev').hidden = !multi;
    root.querySelector('.iv-next').hidden = !multi;
  }

  /**
   * 扫描同目录图片，建立翻页列表。
   * @param {string} filePath 当前打开的图片
   */
  async function scanSiblings(filePath) {
    const dir = P.dirname(filePath);
    try {
      const entries = await ctx.fs.readDir(dir);
      files = entries
        .filter((e) => e.type === 'file' && IMAGE_EXTS.includes(P.extname(e.name)))
        .map((e) => e.path)
        .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
    } catch {
      files = [filePath];
    }
    if (!files.includes(filePath)) files.unshift(filePath);
    return files.indexOf(filePath);
  }

  /* ---------------- 缩略图条 ---------------- */

  function renderThumbs() {
    if (files.length <= 1) {
      thumbsEl.hidden = true;
      thumbsEl.innerHTML = '';
      return;
    }
    thumbsEl.hidden = false;
    thumbsEl.innerHTML = '';

    files.forEach((path, i) => {
      const cell = document.createElement('button');
      cell.className = 'iv-thumb' + (i === index ? ' is-active' : '');
      cell.title = P.basename(path);
      cell.addEventListener('click', () => loadIndex(i));
      thumbsEl.appendChild(cell);

      // 只为当前位置附近的缩略图创建 ObjectURL，其余留占位
      if (Math.abs(i - index) <= THUMB_PRELOAD_RADIUS) {
        loadThumb(cell, path);
      } else {
        cell.classList.add('is-placeholder');
      }
    });

    // 让当前项滚动到可见区域
    thumbsEl.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  /**
   * 为缩略图单元格加载图片（带 URL 缓存）
   * @param {HTMLElement} cell
   * @param {string} path
   */
  async function loadThumb(cell, path) {
    try {
      let url = thumbUrls.get(path);
      if (!url) {
        url = await ctx.fs.createObjectURL(path);
        thumbUrls.set(path, url);
      }
      const im = document.createElement('img');
      im.src = url;
      im.alt = '';
      im.loading = 'lazy';
      cell.appendChild(im);
    } catch {
      cell.classList.add('is-placeholder');
    }
  }

  /* ---------------- 交互 ---------------- */

  // 滚轮缩放：以指针位置为锚点
  stageEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = stageEl.getBoundingClientRect();
    const anchorX = e.clientX - rect.left - rect.width / 2;
    const anchorY = e.clientY - rect.top - rect.height / 2;
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, anchorX, anchorY);
  }, { passive: false });

  // 拖拽平移
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  stageEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || imgEl.hidden) return;
    if (e.target.closest('.iv-nav')) return;
    dragging = true;
    dragStartX = e.clientX - offsetX;
    dragStartY = e.clientY - offsetY;
    stageEl.setPointerCapture(e.pointerId);
    stageEl.classList.add('is-grabbing');
  });

  stageEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    offsetX = e.clientX - dragStartX;
    offsetY = e.clientY - dragStartY;
    fitMode = false;
    applyTransform();
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    stageEl.releasePointerCapture?.(e.pointerId);
    stageEl.classList.remove('is-grabbing');
  };
  stageEl.addEventListener('pointerup', endDrag);
  stageEl.addEventListener('pointercancel', endDrag);

  // 双击：在「适应窗口」与「原始大小」之间切换
  stageEl.addEventListener('dblclick', () => {
    if (fitMode) setActualSize();
    else fitToWindow();
  });

  root.querySelector('.iv-prev').addEventListener('click', () => step(-1));
  root.querySelector('.iv-next').addEventListener('click', () => step(1));

  /** 翻页（循环） */
  function step(delta) {
    if (files.length <= 1) return;
    loadIndex((index + delta + files.length) % files.length);
  }

  // 工具栏
  root.querySelector('.iv-tools').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    switch (act) {
      case 'zoom-in': zoomBy(1.25); break;
      case 'zoom-out': zoomBy(1 / 1.25); break;
      case 'fit': fitToWindow(); break;
      case 'actual': setActualSize(); break;
      case 'rotate-left': rotation = (rotation + 270) % 360; fitMode ? fitToWindow() : applyTransform(); break;
      case 'rotate-right': rotation = (rotation + 90) % 360; fitMode ? fitToWindow() : applyTransform(); break;
      case 'flip': flipped = !flipped; applyTransform(); break;
      case 'open': openViaPicker(); break;
    }
  });

  async function openViaPicker() {
    const picked = await ctx.fs.pick({
      title: '打开图片',
      path: ctx.fs.folders.pictures,
      extensions: IMAGE_EXTS,
    });
    if (picked) await openFile(picked);
  }

  // 键盘快捷键
  root.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); step(-1); break;
      case 'ArrowRight': e.preventDefault(); step(1); break;
      case '+': case '=': e.preventDefault(); zoomBy(1.25); break;
      case '-': e.preventDefault(); zoomBy(1 / 1.25); break;
      case '0': e.preventDefault(); fitToWindow(); break;
      case '1': e.preventDefault(); setActualSize(); break;
      case 'f': case 'F': flipped = !flipped; applyTransform(); break;
      case 'r': case 'R':
        rotation = (rotation + (e.shiftKey ? 270 : 90)) % 360;
        fitMode ? fitToWindow() : applyTransform();
        break;
      default: break;
    }
  });

  // 窗口尺寸变化时，若处于适应窗口模式则重新适配
  ctx.observeResize(stageEl, () => {
    if (fitMode) fitToWindow();
  });

  /**
   * 打开指定图片文件（并扫描同目录建立翻页列表）
   * @param {string} filePath
   */
  async function openFile(filePath) {
    const i = await scanSiblings(filePath);
    await loadIndex(i >= 0 ? i : 0);
  }

  ctx.setPreviewProvider(() => (index >= 0 ? P.basename(files[index]) : '图片查看器'));

  // 大图与缩略图的 ObjectURL 均由 ctx.fs.createObjectURL 登记，
  // 窗口关闭时 SDK 会统一 revoke，这里只需清理引用。
  ctx.onDispose(() => thumbUrls.clear());

  // 启动：由文件关联打开，或展示空态
  if (ctx.args?.filePath) {
    await openFile(ctx.args.filePath);
  } else {
    placeholderEl.hidden = false;
    imgEl.hidden = true;
  }

  root.focus();
}
