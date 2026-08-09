---
name: taskbar-ui-optimization
overview: 优化任务栏和开始菜单的UI细节：1) 居中对齐时Windows徽标按钮移到中间区域；2) 左对齐时开始菜单靠左且仅右侧有圆角；3) 关机按钮点击后桌面渐灰并关闭页面。
todos:
  - id: taskbar-start-btn-adaptive
    content: 修改 taskbar.js：实现开始按钮根据对齐模式动态移入/移出 .taskbar-apps，居中对齐时开始按钮参与居中排列，左对齐时回到固定位置
    status: completed
  - id: startmenu-align-css
    content: 修改 start-menu.js 在打开时同步 data-align 属性；修改 shell.css 添加左对齐开始菜单样式（靠左定位、无左侧圆角、独立动画关键帧）
    status: completed
  - id: shutdown-gray-animation
    content: 修改 start-menu.js 关机逻辑：创建全屏灰色覆盖层配合 CSS transition 缓慢变灰，动画结束后关闭页面；在 shell.css 添加 .shutdown-overlay 样式
    status: completed
---

## 用户需求

### 需求一：任务栏居中对齐时，开始按钮参与居中排列

当任务栏图标设置为居中对齐时，Windows徽标按钮不再固定在屏幕最左下角，而是与其他应用图标一起放入中间图标区域，作为该区域的第一个图标参与居中排列。开始菜单保持屏幕中间位置打开不变。

### 需求二：任务栏左对齐时，开始菜单左移且左侧无圆角

当任务栏图标设置为左对齐时，Windows徽标按钮停留在桌面最左下角，开始菜单从屏幕中间移至靠左位置弹出。此时开始菜单左侧无圆角矩形样式，仅右侧保留圆角矩形样式。

### 需求三：关机灰色渐变退出动效

点击开始菜单底部的电源关机按钮后，整个桌面逐渐变为灰色（约2秒），动画完成后通过JavaScript关闭当前页面，实现桌面关机退出的视觉体验。

## 技术方案

### 技术栈

- 纯前端 Web 应用，使用 Vanilla JS + CSS
- 任务栏对齐模式通过 `settings-store.js` 管理，CSS `data-align` 属性驱动样式切换
- 开始菜单位置和样式完全由 CSS 控制

### 实现方案

#### 1. 开始按钮自适应对齐（taskbar.js + shell.css）

**策略**：在 JS 层根据 `data-align` 值动态移动开始按钮 DOM 节点。

- 居中对齐（`center`）：将开始按钮从 `.taskbar-start-zone` 移动到 `.taskbar-apps` 的最前面（`insertBefore`），隐藏空的 `.taskbar-start-zone`
- 左对齐（`left`）：将开始按钮移回 `.taskbar-start-zone` 并恢复显示

**边界处理**：初始化时和每次 `settings.subscribe('taskbar.align')` 触发时执行移动逻辑；事件监听器已绑定在按钮 DOM 上，移动不影响点击行为。

#### 2. 开始菜单位置联动与左对齐圆角（start-menu.js + shell.css）

**策略**：在开始菜单打开时同步 `data-align` 属性，CSS 通过属性选择器切换样式。

- JS：`open()` 方法中从 settings 读取 `taskbar.align` 写入 `this.el.dataset.align`
- CSS：新增 `.start-menu[data-align="left"]` 样式规则 —— `left: 12px; transform: none; transform-origin: bottom left; border-radius: 0 var(--radius-xl) var(--radius-xl) 0;`
- 动画：新增 `startmenu-in-left` 和 `startmenu-out-left` 关键帧（不含 `translateX(-50%)`），通过属性选择器匹配 `.is-opening`/`.is-closing`

#### 3. 关机灰色渐变动效（start-menu.js + shell.css）

**策略**：创建全屏覆盖层，使用 CSS transition 实现渐变动画，动画结束后执行页面关闭。

- JS：关机确认后关闭所有窗口和开始菜单，创建 `<div class="shutdown-overlay">` 追加到 body，`requestAnimationFrame` 后添加 `.is-active` 触发 CSS transition
- CSS：`.shutdown-overlay` 初始 `background: rgba(128,128,128,0)`，`.is-active` 时过渡到 `rgba(128,128,128,0.85)`，`transition: background-color 2s ease-in`
- 关闭页面：监听 `transitionend` 事件，使用 `document.write()` 重写文档内容为简短的关机提示页面

### 性能考量

- DOM 移动操作仅在设置变更时触发一次，无持续性能开销
- 开始菜单 `data-align` 仅在打开时同步一次，无需持续监听
- 关机覆盖层为单次动画，`transitionend` 后自动清理

### 实现细节

- 保持向后兼容：现有的 `data-align="center"` 和 `data-align="left"` 行为不受影响
- 复用现有 CSS 变量：`--radius-xl`（圆角）、`--dur-normal`、`--ease-standard` 等
- 日志级别：关键操作用 `log.info`，错误用 `log.error`