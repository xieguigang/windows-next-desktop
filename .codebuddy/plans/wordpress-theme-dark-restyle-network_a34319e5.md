---
name: wordpress-theme-dark-restyle-network
overview: 将主题改为暗色背景并清除卡片阴影，调整 front-page 三维标签网络全屏展示，并将 post_tag 节点由绿色小球改为白色平面圆形。
design:
  architecture:
    framework: html
  styleKeywords:
    - Dark
    - Tech
    - Minimal
    - Glowing
    - Fullscreen
  fontSystem:
    fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica Neue,Arial,sans-serif"
    heading:
      size: clamp(2.25rem, 5vw, 3.5rem)
      weight: 600
    subheading:
      size: 1.125rem
      weight: 400
    body:
      size: 1rem
      weight: 400
  colorSystem:
    primary:
      - "#4ea1ff"
      - "#4ec9b0"
    background:
      - "#0f1115"
      - "#121417"
    text:
      - "#e6e6e6"
      - "#a8b0ba"
    functional:
      - "#ffffff"
      - "#2e9e5b"
todos:
  - id: dark-theme-json
    content: 修改 theme.json 调色板与 duotone/gradient 为暗色配色
    status: completed
  - id: remove-card-shadow
    content: 清除 style.css 与 style.min.css 中的卡片阴影规则
    status: completed
  - id: fullscreen-network-template
    content: 调整 front-page.html 使三维网络容器全屏展示
    status: completed
  - id: network-script-dark
    content: 修改 tag-network.js 全窗口尺寸与暗色场景背景
    status: completed
    dependencies:
      - fullscreen-network-template
  - id: post-tag-circle
    content: 将 post_tag 节点改为白色平面圆形并 billboard 朝向相机
    status: completed
    dependencies:
      - network-script-dark
  - id: verify-render
    content: 浏览器验证暗色无阴影与网络全屏白色圆片效果
    status: completed
    dependencies:
      - remove-card-shadow
      - post-tag-circle
---

## 用户需求

将 WordPress 主题（wordpress-vs-theme）调整为暗色风格，并修改首页三维标签网络的可视化表现。

## 产品概述

对现有主题进行暗色化改造与三维可视化调整：清除卡片阴影、切换为暗色背景与配色；首页三维网络由小窗口改为整页全屏展示，并将 post_tag 标签节点从绿色三维小球替换为白色平面圆形。

## 核心功能

- 清除主题中所有卡片阴影（box-shadow）及相关 hover 抬升效果。
- 将主题背景色与整体配色更新为暗色系（背景、前景、主色、次色、三级色及 duotone/gradient 协调值）。
- 首页三维网络容器改为占满整个页面视口（全屏展示）。
- 三维网络场景背景由白色改为暗色，配色/连线在暗底上保持可见。
- 将 post_tag 节点的三维球体材质替换为白色平面圆形（CircleGeometry + 平面材质，始终面向相机）。

## 技术栈

- 平台：WordPress 6.5+ 区块主题（FSE），通过 theme.json 定义全局样式与调色板。
- 样式：style.css / style.min.css（主题前端样式，min 为压缩副本，需同步修改）。
- 三维可视化：three.js（assets/js/vendor/three.min.js、OrbitControls.js）+ 业务脚本 assets/js/tag-network.js。
- 模板：templates/front-page.html（区块模板，使用 wp:html 嵌入网络容器）。
- 数据注入：functions.php 通过 wp_localize_script 注入 window.LSCI_TAG_NETWORK。

## 实现方案

### 1. 暗色配色与背景（theme.json）

- 修改 settings.color.palette：background 改为暗色（如 #0f1115），foreground 改为浅色（如 #e6e6e6），primary 改为暗色下醒目的亮色（如 #4ea1ff），secondary/tertiary 改为深灰（#1c1f24 / #262a30）。
- 同步调整 duotone 与 gradients 中引用到的颜色，使其在暗底协调（避免白/浅灰底色块在暗背景下突兀）。
- styles.color.background / text 已引用 preset，无需额外改动即可生效。
- 评估：直接改 palette 影响面最小、最规范，符合 FSE 架构，避免散落硬编码。

### 2. 清除卡片阴影（style.css + style.min.css）

- 在 style.css 第179-320行范围：删除或置空 --vscode-card-shadow / --vscode-card-shadow-hover 变量，移除对 .wp-block-group、.wp-block-post、.wp-block-cover、.wp-block-quote、header/footer、代码块、评论块等元素的 box-shadow 声明；保留圆角/边框以维持卡片观感（用户仅要求去阴影，未要求去边框）。
- 移除 .wp-block-post:hover 的 transform: translateY(-2px) 抬升与 hover 阴影。
- style.min.css 为压缩副本，需同步删除对应 box-shadow 片段并保留其余规则。
- 风险：box-shadow 在 min 文件中被合并进长选择器链，需用精确字符串替换避免误伤其他属性。

### 3. 网络容器全屏（templates/front-page.html + tag-network.js）

- front-page.html：移除 lsci-network-section 区块硬编码 background:#ffffff；将 #lsci-tag-network 容器改为占满视口（通过内联或样式设置 100vw/100vh，并移除上下 padding 限制，使网络覆盖整页）。
- tag-network.js：尺寸计算由 container.clientWidth/clientHeight（小窗口）改为使用 window.innerWidth / window.innerHeight；onResize 同步改用全窗口尺寸；相机位置/控制器范围按需适配。
- scene.background 与 fog 由 #ffffff 改为暗色（与主题背景一致），保证视觉统一。

### 4. post_tag 节点白色平面圆形（tag-network.js）

- 确认 functions.php 注入的节点字段（执行阶段搜索 LSCI_TAG_NETWORK 构建逻辑，确定区分 post_tag 的字段，如 taxonomy 或 slug === 'post_tag'）。
- 节点生成循环（第80-95行）：对非 post_tag 节点保留原有 SphereGeometry + MeshStandardMaterial（绿色系）；对 post_tag 节点改用 CircleGeometry（平面） + MeshBasicMaterial({color:0xffffff})，并设 side: THREE.DoubleSide。
- 为实现“平面圆形在三维旋转中始终可见”，在 animate() 循环中对该类节点执行 mesh.lookAt(camera.position)（billboard），或保持固定朝向加双面渲染；优先 billboard 以保证全角度可读。
- 其余节点配色在暗底上提亮（COLOR_A/COLOR_B/EDGE_BASE 微调为更高明度）以保证可见性。

## 实现注意事项

- 性能：billboard 仅对 post_tag 节点子集执行 lookAt，开销可忽略；全屏 render 仍受 requestAnimationFrame 限制，无需额外节流。
- 兼容性：保留 OrbitControls 阻尼与自动旋转；全屏后需注意 header/footer 区块可能与网络重叠，建议在网络区使用 fixed/absolute 全屏层并确保 z-index 合理（执行阶段确认 front-page 结构，必要时用 CSS 让网络层覆盖、其他区块透明或隐藏）。
- 不引入新依赖，复用现有 three.js / OrbitControls API。
- 修改后需在浏览器验证：暗色背景、无阴影、网络全屏、post_tag 为白色圆片且旋转时始终面向相机。

## 架构设计

沿用现有 FSE 主题架构：theme.json（全局配色）→ style.css/min.css（样式层）→ templates（区块模板）→ assets/js（三维脚本）。改动均为局部覆盖，不重构既有结构。

## 目录结构与修改文件

```
wordpress-vs-theme/
├── theme.json                    # [MODIFY] 调整 palette/duotone/gradients 为暗色配色；styles.color 已引用 preset 自动生效
├── style.css                     # [MODIFY] 清除卡片阴影变量与 box-shadow 规则（第179-320行区域），保留边框/圆角
├── style.min.css                 # [MODIFY] 同步删除压缩副本中的 box-shadow 片段，保留其他规则
├── templates/
│   └── front-page.html           # [MODIFY] 移除网络区硬编码白底；将 #lsci-tag-network 容器改为全屏展示
├── assets/
│   └── js/
│       └── tag-network.js        # [MODIFY] 尺寸改全窗口；scene 背景改暗色；post_tag 节点改白色 CircleGeometry 平面+billboard
└── functions.php                 # [REFERENCE] 确认 LSCI_TAG_NETWORK 节点字段（taxonomy/slug）以识别 post_tag，不改写
```

## 设计风格

采用暗色科技风（Dark Tech / Glassmorphism 倾向），与生命科学计算智能主题契合。整体背景为近黑深灰，前景文字浅灰，强调色使用冷调亮蓝。首页三维网络全屏铺满视口，post_tag 节点呈现为白色发光平面圆片，其余标签为提亮的绿/蓝绿小球，在暗底上形成高对比的星系式知识图谱。

## 页面规划（front-page 单页）

- 区块1（顶部说明区）：保留 hero 文案区，背景改为暗色半透明，文字浅色，去除白底卡片感。
- 区块2（全屏三维网络区）：#lsci-tag-network 占满 100vw/100vh，scene 背景暗色，去掉外圈白框/阴影；hover 出现浅色 tooltip。
- 区块3（页脚）：暗色透明或低对比，避免白色卡片阴影。