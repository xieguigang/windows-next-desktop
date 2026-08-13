/**
 * Fluent 风格内联 SVG 图标库
 *
 * 全部为手绘路径，零外部依赖、无 FOUC。
 * `getIcon(name, size, options)` 返回 SVG 字符串。
 * 彩色应用图标使用固定配色，单色 UI 图标用 currentColor 继承父级颜色。
 */

/** 单色 UI 图标：24x24 视口的路径数据 */
const GLYPHS = {
  /* 窗口控制 */
  minimize: '<path d="M4.5 12h15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>',
  maximize: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.6" stroke="currentColor" stroke-width="1.2" fill="none"/>',
  restore: '<rect x="4.5" y="7.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M8 5.5h9a1.5 1.5 0 0 1 1.5 1.5v9" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>',

  /* 导航 */
  back: '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  forward: '<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  up: '<path d="M5 15l7-7 7 7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M5 9l7 7 7-7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronRight: '<path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronLeft: '<path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronUp: '<path d="M5.5 14.5L12 8l6.5 6.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M9 20h6M12 16v4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  documents: '<path d="M5 4h7l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M12 4v4h4" stroke="currentColor" stroke-width="1.3" fill="none"/>',
  downloads: '<path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  pictures: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><path d="m4.5 17 4-4 3.5 3.5L17 11l3 5.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
  music: '<path d="M9 18V5l11-2v13" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/><circle cx="6.5" cy="18.5" r="2.5" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="17.5" cy="16.5" r="2.5" stroke="currentColor" stroke-width="1.4" fill="none"/>',
  videos: '<rect x="3.5" y="6" width="13" height="12" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M16.5 10.5 21 8v8l-4.5-2.5z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
  hdd: '<rect x="3.5" y="6" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="7" cy="12" r="1" fill="currentColor"/><circle cx="10" cy="12" r="1" fill="currentColor"/>',
  usb: '<path d="M10 3h4v5M12 8v3M8 11h8v6a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-6Z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  eject: '<path d="M12 5.5 19 14H5l7-8.5Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M5.5 17.5h13" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.1-5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M19 4v4.2h-4.2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  home: '<path d="M4 11.2 12 4.5l8 6.7V19a1 1 0 0 1-1 1h-4v-5.5H9V20H5a1 1 0 0 1-1-1v-7.8Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',

  /* 通用动作 */
  search: '<circle cx="10.5" cy="10.5" r="5.8" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M14.8 14.8 19.5 19.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  add: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  more: '<circle cx="5.5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor"/>',
  star: '<path d="m12 4 2.47 5.01 5.53.8-4 3.9.94 5.5L12 16.62 7.06 19.2l.94-5.5-4-3.9 5.53-.8L12 4Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="5.8" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M14.8 14.8 20 20M10.5 8v5M8 10.5h5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="5.8" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M14.8 14.8 20 20M8 10.5h5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  fitScreen: '<rect x="3.5" y="5" width="17" height="14" rx="1.8" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M7.5 9.5v-1.5h1.5M16.5 9.5v-1.5h-1.5M7.5 14.5v1.5h1.5M16.5 14.5v1.5h-1.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  actualSize: '<rect x="3.5" y="5" width="17" height="14" rx="1.8" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M9.4 15V9.6l-1.6 1M13 15h3.2M14.6 15V9.6" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  rotateLeft: '<path d="M4.5 9.5h5.2M4.5 9.5V4.4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.9 9.2A7.6 7.6 0 1 1 4.4 13" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  rotateRight: '<path d="M19.5 9.5h-5.2M19.5 9.5V4.4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.1 9.2A7.6 7.6 0 1 0 19.6 13" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
  flipHorizontal: '<path d="M12 4v16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2.5 2.5"/><path d="M9.6 7.5 4.6 12l5 4.5V7.5Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M14.4 7.5 19.4 12l-5 4.5V7.5Z" fill="currentColor"/>',
  edit: '<path d="M4.5 19.5h15" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M6 15.2V17h1.8l8.1-8.1-1.8-1.8L6 15.2Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="m15.3 5.9 1.8 1.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  check: '<path d="M5 12.8 9.6 17.4 19 7.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.8" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M15.5 5.5H6a1.5 1.5 0 0 0-1.5 1.5v9.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  cut: '<circle cx="7" cy="17.5" r="2.4" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="17" cy="17.5" r="2.4" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8.6 15.6 17.5 4M15.4 15.6 6.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  paste: '<rect x="5.5" y="5.5" width="13" height="14" rx="1.8" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M9 5.5V4.2A1.2 1.2 0 0 1 10.2 3h3.6A1.2 1.2 0 0 1 15 4.2v1.3" stroke="currentColor" stroke-width="1.3" fill="none"/>',
  delete: '<path d="M5.5 7h13M10 7V5.4A1.4 1.4 0 0 1 11.4 4h1.2A1.4 1.4 0 0 1 14 5.4V7M7 7l.9 12.1A1.5 1.5 0 0 0 9.4 20.5h5.2a1.5 1.5 0 0 0 1.5-1.4L17 7" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  rename: '<path d="M4 17.5 16.2 5.3a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L7.5 21H4v-3.5Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
  save: '<path d="M5.5 4.5h10L19.5 8.5v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M8 4.5v5h7v-5M8 20.5v-5.5h8v5.5" stroke="currentColor" stroke-width="1.2" fill="none"/>',
  folderOpenSm: '<path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h4l1.6 2H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-9Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
  sort: '<path d="M6 7h13M6 12h9M6 17h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  grid: '<rect x="4.5" y="4.5" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="13.5" y="13.5" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.3" fill="none"/>',
  list: '<path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  details: '<path d="M4 6.5h4M10 6.5h10M4 12h4M10 12h10M4 17.5h4M10 17.5h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M12 11v5.5M12 7.8v.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  warning: '<path d="M12 4.6 21 19.4H3L12 4.6Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M12 10v4M12 16.6v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  error: '<circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',

  /* 托盘 */
  wifi: '<path d="M3.5 9.2a13 13 0 0 1 17 0M6.4 12.6a8.7 8.7 0 0 1 11.2 0M9.3 16a4.4 4.4 0 0 1 5.4 0" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
  volume: '<path d="M4.5 9.5h3l4-3.2v11.4l-4-3.2h-3v-5Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M14.5 9a4 4 0 0 1 0 6M17 6.5a7.6 7.6 0 0 1 0 11" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  volumeMute: '<path d="M4.5 9.5h3l4-3.2v11.4l-4-3.2h-3v-5Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M15 9.5l5 5M20 9.5l-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  battery: '<rect x="3" y="8" width="16" height="8" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="5" y="10" width="10" height="4" rx="1" fill="currentColor"/><path d="M21 10.5v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M10 18.2a2.2 2.2 0 0 0 4 0" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  power: '<path d="M12 4v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7.5 6.8a7 7 0 1 0 9 0" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  user: '<circle cx="12" cy="8.5" r="3.8" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
  pin: '<path d="M14.5 3.5 20.5 9.5l-3.2 1.2-1.4 5.1-2.3-2.3L8 19l-.7-.7 4.5-5.6-2.3-2.3 5.1-1.4 1.2-3.2Z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/>',
  unpin: '<path d="M14.5 3.5 20.5 9.5l-3.2 1.2-1.4 5.1-2.3-2.3L8 19l-.7-.7 4.5-5.6-2.3-2.3 5.1-1.4 1.2-3.2Z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round" opacity=".45"/><path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="12" cy="15" r="1.3" fill="currentColor"/>',
  network: '<path d="M3.5 9.2a13 13 0 0 1 17 0M6.4 12.6a8.7 8.7 0 0 1 11.2 0M9.3 16a4.4 4.4 0 0 1 5.4 0" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>',
  window: '<rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M3.5 9h17" stroke="currentColor" stroke-width="1.3"/><circle cx="6.3" cy="7" r=".8" fill="currentColor"/><circle cx="8.9" cy="7" r=".8" fill="currentColor"/>',
  windows: '<path fill="currentColor" d="M3 5.9 10.3 4.9v6.8H3V5.9Zm0 12.2 7.3 1v-6.7H3v5.7Zm8.3 1.2L21 20.6v-8.4h-9.7v7.1Zm0-15.2v7.2H21V3.4l-9.7 1.3Z"/>',

  /* 天气 */
  weather: '<circle cx="8.5" cy="9" r="3.8" fill="#FFD45E"/><circle cx="8.5" cy="9" r="5.4" fill="#FFD45E" opacity=".35"/><path d="M7 18.5h9a3 3 0 0 0 0-6 4.2 4.2 0 0 0-8.1 1.1A3 3 0 0 0 7 18.5Z" fill="#E8EFF7"/>',

  /* 媒体控制 */
  play: '<path d="M8 5.5 18.5 12 8 18.5v-13Z" fill="currentColor"/>',
  pause: '<rect x="7" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1" fill="currentColor"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>',
  prev: '<path d="M17 5.5 8.5 12 17 18.5v-13Z" fill="currentColor"/><rect x="5.5" y="5.5" width="2" height="13" rx="1" fill="currentColor"/>',
  next: '<path d="M7 5.5 15.5 12 7 18.5v-13Z" fill="currentColor"/><rect x="16.5" y="5.5" width="2" height="13" rx="1" fill="currentColor"/>',
  shuffle: '<path d="M3.5 6.5h3.2l9.8 11h4M3.5 17.5h3.2l3.1-3.5M13.4 9.5l3.1-3h4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 3.8l2.7 2.7L18 9.2M18 14.8l2.7 2.7L18 20.2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  repeat: '<path d="M6 8.5h11a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M8.5 5.8 5.8 8.5l2.7 2.7" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  fullscreen: '<path d="M4.5 9V5.5a1 1 0 0 1 1-1H9M15 4.5h3.5a1 1 0 0 1 1 1V9M19.5 15v3.5a1 1 0 0 1-1 1H15M9 19.5H5.5a1 1 0 0 1-1-1V15" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>',

  /* 设置分类 */
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.7-1.6 1.7-1.6h1.6A4.4 4.4 0 0 0 20.5 10c0-3.6-3.8-6.5-8.5-6.5Z" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="7.6" cy="11.5" r="1.2" fill="currentColor"/><circle cx="10.4" cy="7.6" r="1.2" fill="currentColor"/><circle cx="15" cy="8.2" r="1.2" fill="currentColor"/>',
  monitor: '<rect x="3" y="5" width="18" height="12" rx="1.8" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M9 20h6M12 17v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  apps: '<rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/><rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3" fill="none"/>',
  storage: '<ellipse cx="12" cy="6.5" rx="7.5" ry="3" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" stroke="currentColor" stroke-width="1.3" fill="none"/>',
  gear: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
};

/**
 * 彩色应用/文件图标：半透明品牌色形状，叠在 getIcon 注入的亚克力底板上，
 * 形成「彩色磨砂玻璃块」的 Fluent 亚克力风格。
 */
const APP_GLYPHS = {
  explorer: `
    <path d="M3 7.4a2 2 0 0 1 2-2h4.6l2 2.3h7.4a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.4Z" fill="#F7B84B" fill-opacity="0.92"/>
    <path d="M3 11h18v6.4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V11Z" fill="#FFD166" fill-opacity="0.78"/>`,
  folder: `
    <path d="M2.5 6.8a1.8 1.8 0 0 1 1.8-1.8h4.7l2 2.3h10.7a1.8 1.8 0 0 1 1.8 1.8v9.4a1.8 1.8 0 0 1-1.8 1.8H4.3a1.8 1.8 0 0 1-1.8-1.8V6.8Z" fill="#E8A72E" fill-opacity="0.92"/>
    <path d="M2.5 9.9a1.8 1.8 0 0 1 1.8-1.8h17.4a1.8 1.8 0 0 1 1.8 1.8v8.3a1.8 1.8 0 0 1-1.8 1.8H4.3a1.8 1.8 0 0 1-1.8-1.8V9.9Z" fill="#FFC845" fill-opacity="0.80"/>`,
  calculator: `
    <rect x="4" y="2.6" width="16" height="18.8" rx="3" fill="#2B579A" fill-opacity="0.85"/>
    <rect x="6.2" y="5" width="11.6" height="4" rx="1.2" fill="#DCEAFB" fill-opacity="0.9"/>
    <g fill="#9FCBF5" fill-opacity="0.92">
      <rect x="6.2" y="10.6" width="2.8" height="2.5" rx=".8"/><rect x="10.6" y="10.6" width="2.8" height="2.5" rx=".8"/>
      <rect x="15" y="10.6" width="2.8" height="2.5" rx=".8"/><rect x="6.2" y="14.4" width="2.8" height="2.5" rx=".8"/>
      <rect x="10.6" y="14.4" width="2.8" height="2.5" rx=".8"/><rect x="6.2" y="18.2" width="2.8" height="2.3" rx=".8"/>
      <rect x="10.6" y="18.2" width="2.8" height="2.3" rx=".8"/>
    </g>
    <rect x="15" y="14.4" width="2.8" height="6" rx=".9" fill="#F2A93B" fill-opacity="0.95"/>`,
  terminal: `
    <rect x="2.4" y="4" width="19.2" height="16" rx="3" fill="#0E1116" fill-opacity="0.82"/>
    <rect x="2.4" y="4" width="19.2" height="3.2" rx="3" fill="#2A2F38" fill-opacity="0.9"/>
    <circle cx="5.4" cy="5.6" r=".8" fill="#FF5F57" fill-opacity="0.9"/><circle cx="8" cy="5.6" r=".8" fill="#FEBC2E" fill-opacity="0.9"/><circle cx="10.6" cy="5.6" r=".8" fill="#28C840" fill-opacity="0.9"/>
    <path d="M5.6 11 9 13.6l-3.4 2.6" stroke="#4CE08A" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 16.6h6.4" stroke="#4CE08A" stroke-width="1.5" stroke-linecap="round"/>`,
  browser: `
    <circle cx="12" cy="12" r="9" fill="#1E88E5" fill-opacity="0.85"/>
    <path d="M12 3c2.5 0 4.5 4 4.5 9s-2 9-4.5 9-4.5-4-4.5-9S9.5 3 12 3Z" fill="none" stroke="#BBDEFB" stroke-width="1.2" stroke-opacity="0.9"/>
    <path d="M3.4 9h17.2M3.4 15h17.2M12 3v18" stroke="#BBDEFB" stroke-width="1.2" stroke-opacity="0.9"/>`,
  mediaPlayer: `
    <circle cx="12" cy="12" r="9.2" fill="#1F5FA8" fill-opacity="0.85"/>
    <circle cx="12" cy="12" r="7" fill="#F26522" fill-opacity="0.88"/>
    <circle cx="12" cy="12" r="5" fill="#ffffff" fill-opacity="0.9"/>
    <path d="M10.4 9 15.2 12l-4.8 3V9Z" fill="#1F5FA8" fill-opacity="0.9"/>`,
  imageViewer: `
    <rect x="3" y="4.6" width="18" height="14.8" rx="2.4" fill="#F7FBFF" fill-opacity="0.88"/>
    <rect x="3" y="4.6" width="18" height="14.8" rx="2.4" fill="none" stroke="#B9D6F2" stroke-width="1.1" stroke-opacity="0.8"/>
    <circle cx="8.4" cy="9.6" r="1.8" fill="#FFC845" fill-opacity="0.95"/>
    <path d="M4.4 17.8 9 12.8l3.2 3.4 2.9-3.1 4.5 4.7H4.4Z" fill="#3A7BD5" fill-opacity="0.85"/>
    <path d="M12.2 16.2l2.9-3.1 4.5 4.7h-4.9l-2.5-1.6Z" fill="#7FB2E8" fill-opacity="0.85"/>`,
  notepad: `
    <path d="M5 2.8h9.2L19.4 8.2v12.8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" fill="#F7FBFF" fill-opacity="0.9"/>
    <path d="M14.2 2.8 19.4 8h-4.4a.6.6 0 0 1-.6-.6V2.8Z" fill="#B9D6F2" fill-opacity="0.9"/>
    <path d="M4 2.8h2.6v19.2H5a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" fill="#3A7BD5" fill-opacity="0.9"/>
    <g stroke="#7FA9D8" stroke-width="1.1" stroke-linecap="round" stroke-opacity="0.9"><path d="M8.6 11.4h8M8.6 14.4h8M8.6 17.4h5.4"/></g>`,
  taskManager: `
    <rect x="2.8" y="4.4" width="18.4" height="15.2" rx="2.4" fill="#1F2A37" fill-opacity="0.85"/>
    <rect x="2.8" y="4.4" width="18.4" height="3" rx="2.4" fill="#374151" fill-opacity="0.9"/>
    <path d="M5.4 16.6l3-4.4 2.6 2.8 3.2-5.6 2.8 4 2.6-2.6" stroke="#4ADE80" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.95"/>
    <path d="M5 18.8h14" stroke="#4B5563" stroke-width="1" stroke-opacity="0.8"/>`,
  settings: `
    <circle cx="12" cy="12" r="9" fill="#5B6470" fill-opacity="0.85"/>
    <path d="M12 4.8a7.2 7.2 0 0 1 2.4.4l.5 2 1.6.9 2-.7a7.2 7.2 0 0 1 1.7 1.8l-1.6 1.3.02 1.8 1.6 1.3a7.2 7.2 0 0 1-1.8 2.2l-2-.7-1.5.9-.5 2a7.2 7.2 0 0 1-2.9 0l-.5-2-1.6-.9-2 .7a7.2 7.2 0 0 1-1.8-2.2l1.6-1.3-.02-1.8L4.6 9.8a7.2 7.2 0 0 1 1.8-2.2l2 .7 1.6-.9.5-2Z" fill="#8B95A3" fill-opacity="0.9"/>
    <circle cx="12" cy="12" r="3.2" fill="#2C333D" fill-opacity="0.92"/>`,
  hello: `
    <rect x="2.8" y="3.4" width="18.4" height="17.2" rx="4.4" fill="#7C3AED" fill-opacity="0.88"/>
    <circle cx="9" cy="10.6" r="1.5" fill="#fff" fill-opacity="0.95"/><circle cx="15" cy="10.6" r="1.5" fill="#fff" fill-opacity="0.95"/>
    <path d="M8 15.4a5 5 0 0 0 8 0" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-opacity="0.95"/>`,
  recycleBin: `
    <path d="M5 7.6h14l-1.2 12a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 7.6Z" fill="#BFD9F2" fill-opacity="0.85"/>
    <path d="M3.6 5.6h16.8v2h-16.8z" fill="#5B93D6" fill-opacity="0.9"/>
    <path d="M9.4 3.2h5.2v2.4H9.4z" fill="#5B93D6" fill-opacity="0.9"/>
    <g stroke="#4A7CB8" stroke-width="1.2" stroke-linecap="round" stroke-opacity="0.9"><path d="M9.6 10.6v7M12 10.6v7M14.4 10.6v7"/></g>`,
  thisPc: `
    <rect x="2.8" y="4.4" width="18.4" height="12" rx="2" fill="#4A5568" fill-opacity="0.85"/>
    <rect x="4" y="5.8" width="16" height="8.8" rx="1" fill="#63B3ED" fill-opacity="0.85"/>
    <path d="M7.6 19.6h8.8l1 2H6.6l1-2Z" fill="#4A5568" fill-opacity="0.9"/>`,

  /* 文件类型 */
  fileGeneric: `
    <path d="M5.6 2.8h8.2L19.4 8.4v13a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" fill="#EFF3F8" fill-opacity="0.9"/>
    <path d="M13.8 2.8 19.4 8.4h-5a.6.6 0 0 1-.6-.6V2.8Z" fill="#C3D3E5" fill-opacity="0.9"/>
    <g stroke="#9FB4CC" stroke-width="1" stroke-linecap="round" stroke-opacity="0.9"><path d="M7.4 12.2h9M7.4 15.2h9M7.4 18.2h6"/></g>`,
  fileText: `
    <path d="M5.6 2.8h8.2L19.4 8.4v13a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" fill="#F7FAFF" fill-opacity="0.92"/>
    <path d="M13.8 2.8 19.4 8.4h-5a.6.6 0 0 1-.6-.6V2.8Z" fill="#A8C8EC" fill-opacity="0.9"/>
    <g stroke="#5B93D6" stroke-width="1.1" stroke-linecap="round" stroke-opacity="0.9"><path d="M7.4 11.8h9M7.4 14.8h9M7.4 17.8h5.6"/></g>`,
  fileImage: `
    <path d="M5.6 2.8h8.2L19.4 8.4v13a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" fill="#F1FBF4" fill-opacity="0.92"/>
    <path d="M13.8 2.8 19.4 8.4h-5a.6.6 0 0 1-.6-.6V2.8Z" fill="#A8DFBB" fill-opacity="0.9"/>
    <circle cx="9.2" cy="12.6" r="1.5" fill="#F2B33D" fill-opacity="0.95"/>
    <path d="M5.6 19.6 9.6 15.4l2.4 2.6 3-3.4 4 5.4H5.6Z" fill="#3FA45E" fill-opacity="0.9"/>`,
  fileAudio: `
    <path d="M5.6 2.8h8.2L19.4 8.4v13a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" fill="#FDF3FB" fill-opacity="0.92"/>
    <path d="M13.8 2.8 19.4 8.4h-5a.6.6 0 0 1-.6-.6V2.8Z" fill="#E9B7DD" fill-opacity="0.9"/>
    <path d="M14.6 10.6v6a2 2 0 1 1-1.4-1.9v-3l-3.6.9v4.1a2 2 0 1 1-1.4-1.9v-4.6l6.4-1.6Z" fill="#B5439E" fill-opacity="0.92"/>`,
  fileVideo: `
    <path d="M5.6 2.8h8.2L19.4 8.4v13a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" fill="#FFF4EE" fill-opacity="0.92"/>
    <path d="M13.8 2.8 19.4 8.4h-5a.6.6 0 0 1-.6-.6V2.8Z" fill="#F5C3A5" fill-opacity="0.9"/>
    <path d="M9.6 11.8 15.4 15.2l-5.8 3.4v-6.8Z" fill="#E2703A" fill-opacity="0.92"/>`,
  fileCode: `
    <path d="M5.6 2.8h8.2L19.4 8.4v13a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" fill="#F3F0FF" fill-opacity="0.92"/>
    <path d="M13.8 2.8 19.4 8.4h-5a.6.6 0 0 1-.6-.6V2.8Z" fill="#C4B5FD" fill-opacity="0.9"/>
    <path d="M9.6 12.2 7.4 15l2.2 2.8M14.4 12.2l2.2 2.8-2.2 2.8M12.6 11.4l-1.2 7.2" stroke="#7C3AED" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.92"/>`,
};

/** Windows 徽标（开始按钮） */
export const WIN_LOGO = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 5.9 10.3 4.9v6.8H3V5.9Zm0 12.2 7.3 1v-6.7H3v5.7Zm8.3 1.2L21 20.6v-8.4h-9.7v7.1Zm0-15.2v7.2H21V3.4l-9.7 1.3Z"/></svg>`;

/**
 * 统一的亚克力（半透明磨砂玻璃）底板：圆角方块 + 顶部高光 + 细描边。
 * 注入到每个图标 SVG 内部，使所有图标呈现一致的半透明毛玻璃质感。
 * 中性半透明白底，品牌色形状叠于其上即形成「彩色磨砂块」。
 */
const ACRYLIC_BASE =
  '<rect x="1.5" y="1.5" width="21" height="21" rx="5.6" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.30)" stroke-width="0.6"/>' +
  '<rect x="2.6" y="2.4" width="18.8" height="8.6" rx="4.2" fill="rgba(255,255,255,0.14)"/>';

/**
 * 获取图标 SVG 字符串
 * @param {string} name 图标名
 * @param {number} [size=16]
 * @param {{class?:string, color?:string, bare?:boolean}} [opts] bare=true 时不注入亚克力底板（用于已自带玻璃容器的媒体按钮等）
 * @returns {string}
 */
export function getIcon(name, size = 16, opts = {}) {
  const inner = APP_GLYPHS[name] || GLYPHS[name];
  if (!inner) {
    // 未知图标兜底：一个中性文件图标，避免布局塌陷
    return getIcon('fileGeneric', size, opts);
  }
  const cls = opts.class ? ` class="${opts.class}"` : '';
  const style = opts.color ? ` style="color:${opts.color}"` : '';
  const acrylic = opts.bare ? '' : ACRYLIC_BASE;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"${cls}${style} aria-hidden="true" focusable="false">${acrylic}${inner}</svg>`;
}

/**
 * 判断某图标名是否存在
 * @param {string} name
 */
export function hasIcon(name) {
  return Boolean(APP_GLYPHS[name] || GLYPHS[name]);
}

/**
 * 根据文件扩展名推断图标名
 * @param {string} ext 不含点，小写
 * @returns {string}
 */
export function iconForExtension(ext) {
  const e = String(ext || '').toLowerCase();
  if (['txt', 'md', 'log', 'ini', 'cfg', 'csv'].includes(e)) return 'fileText';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(e)) return 'fileImage';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(e)) return 'fileAudio';
  if (['mp4', 'webm', 'mkv', 'avi', 'mov'].includes(e)) return 'fileVideo';
  if (['js', 'mjs', 'ts', 'json', 'html', 'htm', 'css', 'py', 'java', 'c', 'cpp', 'sh', 'xml'].includes(e)) return 'fileCode';
  return 'fileGeneric';
}

/**
 * 渲染图标到 DOM 元素
 * @param {string} name
 * @param {number} [size]
 * @returns {HTMLSpanElement}
 */
export function iconEl(name, size = 16) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.style.display = 'inline-flex';
  span.innerHTML = getIcon(name, size);
  return span;
}

export default { getIcon, hasIcon, iconEl, iconForExtension, WIN_LOGO };
