/**
 * 通知中心
 *
 * 提供：
 *  - Toast 队列（自动消失 / 手动关闭 / 数量上限）
 *  - Promise 化的系统对话框：alert / confirm / prompt
 *  - 文件选择 / 保存对话框（基于统一文件系统）
 */

import bus from './event-bus.js';
import settings from './settings-store.js';
import { getIcon, iconForExtension } from '../ui/icons.js';
import fileSystem, { SHELL_FOLDERS } from './fs/fs-service.js';
import * as P from './fs/path-utils.js';

const MAX_TOASTS = 4;

class NotificationCenter {
  constructor() {
    /** @type {HTMLElement|null} */
    this.stack = null;
    /** @type {HTMLElement|null} */
    this.layer = null;
    /** @type {Array<{id:number,title:string,body:string,type:string,time:number}>} */
    this.history = [];
    this._seq = 0;
  }

  /** @param {HTMLElement} layer */
  init(layer) {
    this.layer = layer;
    this.stack = document.createElement('div');
    this.stack.className = 'toast-stack';
    layer.appendChild(this.stack);
  }

  /* ==========================================================
     Toast
     ========================================================== */

  /**
   * @param {string|{title?:string, body?:string, type?:string, duration?:number, icon?:string, onClick?:Function}} opts
   * @param {string} [type]
   * @returns {number} toast id
   */
  toast(opts, type) {
    const o = typeof opts === 'string' ? { body: opts, type: type || 'info' } : { ...opts };
    o.type = o.type || 'info';
    o.duration = o.duration ?? (o.type === 'error' ? 6000 : 4000);

    const id = ++this._seq;
    this.history.unshift({ id, title: o.title || '', body: o.body || '', type: o.type, time: Date.now() });
    if (this.history.length > 50) this.history.length = 50;
    bus.emit('notification:added', { id, ...o });

    if (!settings.get('system.notifications') || !this.stack) return id;

    // 超出上限时先移除最旧的（只对非 is-leaving 的元素操作，防止无限循环）
    let iter = 0;
    const maxIter = MAX_TOASTS + 1;
    while (this.stack.children.length >= MAX_TOASTS && iter < maxIter) {
      iter++;
      const first = this.stack.firstElementChild;
      if (first && !first.classList.contains('is-leaving')) {
        this._dismiss(first);
      } else {
        break; // 第一个元素已在退出动画中，等待 animationend 自然移除
      }
    }

    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.type = o.type;
    el.dataset.id = String(id);
    el.setAttribute('role', 'status');

    const iconName = o.icon || { success: 'check', warning: 'warning', error: 'error', info: 'info' }[o.type] || 'info';
    el.innerHTML = `
      <span class="toast-icon">${getIcon(iconName, 18)}</span>
      <div class="toast-main">
        ${o.title ? `<div class="toast-title"></div>` : ''}
        <div class="toast-body"></div>
      </div>
      <button class="toast-close" type="button" aria-label="关闭">${getIcon('close', 12)}</button>
    `;
    if (o.title) el.querySelector('.toast-title').textContent = o.title;
    el.querySelector('.toast-body').textContent = o.body || '';

    el.querySelector('.toast-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this._dismiss(el);
    });

    if (typeof o.onClick === 'function') {
      el.style.cursor = 'default';
      el.addEventListener('click', () => {
        try { o.onClick(); } catch { /* 忽略回调异常 */ }
        this._dismiss(el);
      });
    }

    // 悬停暂停自动关闭
    let timer = null;
    const startTimer = () => {
      if (o.duration <= 0) return;
      timer = setTimeout(() => this._dismiss(el), o.duration);
    };
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', startTimer);

    this.stack.appendChild(el);
    startTimer();
    return id;
  }

  /** @param {Element|null} el */
  _dismiss(el) {
    if (!el || el.classList.contains('is-leaving')) return;
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 260);
  }

  /** 关闭全部 Toast */
  clearToasts() {
    if (!this.stack) return;
    [...this.stack.children].forEach((el) => this._dismiss(el));
  }

  /* ==========================================================
     模态对话框
     ========================================================== */

  /**
   * 通用模态框
   * @param {{title:string, render:(body:HTMLElement)=>void, buttons:Array<{label:string,value:any,primary?:boolean}>, className?:string, defaultValue?:any, onOpen?:(root:HTMLElement)=>void}} cfg
   * @returns {Promise<any>}
   */
  _modal(cfg) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'dialog-backdrop';

      const dialog = document.createElement('div');
      dialog.className = `dialog ${cfg.className || ''}`.trim();
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      const head = document.createElement('div');
      head.className = 'dialog-head';
      head.textContent = cfg.title || '';

      const body = document.createElement('div');
      body.className = 'dialog-body';
      cfg.render?.(body);

      const foot = document.createElement('div');
      foot.className = 'dialog-foot';

      let settled = false;
      const close = (value) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(value);
      };
      dialog._close = close;

      for (const b of cfg.buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        if (b.primary) btn.classList.add('is-primary');
        btn.addEventListener('click', () => close(typeof b.value === 'function' ? b.value(dialog) : b.value));
        foot.appendChild(btn);
      }

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(cfg.escapeValue !== undefined ? cfg.escapeValue : null);
        } else if (e.key === 'Enter' && !e.shiftKey) {
          const primary = cfg.buttons.find((b) => b.primary);
          if (primary && !(e.target instanceof HTMLTextAreaElement)) {
            e.preventDefault();
            close(typeof primary.value === 'function' ? primary.value(dialog) : primary.value);
          }
        }
      };
      document.addEventListener('keydown', onKey, true);

      backdrop.addEventListener('pointerdown', (e) => {
        if (e.target === backdrop) close(cfg.escapeValue !== undefined ? cfg.escapeValue : null);
      });

      if (cfg.title) dialog.appendChild(head);
      dialog.append(body, foot);
      backdrop.appendChild(dialog);
      (this.layer || document.body).appendChild(backdrop);

      cfg.onOpen?.(dialog);
    });
  }

  /**
   * @param {string} message
   * @param {string} [title='WindowsNext']
   * @returns {Promise<void>}
   */
  async alert(message, title = 'WindowsNext') {
    await this._modal({
      title,
      render: (body) => { body.textContent = String(message); },
      buttons: [{ label: '确定', value: true, primary: true }],
      escapeValue: true,
    });
  }

  /**
   * @param {string} message
   * @param {string} [title='确认']
   * @param {{okLabel?:string, cancelLabel?:string}} [opts]
   * @returns {Promise<boolean>}
   */
  async confirm(message, title = '确认', opts = {}) {
    const r = await this._modal({
      title,
      render: (body) => { body.textContent = String(message); },
      buttons: [
        { label: opts.cancelLabel || '取消', value: false },
        { label: opts.okLabel || '确定', value: true, primary: true },
      ],
      escapeValue: false,
    });
    return r === true;
  }

  /**
   * @param {string} message
   * @param {string} [defaultValue='']
   * @param {string} [title='输入']
   * @returns {Promise<string|null>}
   */
  async prompt(message, defaultValue = '', title = '输入') {
    let input;
    return this._modal({
      title,
      render: (body) => {
        const p = document.createElement('div');
        p.textContent = String(message);
        input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue ?? '';
        body.append(p, input);
      },
      onOpen: () => {
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
      },
      buttons: [
        { label: '取消', value: null },
        { label: '确定', value: () => input.value, primary: true },
      ],
      escapeValue: null,
    });
  }

  /* ==========================================================
     文件对话框
     ========================================================== */

  /**
   * 打开 / 保存文件对话框
   * @param {{mode?:'open'|'save', title?:string, path?:string, filename?:string, extensions?:string[], selectFolder?:boolean}} [opts]
   * @returns {Promise<string|null>} 选中的完整路径
   */
  async pickFile(opts = {}) {
    const mode = opts.mode || 'open';
    const exts = (opts.extensions || []).map((e) => e.toLowerCase().replace('.', ''));
    let cwd = P.normalize(opts.path || SHELL_FOLDERS.documents);
    let selected = null;

    return this._modal({
      title: opts.title || (mode === 'save' ? '保存为' : opts.selectFolder ? '选择文件夹' : '打开'),
      className: 'file-dialog',
      escapeValue: null,
      render: (body) => {
        body.style.padding = '0';
        body.style.maxHeight = 'none';

        const pathBar = document.createElement('div');
        pathBar.className = 'fd-path';
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.title = '向上';
        upBtn.style.cssText = 'width:28px;height:28px;border:1px solid var(--stroke-default);border-radius:4px;background:transparent;cursor:default;display:inline-flex;align-items:center;justify-content:center';
        upBtn.innerHTML = getIcon('up', 14);
        const pathInput = document.createElement('input');
        pathInput.type = 'text';
        pathBar.append(upBtn, pathInput);

        const list = document.createElement('div');
        list.className = 'fd-list';

        const foot = document.createElement('div');
        foot.className = 'fd-foot';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = opts.selectFolder ? '当前文件夹' : '文件名';
        nameInput.value = opts.filename || '';
        if (opts.selectFolder) nameInput.disabled = true;
        foot.appendChild(nameInput);

        body.append(pathBar, list, foot);

        const dialog = body.parentElement;
        // 供按钮读取结果
        dialog._getResult = () => {
          if (opts.selectFolder) return cwd;
          const n = nameInput.value.trim();
          if (!n) return null;
          return P.isRoot(n) || /^[A-Za-z]:/.test(n) ? P.normalize(n) : P.join(cwd, n);
        };

        const render = async () => {
          pathInput.value = cwd;
          list.innerHTML = '<div style="padding:12px;color:var(--fg-tertiary)">正在加载…</div>';
          let items;
          try {
            items = await fileSystem.readDir(cwd);
          } catch (err) {
            list.innerHTML = `<div style="padding:12px;color:var(--danger)">${escapeHtml(err.message)}</div>`;
            return;
          }
          list.innerHTML = '';
          const visible = items.filter((it) => {
            if (it.type === 'directory') return true;
            if (opts.selectFolder) return false;
            if (!exts.length) return true;
            return exts.includes(it.ext);
          });
          if (!visible.length) {
            list.innerHTML = '<div style="padding:12px;color:var(--fg-tertiary)">此文件夹为空</div>';
            return;
          }
          for (const it of visible) {
            const row = document.createElement('div');
            row.className = 'fd-row';
            row.innerHTML = `
              <span style="display:inline-flex">${getIcon(it.type === 'directory' ? 'folder' : iconForExtension(it.ext), 18)}</span>
              <span class="fd-name"></span>
              <span class="fd-size">${it.type === 'file' ? P.formatSize(it.size) : ''}</span>
            `;
            row.querySelector('.fd-name').textContent = it.name;
            row.addEventListener('click', () => {
              list.querySelectorAll('.fd-row').forEach((r) => r.classList.remove('is-selected'));
              row.classList.add('is-selected');
              selected = it;
              if (it.type === 'file') nameInput.value = it.name;
            });
            row.addEventListener('dblclick', () => {
              if (it.type === 'directory') {
                cwd = it.path;
                selected = null;
                render();
              } else {
                nameInput.value = it.name;
                dialog._close?.(P.join(cwd, it.name));
              }
            });
            list.appendChild(row);
          }
        };

        upBtn.addEventListener('click', () => {
          const parent = P.dirname(cwd);
          if (parent !== cwd) { cwd = parent; render(); }
        });
        pathInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            cwd = P.normalize(pathInput.value);
            render();
          }
        });
        render();
      },
      buttons: [
        { label: '取消', value: null },
        {
          label: mode === 'save' ? '保存' : opts.selectFolder ? '选择' : '打开',
          primary: true,
          value: (dialog) => dialog._getResult?.() ?? null,
        },
      ],
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export const notifications = new NotificationCenter();
export default notifications;
