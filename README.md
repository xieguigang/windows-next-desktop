# WindowsNext

一个在浏览器中运行的「类 Windows 11 桌面操作系统」模拟器，使用 **纯 HTML + 原生 JavaScript ES Modules**，**零构建**、**零依赖**（运行时仅 CDN 加载 ECharts）。

## 特性

- **完整桌面外壳**：动态壁纸（渐变 / 图片 / MP4 静音 / HTML 沙箱）、桌面图标网格、任务栏堆叠与缩略图预览、Win11 开始菜单、全局右键菜单。
- **窗口管理器**：拖拽移动、八向缩放、最小化 / 最大化 / 还原 / 关闭、Snap 贴边分屏、z-order 焦点管理。
- **Aero 毛玻璃规则一**：窗口普通状态毛玻璃、最大化自动转为不透明白边框。
- **Aero 毛玻璃规则二**：存在任一最大化窗口时，任务栏与开始菜单自动失去毛玻璃。
- **8 个内置应用**：文件资源管理器（多标签）、计算器（标准/科学 + ECharts 绘图）、终端（自研 bash）、浏览器（多标签 iframe）、媒体播放器（Win10 风格 + 频谱可视化）、记事本、任务管理器（实时性能曲线）、设置（实时调节 Aero 强度 / 主题色 / 壁纸 / 亮暗）。
- **可扩展 SDK**：通过 `WinNext.registerApp()` 注册第三方应用，附完整文档与示例。
- **双文件系统**：内置 VFS（C 盘 / localStorage + IndexedDB），可挂载真实本地目录作为额外盘符（File System Access API）。

## 快速开始

由于 ES Modules 不允许 `file://` 协议直接加载，需要一个静态 HTTP 服务器。

### 方式一：项目内置的极简服务器（推荐）

```powershell
# Windows PowerShell
node serve.js
# 默认监听 http://127.0.0.1:8080
```

### 方式二：Python

```bash
python -m http.server 8080
# 访问 http://localhost:8080
```

### 方式三：VS Code Live Server

安装 [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) 扩展，右键 `index.html` → Open with Live Server。

启动后浏览器会自动打开桌面。

## 浏览器要求

- **Chromium / Edge 100+**：完整支持，包括 File System Access API 挂载本地目录、ECharts 全部图表。
- **Firefox 100+**：核心功能完整可用，本地挂载特性降级。
- **Safari 17+**：基本可用，部分 `backdrop-filter` 渲染可能略有差异。

## 目录结构

```
g:/WindowsNext/
├── index.html                          宿主页面
├── serve.js                            极简静态服务器
├── README.md
├── docs/
│   └── APP_SDK.md                      第三方应用开发文档
├── assets/
│   ├── wallpapers/                     用户可放置自定义图片/视频壁纸
│   │   └── README.md
│   └── html-wallpapers/
│       └── particles.html              示例 HTML 动态壁纸
└── src/
    ├── boot.js                         启动引导
    ├── core/                           内核（窗口/进程/事件/文件系统/通知/设置）
    ├── shell/                          外壳（桌面/任务栏/开始菜单/右键菜单/壁纸）
    ├── sdk/                            SDK 接口
    ├── ui/                             共享图标与控件
    ├── apps/                           内置应用（动态懒加载）
    ├── examples/
    │   └── hello-app.js                第三方应用示例
    └── styles/                         CSS 样式（设计令牌、窗口、外壳、应用共享）
```

## 开发第三方应用

参见 [`docs/APP_SDK.md`](./docs/APP_SDK.md) 与 [`src/examples/hello-app.js`](./src/examples/hello-app.js)。

最小示例：

```javascript
WinNext.registerApp({
  id: 'com.example.hello',
  name: '你好世界',
  icon: '<svg ...>...</svg>',
  defaultSize: { width: 480, height: 360 },
  mount(ctx) {
    ctx.root.innerHTML = `<h1>Hello from ${ctx.appId}!</h1>`;
    ctx.notify.toast('应用已启动');
    ctx.onDispose(() => console.log('清理资源'));
  },
});
```

## 许可证

MIT