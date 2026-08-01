---
name: vscode-light-theme-styling
overview: 将 Twenty Twenty-Two 默认主题的配色、字体、阴影改造为 VSCode Light 主题风格，并实现全面卡片化 UI。直接全局修改 theme.json 与 style.css/style.min.css。
design:
  architecture:
    framework: html
  styleKeywords:
    - VSCode Light
    - 卡片化
    - 浅灰边框
    - 柔和阴影
    - 圆角
    - 蓝色强调
    - 编辑器风格
  fontSystem:
    fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif"
    heading:
      size: 2rem
      weight: 600
    subheading:
      size: 1.25rem
      weight: 600
    body:
      size: 16px
      weight: 400
  colorSystem:
    primary:
      - "#007ACC"
      - "#006AB1"
    background:
      - "#FFFFFF"
      - "#F3F3F3"
    text:
      - "#333333"
      - "#616161"
    functional:
      - "#E5E5E5"
      - "#E8E8E8"
      - "#ADD6FF"
todos:
  - id: update-theme-json-colors
    content: 修改 theme.json 调色板为 VSCode Light 配色并同步 duotone/gradients
    status: completed
  - id: update-theme-json-fonts
    content: 调整 theme.json 字体族：无衬线默认栈 + 新增等宽字体栈
    status: completed
  - id: update-theme-json-styles
    content: 修改 theme.json styles：按钮圆角、链接蓝色、标题字体族
    status: completed
    dependencies:
      - update-theme-json-colors
      - update-theme-json-fonts
  - id: add-card-css
    content: 在 style.css 追加全面卡片化与阴影规则
    status: completed
    dependencies:
      - update-theme-json-colors
  - id: sync-min-css
    content: 将卡片化规则同步压缩写入 style.min.css
    status: completed
    dependencies:
      - add-card-css
---

## 用户需求

将 WordPress 默认主题 Twenty Twenty-Two 的样式改造为 VSCode Light 主题风格，并具备全面的卡片化 UI。采用全局修改方式，直接修改主题默认文件，不改动样式变体与模板结构。

## 产品概述

在保持主题功能完整的前提下，将配色、字体、阴影体系替换为 VSCode Light 编辑器观感，并把页面各主要区块改造为带圆角、浅边框与柔和阴影的卡片，形成统一、现代、清爽的视觉风格。

## 核心功能

- 配色替换为 VSCode Light 调色板：浅灰背景、深灰文字、蓝色强调、浅灰边框与悬停底色
- 字体采用等宽+无衬线混排：正文与标题使用系统无衬线字体栈，代码块使用 VSCode 风格等宽字体
- 全面卡片化：页头、页脚、导航、文章列表/卡片、评论、引用、封面等区块统一加圆角、浅边框与柔和阴影
- 按钮与交互元素圆角化，悬停态使用浅灰高亮
- 同步修改 style.min.css，确保生产环境样式生效

## 技术栈选择

- 主题框架：WordPress 全站编辑（FSE）主题 Twenty Twenty-Two
- 样式配置：theme.json（全局样式、调色板、字体族、块样式）
- 样式表：style.css（开发态，SCRIPT_DEBUG 时服务）与 style.min.css（生产态实际服务）
- 不涉及 PHP 逻辑、模板结构与样式变体文件

## 实现方案

采用「theme.json 配置驱动 + 补充 CSS 卡片规则」的双层策略：

1. **theme.json 驱动配色与字体**：修改 settings.color.palette 为 VSCode Light 色值，并同步更新 duotone/gradients 中引用的色板；修改 fontFamilies 将默认字体栈改为无衬线，并新增等宽字体栈供代码块使用；在 styles 中调整按钮圆角、链接蓝色、标题字体族。
2. **CSS 补充卡片化**：在 style.css 与 style.min.css 中追加统一的卡片样式规则（圆角、边框、柔和阴影），覆盖 header、footer、导航、group、文章卡片、评论、引用、封面、代码块等。

### 关键技术决策与权衡

- 直接修改默认文件而非新建样式变体：用户明确要求全局修改默认主题，降低切换成本，但会覆盖原主题外观（用户已接受）。
- 按钮圆角通过 theme.json 的 styles.blocks.core/button.border.radius 设置，保持配置一致性，避免与 CSS 冲突。
- 卡片化以 CSS 为主而非 theme.json：theme.json 对阴影/边框支持有限，且需覆盖大量块类型，使用 CSS 选择器更灵活、可维护性更高。
- style.min.css 必须与 style.css 同步：生产环境实际加载 min 文件，遗漏会导致线上样式不生效。

### 性能与可靠性

- 仅追加合理的 CSS 规则，不引入额外 HTTP 请求或外部字体加载（使用系统字体栈），零性能损耗。
- 卡片阴影使用轻量级 box-shadow（0 1px 3px rgba(0,0,0,0.08)），避免重绘开销。
- 保留原有对齐与间距逻辑（style.css 中的 negative margin 规则），仅在带背景的块上叠加卡片外观，控制改动范围。

## 实现注意事项

- 修改 theme.json 的 palette 后，需同步检查并调整 duotone（第38-68行）与 gradients（第70-110行）中引用的 foreground/primary/secondary/tertiary 色值，避免颜色失衡。
- style.min.css 是压缩文件，追加规则时应保持语法紧凑，不与现有规则冲突；优先复用已有选择器。
- 代码块（pre/code）字体通过 CSS 设置等宽字体栈，并在 theme.json 或 CSS 中为其提供浅灰底卡片。
- 保持可访问性：对比度需满足 WCAG AA（#333 文字 on #FFF 背景满足），悬停态 #E8E8E8 提供清晰反馈。

## 架构设计

本任务为纯主题样式改造，不涉及架构变更。数据流：theme.json（配色/字体/块样式）→ WordPress 全局样式渲染 → style.css/style.min.css（卡片化与阴影补充）→ 前端呈现 VSCode Light 卡片风格。

## 目录结构

```
c:/Users/Administrator/Downloads/wordpress/wp-content/themes/twentytwentytwo/
├── theme.json          # [MODIFY] 修改 color.palette 为 VSCode Light 配色；调整 fontFamilies（无衬线默认 + 等宽新增）；styles 中按钮圆角、链接蓝、标题字体族；同步 duotone/gradients 色值
├── style.css           # [MODIFY] 追加全面卡片化 CSS 规则：header/footer/导航/group/文章卡片/评论/引用/封面圆角+浅边框+柔和阴影；代码块等宽字体+浅底卡片；按钮圆角；悬停态
└── style.min.css       # [MODIFY] 与 style.css 同步追加压缩后的卡片化与阴影规则，确保生产环境生效
```

## 设计风格

采用 VSCode Light 编辑器风格的全面卡片化设计。整体以纯白与浅灰为背景，深灰文字，蓝色（#007ACC）作为链接与强调色，浅灰边框（#E5E5E5）与柔和阴影（0 1px 3px rgba(0,0,0,0.08)）勾勒卡片边界，圆角统一为 6px。页面各区块（页头、页脚、导航、文章、评论、引用、代码块）均以浮层卡片呈现，悬停时底色轻微变深（#E8E8E8），营造清晰、克制、现代的编辑器观感。

## 页面区块设计（基于现有模板结构）

- 页头卡片：顶部导航与站点标题置于浅灰描边卡片内，圆角下边缘，悬停项浅灰高亮
- 文章列表卡片：每篇文章标题、摘要、元信息包裹于白底卡片，浅边框+柔和阴影，悬停微微抬升
- 正文与侧边栏：正文区域与小组件容器均为卡片，代码块使用等宽字体并加浅灰底卡片
- 评论卡片：每条评论独立卡片，头像与内容分区清晰，引用块左侧蓝色竖线+浅底
- 页脚卡片：页脚内容收束于底部卡片，与页头呼应