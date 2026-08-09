/**
 * hello-app.js — 最小可运行的第三方应用示例
 *
 * 配合 docs/APP_SDK.md 阅读。
 *
 * 加载方式：在 boot.js 之后、registry 启动时调用：
 *   import('./examples/hello-app.js');
 *
 * 也可以直接在地址栏执行：
 *   WinNext.launchApp('com.example.hello');
 */

const HELLO_ICON = `
<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
  <circle cx="12" cy="12" r="10" fill="#0078D4"/>
  <path d="M8 12.5c1 1.5 2.5 2 4 2s3-.5 4-2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <circle cx="9" cy="10" r="1.2" fill="#fff"/>
  <circle cx="15" cy="10" r="1.2" fill="#fff"/>
</svg>`.trim();

WinNext.registerApp({
  id: 'com.example.hello',
  name: '你好世界',
  icon: HELLO_ICON,
  category: '示例',
  description: 'SDK 演示应用，演示文件系统、通知、设置、生命周期清理',
  defaultSize: { width: 520, height: 420 },
  minSize: { width: 360, height: 280 },
  fileExtensions: ['hello'],

  async mount(ctx) {
    // 1. 注入私有样式
    ctx.injectStyle(`
      .hello-app { padding: 20px; font-family: 'Noto Sans', sans-serif; }
      .hello-app h1 { font-size: 20px; margin: 0 0 12px; color: var(--accent); }
      .hello-app p  { font-size: 13px; line-height: 1.6; color: var(--text); margin: 0 0 8px; }
      .hello-app .row { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
      .hello-app button {
        font: inherit; padding: 6px 12px; border: 1px solid #ccc;
        border-radius: 4px; background: #fafafa; cursor: pointer;
      }
      .hello-app button:hover { background: var(--accent); color: #fff; border-color: transparent; }
      .hello-app .counter {
        margin-top: 16px; font-variant-numeric: tabular-nums;
        color: var(--text-secondary);
      }
    `);

    // 2. 渲染界面
    const root = ctx.root;
    root.innerHTML = `
      <div class="hello-app">
        <h1>你好，WindowsNext！</h1>
        <p>这是 <code>com.example.hello</code> —— 一个完整的第三方应用示例。</p>
        <p>它演示了：读写 VFS、Toast 通知、设置持久化、任务栏预览、生命周期清理。</p>
        <div class="row">
          <button id="hello-toast">发送 Toast</button>
          <button id="hello-write">写入示例文件</button>
          <button id="hello-read">读取示例文件</button>
        </div>
        <div class="counter" id="hello-counter">已点击：0 次</div>
      </div>
    `;

    // 3. 应用私有计数器（带默认 0 持久化）
    const counter = ctx.settings.getLocal('clickCount') ?? 0;
    const counterEl = root.querySelector('#hello-counter');
    counterEl.textContent = `已点击：${counter} 次`;

    // 4. 注册事件
    const bump = () => {
      const next = (ctx.settings.getLocal('clickCount') ?? 0) + 1;
      ctx.settings.setLocal('clickCount', next);
      counterEl.textContent = `已点击：${next} 次`;
    };

    root.querySelector('#hello-toast').addEventListener('click', () => {
      ctx.notify.toast(`你好！这是第 ${ctx.settings.getLocal('clickCount') ?? 0} 次点击`);
      bump();
    });

    root.querySelector('#hello-write').addEventListener('click', async () => {
      try {
        await ctx.fs.writeFile(
          'C:/Documents/hello-demo.txt',
          `由 com.example.hello 创建于 ${new Date().toLocaleString()}\n` +
          `已点击：${ctx.settings.getLocal('clickCount') ?? 0} 次\n`,
        );
        ctx.notify.toast('已写入 C:/Documents/hello-demo.txt', { level: 'success' });
      } catch (e) {
        ctx.notify.toast('写入失败：' + e.message, { level: 'error' });
      }
    });

    root.querySelector('#hello-read').addEventListener('click', async () => {
      try {
        const text = await ctx.fs.readFile('C:/Documents/hello-demo.txt');
        ctx.dialog.alert(text, '文件内容');
      } catch (e) {
        ctx.notify.toast('读取失败：' + e.message, { level: 'error' });
      }
    });

    // 5. 任务栏缩略图预览
    ctx.setPreviewProvider(() => `已点击：${ctx.settings.getLocal('clickCount') ?? 0} 次`);

    // 6. 设置应用私有键（仅当窗口尺寸变更时演示订阅）
    ctx.onResize?.(({ width, height }) => {
      // 可选：响应窗口尺寸变更
    });

    // 7. 监听文件系统变化（任何地方写文件都触发）
    ctx.events.on('fs:changed', (info) => {
      if (info.action === 'write' && info.path?.endsWith('hello-demo.txt')) {
        // 自动响应 —— 此处无操作仅作演示
      }
    });

    // 8. 注册清理（必须）
    ctx.onDispose(() => {
      console.info('[hello-app] 清理完成');
    });
  },
});