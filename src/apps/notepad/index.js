/**
 * 记事本
 *
 * textarea 编辑器，支持：
 *   新建 / 打开 / 保存 / 另存为（走 VFS 文件对话框）
 *   关闭未保存时拦截并提示
 *   自动换行开关
 *   查找替换（Ctrl+H）
 *   状态栏：行列号、字符数、选中字符数、编码
 *   任务栏缩略图预览：返回首行文本
 */

import * as P from '../../core/fs/path-utils.js';

const ENCODINGS = ['utf-8', 'utf-16le', 'gb18030', 'iso-8859-1'];

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./notepad.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'np-root';
  root.innerHTML = `
    <div class="np-toolbar">
      <div class="np-file">
        <button class="btn" data-action="new" title="新建 (Ctrl+N)">新建</button>
        <button class="btn" data-action="open" title="打开 (Ctrl+O)">打开</button>
        <button class="btn" data-action="save" title="保存 (Ctrl+S)">保存</button>
        <button class="btn" data-action="save-as" title="另存为">另存为</button>
      </div>
      <div class="np-edit">
        <button class="btn" data-action="find" title="查找 (Ctrl+F)">查找</button>
        <button class="btn" data-action="replace" title="替换 (Ctrl+H)">替换</button>
      </div>
      <div class="np-view">
        <label class="np-check"><input type="checkbox" data-action="wrap" checked> 自动换行</label>
        <label class="np-zoom">字号<input type="number" min="10" max="32" value="14" data-action="font-size">px</label>
        <label class="np-zoom">编码<select data-action="encoding">${ENCODINGS.map((e) => `<option>${e}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="np-finder" hidden>
      <div class="np-find-row">
        <input class="np-find" placeholder="查找" aria-label="查找">
        <button class="btn" data-action="find-next" title="下一个 (Enter)">下一个</button>
        <button class="btn" data-action="find-prev" title="上一个 (Shift+Enter)">上一个</button>
        <label class="np-check"><input type="checkbox" data-action="match-case"> 区分大小写</label>
        <button class="btn np-find-close" data-action="find-close" title="关闭 (Esc)">×</button>
      </div>
      <div class="np-find-row">
        <input class="np-replace" placeholder="替换为" aria-label="替换为">
        <button class="btn" data-action="replace-one">替换</button>
        <button class="btn" data-action="replace-all">全部替换</button>
      </div>
    </div>
    <textarea class="np-textarea" spellcheck="false" aria-label="编辑器"></textarea>
    <div class="np-status">
      <span class="np-pos">第 1 行，第 1 列</span>
      <span class="np-len">0 字符</span>
      <span class="np-sel"></span>
      <span class="np-enc">UTF-8</span>
      <span class="np-state">未保存</span>
    </div>`;

  ctx.root.appendChild(root);

  const textarea = root.querySelector('.np-textarea');
  const stateLabel = root.querySelector('.np-state');
  const posLabel = root.querySelector('.np-pos');
  const lenLabel = root.querySelector('.np-len');
  const selLabel = root.querySelector('.np-sel');
  const encLabel = root.querySelector('.np-enc');
  const finder = root.querySelector('.np-finder');
  const findInput = root.querySelector('.np-find');
  const replaceInput = root.querySelector('.np-replace');

  let filePath = ctx.args?.filePath || null;
  let encoding = ENCODINGS[0];
  let dirty = false;
  let fontSize = ctx.settings.getLocal('fontSize', 14);
  textarea.style.fontSize = `${fontSize}px`;

  // 初始内容
  if (filePath) await openFile(filePath);
  else {
    textarea.value = '';
    syncTitle();
  }

  // ── 工具栏 ────────────────────────────────────────────
  root.querySelector('.np-file').addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    if (action === 'new') await newFile();
    else if (action === 'open') await pickAndOpen();
    else if (action === 'save') await saveFile();
    else if (action === 'save-as') await saveFileAs();
  });
  root.querySelector('.np-edit').addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (action === 'find') showFinder(false);
    else if (action === 'replace') showFinder(true);
  });
  root.querySelector('.np-view').addEventListener('change', (e) => {
    const a = e.target.dataset.action;
    if (a === 'wrap') textarea.style.whiteSpace = e.target.checked ? 'pre-wrap' : 'pre';
    else if (a === 'font-size') {
      fontSize = Math.min(32, Math.max(10, Number(e.target.value) || 14));
      textarea.style.fontSize = `${fontSize}px`;
      ctx.settings.setLocal('fontSize', fontSize);
    } else if (a === 'encoding') {
      encoding = e.target.value;
      encLabel.textContent = encoding.toUpperCase();
    }
  });
  root.querySelector('.np-finder').addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (action === 'find-close') finder.hidden = true;
    else if (action === 'find-next') findNext(+1);
    else if (action === 'find-prev') findNext(-1);
    else if (action === 'replace-one') replaceOne();
    else if (action === 'replace-all') replaceAll();
  });
  root.querySelector('[data-action="font-size"]').value = fontSize;

  // ── 编辑事件 ─────────────────────────────────────────
  textarea.addEventListener('input', () => {
    if (!dirty) {
      dirty = true;
      stateLabel.textContent = '未保存';
      syncTitle();
    }
    updatePos();
  });
  textarea.addEventListener('keyup', updatePos);
  textarea.addEventListener('click', updatePos);
  textarea.addEventListener('select', updatePos);

  function updatePos() {
    const { value, selectionStart } = textarea;
    let line = 1, col = 1;
    for (let i = 0; i < selectionStart; i++) if (value[i] === '\n') { line++; col = 1; } else col++;
    posLabel.textContent = `第 ${line} 行，第 ${col} 列`;
    lenLabel.textContent = `${value.length} 字符`;
    if (selectionStart !== textarea.selectionEnd) {
      selLabel.textContent = `已选 ${textarea.selectionEnd - selectionStart} 字符`;
    } else {
      selLabel.textContent = '';
    }
  }

  function syncTitle() {
    const name = filePath ? P.basename(filePath) : '无标题';
    const mark = dirty ? ' ●' : '';
    ctx.window.setTitle(`${name}${mark}`);
  }

  // ── 文件操作 ─────────────────────────────────────────
  async function newFile() {
    if (!(await confirmDiscardIfDirty())) return;
    textarea.value = '';
    filePath = null;
    dirty = false;
    stateLabel.textContent = '已保存';
    syncTitle();
    updatePos();
  }

  async function pickAndOpen() {
    if (!(await confirmDiscardIfDirty())) return;
    const res = await ctx.fs.pick({ mode: 'open', accept: 'text/*' });
    if (res?.path) await openFile(res.path);
  }

  async function openFile(path) {
    try {
      const data = await ctx.fs.readFile(path, encoding);
      const text = typeof data === 'string' ? data : new TextDecoder(encoding).decode(data);
      textarea.value = text;
      filePath = path;
      dirty = false;
      stateLabel.textContent = '已保存';
      syncTitle();
      updatePos();
      ctx.notify.info(`已打开 ${P.basename(path)}`, '记事本');
    } catch (err) {
      ctx.notify.error('打开失败：' + (err?.message || err));
    }
  }

  async function saveFile() {
    if (!filePath) return saveFileAs();
    try {
      await ctx.fs.writeFile(filePath, textarea.value);
      dirty = false;
      stateLabel.textContent = '已保存';
      syncTitle();
      ctx.notify.success(`已保存到 ${P.basename(filePath)}`);
    } catch (err) {
      ctx.notify.error('保存失败：' + (err?.message || err));
    }
  }

  async function saveFileAs() {
    const dir = filePath ? P.dirname(filePath) : ctx.fs.folders.documents;
    const name = filePath ? P.basename(filePath) : '未命名.txt';
    const res = await ctx.fs.pickSave({ defaultPath: P.join(dir, name) });
    if (!res?.path) return;
    filePath = res.path;
    await saveFile();
  }

  async function confirmDiscardIfDirty() {
    if (!dirty) return true;
    const ok = await ctx.dialog.confirm(
      '当前文件有未保存的修改，确定放弃吗？',
      '放弃修改',
      { okLabel: '放弃' },
    );
    return ok;
  }

  // ── 查找替换 ─────────────────────────────────────────
  function showFinder(replace) {
    finder.hidden = false;
    (replace ? replaceInput : findInput).focus();
    if (textarea.selectionStart !== textarea.selectionEnd) {
      findInput.value = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    }
  }

  function findNext(direction) {
    const q = findInput.value;
    if (!q) return;
    const caseSensitive = finder.querySelector('[data-action="match-case"]').checked;
    const haystack = caseSensitive ? textarea.value : textarea.value.toLowerCase();
    const needle = caseSensitive ? q : q.toLowerCase();
    let from = textarea.selectionEnd;
    let idx = haystack.indexOf(needle, from);
    if (idx < 0 || direction < 0) idx = haystack.lastIndexOf(needle, from - 1);
    if (idx < 0) {
      ctx.notify.warning('未找到匹配内容');
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(idx, idx + q.length);
  }

  function replaceOne() {
    if (!findInput.value) return;
    if (textarea.selectionStart === textarea.selectionEnd) return findNext(+1);
    const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
    if (selected === findInput.value) {
      const before = textarea.value.slice(0, textarea.selectionStart);
      const after = textarea.value.slice(textarea.selectionEnd);
      textarea.value = before + replaceInput.value + after;
      textarea.dispatchEvent(new Event('input'));
    }
    findNext(+1);
  }

  function replaceAll() {
    if (!findInput.value) return;
    const caseSensitive = finder.querySelector('[data-action="match-case"]').checked;
    const flags = caseSensitive ? 'g' : 'gi';
    const re = new RegExp(findInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const before = textarea.value;
    const after = before.replace(re, replaceInput.value);
    if (after === before) return ctx.notify.warning('未找到匹配内容');
    textarea.value = after;
    textarea.dispatchEvent(new Event('input'));
    ctx.notify.success(`已替换 ${before.length - after.length ? before.split(re).length - 1 : 0} 处`);
  }

  // ── 快捷键 ─────────────────────────────────────────
  textarea.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
    else if (e.ctrlKey && e.shiftKey && e.key === 'S') { e.preventDefault(); saveFileAs(); }
    else if (e.ctrlKey && e.key === 'o') { e.preventDefault(); pickAndOpen(); }
    else if (e.ctrlKey && e.key === 'n') { e.preventDefault(); newFile(); }
    else if (e.ctrlKey && e.key === 'f') { e.preventDefault(); showFinder(false); }
    else if (e.ctrlKey && e.key === 'h') { e.preventDefault(); showFinder(true); }
    else if (e.key === 'Escape' && !finder.hidden) { finder.hidden = true; }
    else if (e.key === 'Enter' && document.activeElement === findInput) { e.preventDefault(); findNext(+1); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart, end = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, start) + '  ' + textarea.value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      textarea.dispatchEvent(new Event('input'));
    }
  });

  // ── 关闭拦截 ─────────────────────────────────────────
  ctx.window.onBeforeClose(async () => {
    if (!dirty) return true;
    return await ctx.dialog.confirm(
      `「${P.basename(filePath || '未标题')}」有未保存的修改，是否保存？`,
      '保存修改',
      { okLabel: '保存' },
    ).then(async (wantSave) => {
      if (!wantSave) return true;
      await saveFile();
      return !dirty;
    });
  });

  // ── 预览 ─────────────────────────────────────────
  ctx.setPreviewProvider(() => {
    const first = textarea.value.split('\n')[0].slice(0, 80);
    return first || (filePath ? P.basename(filePath) : '空文档');
  });

  updatePos();
}