# WindowsNext 应用 SDK 开发文档

WindowsNext 提供一个微内核 + 应用插件架构。应用通过 `WinNext.registerApp()` 注册，由窗口管理器统一管理生命周期，能与所有内置应用一样调用文件系统、设置、通知、对话框等能力。

## 快速上手

```javascript
// src/examples/hello-app.js
WinNext.registerApp({
  id: 'com.example.hello',
  name: '你好世界',
  icon: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#0078D4"/></svg>',
  defaultSize: { width: 520, height: 380 },
  minSize: { width: 320, height: 240 },
  resizable: true,
  singleton: false,
  fileExtensions: ['hello'],
  mount(ctx) {
    const root = ctx.root;
    root.innerHTML = `
      <div style="padding:20px;font-family:sans-serif">
        <h1>你好，WindowsNext！</h1>
        <p>当前应用：${ctx.appId}</p>
        <button id="hi">打个招呼</button>
      </div>
    `;
    root.querySelector('#hi').addEventListener('click', () => {
      ctx.notify.toast('收到点击！');
    });
    ctx.onDispose(() => console.log('清理'));
  },
});
```

启动方式：

```javascript
WinNext.launchApp('com.example.hello');
```

或双击已关联 `.hello` 扩展名的文件。

---

## `WinNext` 全局 API

| 方法 | 说明 |
| --- | --- |
| `registerApp(manifest)` | 注册一个应用，参见下节 `AppManifest`。重复注册同 id 会抛错。 |
| `launchApp(appId, args?)` | 启动应用，返回 `Promise<AppInstance>`。若 `manifest.singleton` 且已运行，会聚焦已有窗口。 |
| `openPath(filePath)` | 按文件扩展名关联启动对应应用。`filePath` 例如 `C:/Documents/readme.txt`。 |
| `getRunningApps()` | 返回当前所有进程实例数组（`AppInstance[]`）。 |
| `processManager` | 进程管理单例（高级用法）。 |
| `fs` | 文件系统门面（高级用法）。 |
| `settings` | 设置单例（高级用法）。 |
| `notify` | 通知中心单例（高级用法）。 |
| `events` | 全局事件总线，参见「事件总线」节。 |
| `version` | SDK 版本字符串。 |

---

## `AppManifest` 配置项

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | ✅ | 应用唯一标识，命名空间风格如 `com.example.foo`。 |
| `name` | `string` | ✅ | 显示名称（任务栏、开始菜单、窗口标题）。 |
| `icon` | `string` | ✅ | 内联 SVG 字符串或图片 URL。建议 24×24 viewBox。 |
| `mount` | `function` | ✅ | 应用入口，签名 `(ctx) => void \| Promise<void>`。 |
| `defaultSize` | `{width, height}` | ⬜ | 默认窗口尺寸，默认 720×500。 |
| `minSize` | `{width, height}` | ⬜ | 最小可缩放尺寸，默认 360×240。 |
| `maxSize` | `{width, height}` | ⬜ | 最大可缩放尺寸，可选。 |
| `resizable` | `boolean` | ⬜ | 是否允许缩放，默认 `true`。 |
| `singleton` | `boolean` | ⬜ | 单例模式：重复启动聚焦已有窗口而非新建，默认 `false`。 |
| `fileExtensions` | `string[]` | ⬜ | 关联文件扩展名（无点号），如 `['txt','md']` 双击即启动。 |
| `category` | `string` | ⬜ | 应用分类（设置应用「应用」页显示），如「工具」「游戏」。 |

---

## `AppContext`：应用运行时上下文

`mount(ctx)` 接收的上下文对象，封装了应用所有可用能力。

### `ctx.root`

应用内容挂载点，是一个 **ShadowRoot**。直接对 `ctx.root` 操作 DOM 即可，样式自动隔离于其他应用。

```javascript
const div = document.createElement('div');
div.textContent = 'Hi';
ctx.root.appendChild(div);
```

如需自定义 CSS，建议注入 `<style>` 标签，或通过 `ctx.injectStyle(cssText)`（自动注入到 ShadowRoot）。

### `ctx.window`：窗口控制

| 方法 | 说明 |
| --- | --- |
| `setTitle(title)` | 修改窗口标题。 |
| `setIcon(svgString)` | 修改窗口图标（不影响任务栏与开始菜单图标）。 |
| `close()` | 关闭窗口，触发清理流程。 |
| `minimize()` / `restore()` | 最小化 / 还原。 |
| `maximize()` | 最大化（再次 `restore()` 可还原）。 |
| `resize(w, h)` | 强制调整窗口尺寸。 |
| `focus()` | 提升到顶层并获取焦点。 |
| `setBadge(text)` | 在任务栏图标右上角叠加小红点（消息未读数等）。传 `null` 清除。 |

### `ctx.fs`：文件系统

| 方法 | 说明 |
| --- | --- |
| `readDir(path)` | 读取目录，返回 `FileStat[]`。 |
| `readFile(path)` | 读取文本文件，返回 `Promise<string>`。 |
| `readFileBuffer(path)` | 读取为 `ArrayBuffer`。 |
| `writeFile(path, data)` | 写入文本（`data` 为 `string`）或二进制（`ArrayBuffer`/`Blob`）。 |
| `mkdir(path)` | 创建目录。 |
| `remove(path, recursive?)` | 删除，目录需 `recursive: true`。 |
| `rename(oldPath, newPath)` | 重命名 / 移动。 |
| `stat(path)` | 单个文件/目录元信息。 |
| `search(query, opts?)` | 在 VFS 中搜索文件。 |

路径统一以 `C:/Users/User/Documents/readme.txt` 形式书写。

### `ctx.settings`：设置

| 方法 | 说明 |
| --- | --- |
| `get(key)` | 读取点号分隔键名（`'appearance.theme'`）。 |
| `set(key, value)` | 写入并广播变更 + 自动持久化。 |
| `subscribe(key, cb)` | 订阅变更，回调 `cb(newValue, oldValue)`。 |
| `getLocal(key)` / `setLocal(key, value)` | 应用私有命名空间，存于 `app:<appId>:<key>`，不污染全局设置。 |

### `ctx.notify`：通知与对话框

| 方法 | 说明 |
| --- | --- |
| `toast(message, opts?)` | 右下角 Toast，`opts.level` ∈ `'info' \| 'success' \| 'warn' \| 'error'`，`opts.duration` 毫秒。 |
| `alert(message, title?)` | Promise 化的 alert 弹窗。 |
| `confirm(message, title?)` | Promise 化确认，返回 `boolean`。 |
| `prompt(message, default?, title?)` | Promise 化输入，返回 `string \| null`。 |
| `pickFile(opts)` | 打开文件对话框，`opts.mode` ∈ `'open' \| 'save'`、`opts.type` ∈ `'file' \| 'folder'`，返回路径或 `null`。 |

### `ctx.onDispose(fn)`

注册清理回调。窗口关闭 / 应用被销毁时自动执行。

```javascript
const timer = setInterval(() => console.log('tick'), 1000);
ctx.onDispose(() => clearInterval(timer));
```

### `ctx.launchApp(appId, args?)`

应用内启动另一个应用。

### `ctx.openPath(filePath)`

按扩展名关联启动。

### `ctx.setPreviewProvider(fn)`

注册任务栏缩略图预览摘要。`fn()` 应返回一段简短 HTML/字符串（≤ 200 字符），如「文件首行」「播放列表当前曲名」。

```javascript
ctx.setPreviewProvider(() => `<b>当前行：</b> 第 42 行`);
```

### `ctx.injectStyle(cssText)`

向应用 ShadowRoot 注入 CSS。

```javascript
ctx.injectStyle(`.my-button { color: var(--accent); }`);
```

### `ctx.events`：全局事件总线

订阅、发布跨应用事件。

```javascript
ctx.events.on('myapp:something', payload => { /* ... */ });
ctx.events.emit('myapp:something', { foo: 'bar' });
ctx.events.on('fs:changed', () => { /* 任意应用写文件都会触发 */ });
ctx.events.off('myapp:something', handler);
```

**约定**：第三方事件使用 `appId:eventName` 命名空间以避免冲突。

---

## 完整示例：带文件读写、设置、预览的应用

```javascript
WinNext.registerApp({
  id: 'com.example.notes',
  name: '便签本',
  icon: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="4" y="3" width="16" height="18" rx="2" fill="#FFC107"/></svg>',
  defaultSize: { width: 600, height: 460 },
  mount(ctx) {
    const root = ctx.root;
    root.innerHTML = `
      <style>
        .row { display:flex; gap:8px; padding:8px; }
        textarea { flex:1; height:340px; font:14px/1.5 sans-serif;
                  padding:8px; border:1px solid #ccc; border-radius:6px; resize:none; }
      </style>
      <div class="row"><textarea id="t"></textarea></div>
      <div class="row">
        <button id="load">读取 C:/welcome.txt</button>
        <button id="save">保存为 C:/Documents/note.txt</button>
      </div>
    `;
    const ta = root.querySelector('#t');
    root.querySelector('#load').addEventListener('click', async () => {
      try {
        ta.value = await ctx.fs.readFile('C:/welcome.txt');
      } catch (e) {
        ctx.notify.toast('读取失败：' + e.message, { level: 'error' });
      }
    });
    root.querySelector('#save').addEventListener('click', async () => {
      try {
        await ctx.fs.writeFile('C:/Documents/note.txt', ta.value);
        ctx.notify.toast('已保存', { level: 'success' });
      } catch (e) {
        ctx.notify.toast('保存失败：' + e.message, { level: 'error' });
      }
    });
    ctx.setPreviewProvider(() => {
      const firstLine = ta.value.split('\n')[0] || '(空)';
      return `<b>首行：</b> ${firstLine.slice(0, 80)}`;
    });
    ctx.onDispose(() => { /* 无需清理 */ });
  },
});
```

---

## 内置事件

| 事件 | payload | 说明 |
| --- | --- | --- |
| `fs:changed` | `{path, action}` | 文件系统任一处变更后触发。`action` ∈ `'read'\|'write'\|'create'\|'delete'\|'rename'`。 |
| `wm:window-created` | `{windowId, appId}` | 新窗口创建。 |
| `wm:window-closed` | `{windowId, appId}` | 窗口关闭。 |
| `wm:focus-changed` | `{windowId}` | 焦点窗口变更。 |
| `wm:maximized-count-changed` | `{count}` | 最大化窗口数变化（任务栏透明切换的信号源）。 |
| `settings:changed` | `{key, newValue, oldValue}` | 任意设置项变更。 |
| `theme:changed` | `{theme: 'light'\|'dark'}` | 主题切换。 |
| `wallpaper:mode-changed` | `{mode}` | 壁纸模式变更。 |

---

## 常见问题

**Q: 应用能访问 localStorage / IndexedDB 吗？**
A: 可以，但建议优先使用 `ctx.fs` 与 `ctx.settings` 以便与桌面一致。

**Q: 应用能跳出窗口吗？**
A: 不建议。每个应用只能拥有一个主窗口。如需多个实例，可在 `launchApp` 中传 `args`，由应用自身在 ShadowRoot 内创建「内部视图」或自定义弹层。

**Q: 应用报错会拖垮整个桌面吗？**
A: 不会。`mount()` 抛错会被错误边界捕获并显示「此应用已停止响应」占位页，其他应用与桌面外壳均不受影响。

**Q: 如何启用本地日志级别？**
A: 调用 `ctx.settings.set('system.logLevel', 'debug')` 然后刷新页面。默认仅输出 `warn` 以上。

**Q: 应用 CSS 能否用 Tailwind？**
A: 可以，但建议在 ShadowRoot 内局部使用（每个应用独立加载），避免污染其他应用样式。