---
name: fix-3d-network-canvas-layout-and-tooltip
overview: 修复首页 3D 标签网络画布未铺满整页（左侧偏移）以及鼠标悬停小球不显示 tooltip 两个问题。两者同源：画布尺寸用 window.innerWidth/innerHeight 而容器用 100vw，导致画布实际矩形与代码假设不一致，既造成布局偏移，又使 raycaster 命中失败。
todos:
  - id: fix-container-css
    content: 将 functions.php 与 front-page.html 中容器 width/height 由 100vw/100vh 改为 100%
    status: completed
  - id: fix-canvas-sizing
    content: 修改 tag-network.js 初始化与 onResize 改用 container.clientWidth/clientHeight 并回退 innerWidth
    status: completed
    dependencies:
      - fix-container-css
  - id: verify-behavior
    content: 在浏览器验证画布铺满贴边且悬停小球显示 tooltip
    status: completed
    dependencies:
      - fix-canvas-sizing
---

## 用户需求

修复 WordPress 主题首页（templates/front-page.html）中 3D 标签关联网络画布的两个问题：

1. 3D 画布未占满整页，画布左边出现在页面中间，没有贴紧页面左侧。
2. 鼠标悬停在 3D 小球上时，未能正确显示用于展示标签信息的 tooltip。

## 产品概述

首页通过 three.js 渲染一个铺满整页的 3D 标签关联网络（固定背景层）。用户可拖动旋转、滚轮缩放，悬停小球查看标签名/文章数/描述，点击跳转标签归档页。

## 核心功能

- 3D 网络画布需精确铺满整个视口（左侧贴边、无水平溢出）。
- 鼠标悬停节点小球时显示跟随光标的 tooltip（标签名、文章数、描述）。
- 保持现有的旋转/缩放/自动旋转与点击跳转交互不变。

## 技术栈

- 前端：原生 JavaScript（IIFE）+ three.js r128（UMD，本地 vendor）+ OrbitControls（本地 vendor）
- 后端/主题层：WordPress PHP（functions.php 注入 CSS 与数据，wp_localize_script 注入 window.LSCI_TAG_NETWORK）
- 样式：functions.php 内联注入 CSS（wp_add_inline_style），front-page.html 内联 style

## 实现方案

### 根因分析

- Bug 1（布局偏移）：容器 `#lsci-tag-network` 使用 `width:100vw;height:100vh`，`100vw` 包含垂直滚动条宽度，比真实视口（`window.innerWidth` 不含滚动条）更宽；而 `tag-network.js` 中渲染器尺寸使用 `window.innerWidth/innerHeight`。二者不一致导致画布实际矩形与代码假设错位，视觉上未铺满且左侧偏移。
- Bug 2（tooltip 不显示）：`updateMouse()` 通过 `renderer.domElement.getBoundingClientRect()` 归一化鼠标坐标，仅在画布真实位于 (0,0) 时正确。因 Bug 1 的偏移，raycaster 几乎命中不到节点，`pick()` 恒返回 null，`onMove` 中 `hovered` 恒为假，tooltip 永不显示。故 Bug 2 是 Bug 1 的直接后果，修复布局即可连带修复 tooltip。

### 关键技术决策

- 让渲染器尺寸跟随容器真实测量尺寸（`container.clientWidth/clientHeight`），而非 `window.innerWidth/innerHeight`，从根上消除“代码假设尺寸”与“实际显示矩形”的偏差。
- 将容器 `100vw/100vh` 改为 `100%/100%`，配合 `position:fixed; inset:0` 铺满视口且不产生滚动条溢出；避免 `100vw` 引发的横向溢出与错位。
- `updateMouse()` 已使用 `getBoundingClientRect()`，保持不动（在画布贴边后即正确）；`onResize()` 同样改用容器尺寸重设 `camera.aspect` 与 `renderer.setSize`。
- 增加 0 尺寸回退：若 `container.clientWidth` 为 0 则回退 `window.innerWidth/innerHeight`，避免初始化阶段画布不可见。

### 性能与可靠性

- 仅调整尺寸来源与 CSS 取值，不改动渲染循环、节点/边构建与 raycaster 逻辑，回归面极小。
- `onResize` 仍绑定 `window` resize 事件，无额外开销；`getBoundingClientRect()` 仅在 mousemove/click 时调用，开销可忽略。
- 保留 `renderer.setPixelRatio(Math.min(devicePixelRatio,2))` 既有上限，避免高分屏过度绘制。

## 实现要点

- 修改 `assets/js/tag-network.js`：初始化与 `onResize()` 统一使用 `container.clientWidth/clientHeight`（带 innerWidth 回退）。
- 修改 `functions.php` 注入 CSS 中 `#lsci-tag-network` 的 `width:100vw;height:100vh` -> `width:100%;height:100%`。
- 修改 `templates/front-page.html` 内联 style 中 `width:100vw;height:100vh` -> `width:100%;height:100%`（保留 `position:fixed;top:0;left:0;right:0;bottom:0`）。
- 不改动 tooltip 的 `position:fixed` 与 `clientX/clientY` 定位（视口坐标系，已正确）。

## 架构设计

保持现有“PHP 注入样式与数据 + 前端 IIFE 初始化 three.js”的架构，仅修正尺寸取值与 CSS 单位，不引入新模块或新模式。

## 目录结构

```
d:/wordpress/wp-content/themes/wordpress-vs-theme/
├── assets/js/tag-network.js     # [MODIFY] 初始化与 onResize 改用 container.clientWidth/clientHeight（带 innerWidth 回退），修复画布尺寸与 raycaster 坐标对齐
├── functions.php                # [MODIFY] #lsci-tag-network 的 width/height 由 100vw/100vh 改为 100%/100%，消除滚动条溢出错位
└── templates/front-page.html    # [MODIFY] #lsci-tag-network 内联 style 的 width/height 由 100vw/100vh 改为 100%/100%，与 CSS 保持一致
```

## 关键代码结构

无需新增类型/接口；仅调整取值逻辑：

- `var width = container.clientWidth || window.innerWidth;`
- `var height = container.clientHeight || window.innerHeight;`
- `onResize` 内同步使用 `container.clientWidth/clientHeight`。