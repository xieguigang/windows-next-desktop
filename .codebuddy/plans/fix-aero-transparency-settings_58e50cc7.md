---
name: fix-aero-transparency-settings
overview: 修复设置应用中「Aero效果」和「透明度」个性化设置不生效的 bug，根因是 Aero 底色透明度滑块存在双重事件监听器，导致 CSS 变量 --aero-opacity 被错误覆盖为原始整数值而非正确比例。同时检查并优化相关代码的健壮性。
todos:
  - id: fix-duplicate-listener
    content: 删除 settings/index.js 中第 218-226 行的重复专用事件监听器，并修正第 327-335 行通用 Aero 滑块处理器中对 opacity 分支做 /100 比例转换
    status: completed
  - id: add-clamp01-guard
    content: 为 settings-store.js 中 appearance.aeroOpacity 的 CSS_VAR_MAP 添加 clamp01 防护，与其余透明度设置项保持一致
    status: completed
    dependencies:
      - fix-duplicate-listener
---

## 问题概述

Windows 桌面模拟 Web 应用中，设置应用的「个性化」页面内，「Aero效果」（模糊半径、饱和度、底色透明度）和「透明度」（标题栏透明度、窗口失焦透明度、任务栏透明度、菜单透明度）两组滑块调节时，视觉效果完全不生效。

## 根因分析

经过对 settings → settings-store → CSS variables → CSS 消费端的完整链路审查，确认数据流架构设计正确。问题集中在 settings/index.js 中 `[data-aero="opacity"]` 滑块的**重复事件绑定覆盖 Bug**：

1. **重复事件绑定**：`[data-aero="opacity"]` 底色透明度滑块被注册了两个 `input` 事件监听器。专用处理器（第 219-226 行）将滑杆值除以 100 转为正确比例（如 0.62）；但通用 Aero 滑块处理器（第 327-335 行）遍历所有 `[data-aero]` 滑块，直接将原始滑杆值（如 62）写入 `appearance.aeroOpacity`。由于通用处理器后注册，错误值覆盖了正确值。

2. **缺少防护性夹取**：settings-store.js 中 `appearance.aeroOpacity` 的 `CSS_VAR_MAP` 直接将值拼接到 CSS 变量，未做 `clamp01` 保护。错误值 62 被写入 `--aero-opacity: 62`，导致 `rgba(255,255,255,62)` 被浏览器钳制为 alpha=1，窗口完全变不透明，所有 `backdrop-filter` 模糊/饱和度效果不可见。

## 修复目标

- 删除重复的事件监听器，修正通用处理器中 opacity 分支的数值转换
- 为 settings-store 中 `appearance.aeroOpacity` 添加 `clamp01` 防护，防止错误值持久化后页面刷新仍不生效

## 技术方案

### 修复策略

两处代码修改，均为最小化改动，不引入新架构或新依赖。

### 修改文件

#### 1. `src/apps/settings/index.js` — 修复重复事件绑定

**问题代码（第 218-226 行）**：为 `[data-aero="opacity"]` 单独注册了专用事件监听器。
**问题代码（第 327-335 行）**：通用 Aero 滑块处理器对 opacity 分支不做比例转换，直接写入原始整数值。

**修复方案**：

- **删除**第 218-226 行的重复专用事件监听器代码块（共 9 行）。
- **修改**第 327-335 行的通用处理器：当 `k === 'opacity'` 时，将 `v / 100` 后再写入设置；其他分支（blur、saturate）保持原样。

修改后逻辑：

```js
// Aero 滑块
container.querySelectorAll('[data-aero]').forEach((slider) => {
  slider.addEventListener('input', () => {
    const k = slider.dataset.aero;
    const v = Number(slider.value);
    // opacity 滑杆值（0~100）需转为 0~1 比例
    ctx.settings.set(`appearance.aero${k.charAt(0).toUpperCase() + k.slice(1)}`, k === 'opacity' ? v / 100 : v);
    const label = container.querySelector(`[data-val="${k}"]`);
    if (label) label.textContent = v;
  });
});
```

#### 2. `src/core/settings-store.js` — 添加 clamp01 防护

**问题代码（第 74 行）**：

```js
'appearance.aeroOpacity': (v, root) => root.style.setProperty('--aero-opacity', String(v)),
```

**修复方案**：与其他透明度设置项保持一致，添加 `clamp01` 夹取：

```js
'appearance.aeroOpacity': (v, root) => root.style.setProperty('--aero-opacity', String(clamp01(v, 0.62))),
```

### 无需修改的文件

- `src/styles/variables.css`：CSS 变量预合成逻辑正确，`var(--aero-opacity)` 在 `rgba()` 中的使用方式正确。
- `src/styles/window.css`：`backdrop-filter` 和 `background-color` 消费端正确。
- `src/styles/shell.css`：任务栏和开始菜单的 Aero 效果消费端正确。

### 修复效果验证

修复后，调节「底色透明度」滑块时：

- `--aero-opacity` 将被正确设置为 0.20~0.95
- `--aero-window-bg` 将正确计算为 `rgba(255,255,255,0.62)`
- 窗口呈现半透明毛玻璃效果，`backdrop-filter: blur(30px) saturate(180%)` 效果可见
- 所有 Aero 滑块（模糊、饱和度、底色透明度）和透明度滑块（标题栏、窗口失焦、任务栏、菜单）均可实时预览