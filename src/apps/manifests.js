/**
 * 内置应用清单
 *
 * 只声明元数据（id / 名称 / 图标 / 默认尺寸 / 文件关联 / 模块路径），
 * 不 import 任何应用模块本身 —— 真正的代码由 AppRegistry 在首次启动时
 * 通过动态 `import(entry)` 懒加载，保证首屏只加载内核与 Shell。
 *
 * `entry` 路径相对于 `src/core/app-registry.js` 解析（见 AppRegistry.load）。
 */

/** @type {import('../core/app-registry.js').AppManifest[]} */
export const BUILTIN_APPS = [
  {
    id: 'explorer',
    name: '文件资源管理器',
    icon: 'explorer',
    description: '浏览与管理 C: 盘及已挂载的本地文件夹',
    category: '系统',
    entry: '../apps/explorer/index.js',
    defaultSize: { width: 980, height: 640 },
    minSize: { width: 560, height: 360 },
    showOnDesktop: true,
  },
  {
    id: 'notepad',
    name: '记事本',
    icon: 'notepad',
    description: '轻量文本编辑器',
    category: '实用工具',
    entry: '../apps/notepad/index.js',
    defaultSize: { width: 760, height: 560 },
    minSize: { width: 360, height: 240 },
    fileExtensions: ['txt', 'md', 'log', 'json', 'js', 'css', 'html', 'xml', 'csv', 'ini', 'yml', 'yaml'],
    showOnDesktop: true,
  },
  {
    id: 'terminal',
    name: '终端',
    icon: 'terminal',
    description: '模拟 bash 的命令行环境',
    category: '开发工具',
    entry: '../apps/terminal/index.js',
    defaultSize: { width: 860, height: 520 },
    minSize: { width: 420, height: 240 },
    showOnDesktop: true,
  },
  {
    id: 'calculator',
    name: '计算器',
    icon: 'calculator',
    description: '标准 / 科学 / 函数绘图',
    category: '实用工具',
    entry: '../apps/calculator/index.js',
    defaultSize: { width: 420, height: 620 },
    minSize: { width: 340, height: 480 },
    showOnDesktop: true,
  },
  {
    id: 'browser',
    name: '浏览器',
    icon: 'browser',
    description: '多标签页网页浏览',
    category: '网络',
    entry: '../apps/browser/index.js',
    defaultSize: { width: 1080, height: 700 },
    minSize: { width: 520, height: 360 },
    fileExtensions: ['htm'],
    showOnDesktop: true,
  },
  {
    id: 'media-player',
    name: '媒体播放器',
    icon: 'mediaPlayer',
    description: '音频与视频播放，含频谱可视化',
    category: '媒体',
    entry: '../apps/media-player/index.js',
    defaultSize: { width: 900, height: 600 },
    minSize: { width: 480, height: 320 },
    fileExtensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'mp4', 'webm', 'ogv', 'mov', 'mkv'],
    showOnDesktop: true,
  },
  {
    id: 'image-viewer',
    name: '图片查看器',
    icon: 'imageViewer',
    description: '查看图片，支持缩放、旋转与翻页',
    category: '媒体',
    entry: '../apps/image-viewer/index.js',
    defaultSize: { width: 960, height: 680 },
    minSize: { width: 480, height: 360 },
    fileExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'],
    showOnDesktop: false,
  },
  {
    id: 'task-manager',
    name: '任务管理器',
    icon: 'taskManager',
    description: '查看运行中的应用与资源占用',
    category: '系统',
    entry: '../apps/task-manager/index.js',
    defaultSize: { width: 860, height: 580 },
    minSize: { width: 520, height: 360 },
    singleton: true,
    showOnDesktop: false,
  },
  {
    id: 'settings',
    name: '设置',
    icon: 'settings',
    description: '个性化、系统、应用与存储设置',
    category: '系统',
    entry: '../apps/settings/index.js',
    defaultSize: { width: 940, height: 660 },
    minSize: { width: 560, height: 400 },
    singleton: true,
    showOnDesktop: true,
  },
];

export default BUILTIN_APPS;
