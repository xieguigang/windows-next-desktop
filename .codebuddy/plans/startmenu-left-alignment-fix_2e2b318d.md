---
name: startmenu-left-alignment-fix
overview: 修复左对齐开始菜单：底部紧贴任务栏消除间隙，取消所有圆角样式
todos:
  - id: fix-left-menu-css
    content: "修改 shell.css 中 .start-menu[data-align=\"left\"] 规则：取消圆角（border-radius: 0），消除底部间隙（bottom: var(--taskbar-height)）"
    status: completed
---

## 修改内容

修改左对齐开始菜单的 CSS 样式，实现以下两个效果：

1. 取消左对齐开始菜单的圆角矩形样式（`border-radius: 0`）
2. 消除左侧开始菜单底部与任务栏之间的 12px 间隙，使其底部紧贴任务栏顶部

居中模式下的开始菜单样式和间隙保持现有不变。

## 技术方案

纯 CSS 修改，仅涉及 `shell.css` 中 `.start-menu[data-align="left"]` 规则块。

### 修改位置

`g:/WindowsNext/src/styles/shell.css` 第 542-547 行

### 修改内容

- `border-radius: 0 var(--radius-xl) var(--radius-xl) 0;` → `border-radius: 0;`
- 新增 `bottom: var(--taskbar-height);` 覆盖继承自 `.start-menu` 的 `calc(var(--taskbar-height) + 12px)`，消除 12px 间隙并让开始菜单底部紧贴任务栏

### 不变量

- `.start-menu` 基础规则（居中模式）：`bottom: calc(var(--taskbar-height) + 12px)`、`border-radius: var(--radius-xl)` 不变
- 左对齐动画关键帧 `startmenu-in-left` / `startmenu-out-left` 不受影响