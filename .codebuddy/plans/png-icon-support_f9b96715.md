---
name: png-icon-support
overview: 为图标系统增加 PNG 图片图标支持：通过 JSON 文件定义图标名到 PNG 图片 URL 的映射，加载后在 getIcon 中优先以 <img> 形式渲染 PNG 图标，兼容本地 assets 与远程 URL。
todos:
  - id: add-png-support
    content: 在 src/ui/icons.js 新增 PNG_ICONS Map、loadIconMap 与 getIcon/hasIcon 的 PNG 优先逻辑
    status: completed
  - id: create-json-config
    content: 新建 assets/icons/icon-map.json，定义示例图标名到 PNG URL 的映射
    status: completed
  - id: add-png-style
    content: 在 src/styles/shell.css 新增 .app-icon-png 圆角与 object-fit 样式
    status: completed
  - id: boot-load-map
    content: 在 src/boot.js 启动早期 fetch 配置文件并调用 loadIconMap，失败静默降级
    status: completed
    dependencies:
      - add-png-support
      - create-json-config
---

## 用户需求

修改当前 Windows Next 桌面模拟项目的图标系统，使其支持以 PNG 图片作为应用程序图标，并能够通过读取一个 JSON 配置文件，按配置文件中定义的 URL 加载并展示 PNG 图片图标。

## 产品概述

在现有 `getIcon` 统一图标渲染入口中增加 PNG 图标支持：新增一个模块级的 PNG 图标映射表，由外部 JSON 文件（图标名 → PNG 图片 URL）填充；当应用图标名命中该映射时，`getIcon` 返回 `<img>` 形式的 PNG 图标而非 SVG。配置文件可由本地 `assets/` 路径或任意远程 URL 提供。系统启动时自动拉取该 JSON 并注入映射，加载失败不影响已有 SVG 图标体系。

## 核心功能

- 通过 JSON 文件集中定义「图标名 → PNG URL」映射，支持本地相对路径与远程 http(s) 地址
- `getIcon(name)` 在命中 PNG 映射时返回带圆角、自适应尺寸的 PNG `<img>`（与 Fluent 亚克力风格协调）
- 任务栏、桌面图标、窗口标题栏等所有经 `getIcon` 渲染的应用图标自动获得 PNG 支持（无需改动各调用方）
- 启动时自动加载 JSON 配置；加载失败降级为原有 SVG 图标，不阻断桌面启动
- 保留各 Shell 组件已有的「图标字符串本身是 URL 则直接渲染 img」的兜底逻辑

## 技术栈

- 沿用现有原生 ES Modules、单例导出、`bus` 事件总线、设计令牌体系
- 新增 PNG 映射表与 JSON 加载函数，遵循 `icons.js` 现有 `getIcon/hasIcon` 单例模式
- JSON 通过 `fetch` 读取，由 `serve.js` 静态托管（已支持 `.json` 的 `application/json` MIME）

## 实现方案

### 总体策略

在 `src/ui/icons.js` 中引入模块级 `PNG_ICONS`（Map），新增 `loadIconMap(obj)` 与（可选）`loadIconMapFromUrl(url)` 方法；`getIcon` 在解析 `APP_GLYPHS`/`GLYPHS` 之前优先检查 PNG 映射，命中则返回 `<img class="app-icon-png" ...>`。`boot.js` 在 Shell 初始化前 `fetch` 配置文件并调用 `loadIconMap`，错误静默降级。

### 关键技术决策

1. **统一入口优先**：PNG 检查置于 `getIcon` 最前，使任务栏/桌面/窗口的 `iconMarkup`/`_renderIcon`（`getIcon(name)` 路径）自动生效，避免分散改动、避免破坏现有 SVG 兜底。
2. **映射数据结构**：支持两种 JSON 形态——`{ "icons": { "name": "url" } }` 或扁平 `{ "name": "url" }`，`loadIconMap` 自动归一化；键为图标名（与 `manifests.js` 中 `app.icon` 对齐，如 `explorer`），值为 PNG URL（本地相对路径或远程地址）。
3. **PNG 渲染形态**：返回
`<img class="app-icon-png" src="${url}" width="${size}" height="${size}" alt="" onerror="this.style.display='none'">`
不注入亚克力底板（PNG 自带形状），通过 CSS 类 `app-icon-png` 统一圆角与 `object-fit:contain`，与亚克力风格协调。
4. **向后兼容**：`hasIcon` 同步识别 PNG 名；未命中时完全走原 SVG 逻辑；`manifests.js` 若无对应 PNG 条目，仍用原 SVG 图标，零回归风险。
5. **加载时机与容错**：`boot.js` 在 Shell 初始化（第 6 步）之前 `await fetch`，fail 时 `log.warn` 并继续；不阻断 `desktop.init` 等后续步骤。

### 性能与可靠性

- `PNG_ICONS` 为内存 Map，O(1) 查找；`getIcon` 增加一次 `Map.has` 判断，开销可忽略。
- `fetch` 异步且带超时/错误捕获，不阻塞首屏；图片由浏览器原生缓存。
- `onerror` 内联兜底隐藏坏图，避免破图占位；保留亚克力 SVG 作为最终 fallback（若 PNG 加载失败，调用方可继续用 SVG 名）。

## 实现注意事项

- JSON 文件路径建议在 `assets/icons/icon-map.json`，并在 `boot.js` 中以相对根路径 `'assets/icons/icon-map.json'` 拉取（与 `serve.js` ROOT 解析一致）。
- `getIcon` 的 `opts.bare` 仅作用于 SVG 亚克力底板；PNG 模式忽略 `bare`（img 无底板）。
- 若同名同时存在于 `APP_GLYPHS` 与 `PNG_ICONS`，PNG 优先（允许 JSON 覆盖内置 SVG 图标）。
- 新增 CSS 类需写入一个现有样式文件（如 `src/styles/shell.css` 或新建独立规则），确保 `app-icon-png` 圆角/尺寸生效。

## 架构设计

```mermaid
graph TD
  A[boot.js 启动] -->|fetch assets/icons/icon-map.json| B[loadIconMap]
  B -->|写入 PNG_ICONS Map| C[icons.js]
  D[manifests.js app.icon=explorer] -->|getIcon('explorer')| C
  C -->|命中 PNG_ICONS| E[返回 PNG img]
  C -->|未命中| F[原 SVG 逻辑]
  E --> G[任务栏/桌面/窗口展示 PNG]
```

## 目录结构

```
g:/WindowsNext/
├── assets/
│   └── icons/
│       └── icon-map.json              # [NEW] 图标名→PNG URL 映射，含示例条目
├── src/
│   ├── boot.js                       # [MODIFY] Shell 初始化前 fetch 并 loadIconMap（失败降级）
│   ├── ui/
│   │   └── icons.js                  # [MODIFY] 新增 PNG_ICONS Map、loadIconMap、PNG 优先于 getIcon/hasIcon
│   └── styles/
│       └── shell.css                 # [MODIFY] 新增 .app-icon-png 圆角/object-fit 样式
```

## 关键代码结构

```js
// src/ui/icons.js
const PNG_ICONS = new Map();

export function loadIconMap(obj) {
  if (!obj || typeof obj !== 'object') return;
  const map = obj.icons && typeof obj.icons === 'object' ? obj.icons : obj;
  for (const [name, url] of Object.entries(map)) {
    if (typeof url === 'string' && url) PNG_ICONS.set(name, url);
  }
}

// getIcon 内优先：
const png = PNG_ICONS.get(name);
if (png) {
  return `<img class="app-icon-png" src="${png}" width="${size}" height="${size}" alt="" onerror="this.style.display='none'">`;
}
```