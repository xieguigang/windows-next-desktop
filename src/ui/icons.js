/**
 * 图标管理：优先 assets/icons/icon-map.json 的 PNG 映射，否则返回内联 SVG。
 */
const SVG_ICONS = {
  window: `<svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  explorer: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 7a2 2 0 012-2h3l2 2h6a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" fill="#FCD34D" stroke="#F59E0B" stroke-width="1.2"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 7a2 2 0 012-2h3l2 2h6a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" fill="#FCD34D" stroke="#F59E0B" stroke-width="1.2"/></svg>`,
  file: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M7 3a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5H7z" fill="#E5E7EB" stroke="#9CA3AF" stroke-width="1.2"/><path d="M13 3v6h6" fill="none" stroke="#9CA3AF" stroke-width="1.2"/></svg>`,
  image: `<svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="3" y="5" width="18" height="14" rx="2" fill="#DBEAFE" stroke="#3B82F6" stroke-width="1.5"/><circle cx="8" cy="10" r="1.5" fill="#3B82F6"/><path d="M3 16l5-5 4 4 6-6 3 3v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-1z" fill="#93C5FD"/></svg>`,
  video: `<svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="3" y="6" width="18" height="12" rx="2" fill="#EDE9FE" stroke="#8B5CF6" stroke-width="1.5"/><polygon points="10,9 17,12 10,15" fill="#8B5CF6"/></svg>`,
  music: `<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="9" cy="18" r="3" fill="#F87171"/><circle cx="17" cy="15" r="2" fill="#F87171"/><path d="M12 18V6l8-3v12" fill="none" stroke="#F87171" stroke-width="2" stroke-linecap="round"/></svg>`,
  notepad: `<svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="5" y="3" width="14" height="18" rx="2" fill="#FEF3C7" stroke="#F59E0B" stroke-width="1.5"/><path d="M8 8h8M8 12h8M8 16h5" stroke="#9CA3AF" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.2A1.7 1.7 0 007.3 19a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H1a2 2 0 010-4h.2A1.7 1.7 0 003 7.3a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H8a1.7 1.7 0 001-1.5V1a2 2 0 014 0v.2a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V8a1.7 1.7 0 001.5 1h.2a2 2 0 010 4h-.2a1.7 1.7 0 00-1.5 1z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  user: `<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="8" r="4" fill="#CBD5E1"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="none" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

let pngMap = {};

export async function loadIconMap() {
  try {
    const res = await fetch('/assets/icons/icon-map.json');
    if (res.ok) {
      const data = await res.json();
      pngMap = data.icons || {};
    }
  } catch (e) {
    pngMap = {};
  }
}

export function getIcon(name, size = 24) {
  const png = pngMap[name];
  if (png) {
    return `<img src="${png}" width="${size}" height="${size}" alt="" onerror="this.style.display='none'" style="max-width:100%;max-height:100%;object-fit:contain;" />`;
  }
  return SVG_ICONS[name] || SVG_ICONS.window;
}

export function getIconAsImg(name, size = 24) {
  const png = pngMap[name];
  if (png) {
    const img = document.createElement('img');
    img.src = png; img.width = size; img.height = size; img.alt = '';
    img.onerror = () => { img.style.display = 'none'; };
    return img;
  }
  const div = document.createElement('div');
  div.innerHTML = SVG_ICONS[name] || SVG_ICONS.window;
  const svg = div.firstElementChild;
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  return svg;
}

export function registerIcon(name, svgOrUrl) {
  if (svgOrUrl.trim().startsWith('<svg')) SVG_ICONS[name] = svgOrUrl;
  else pngMap[name] = svgOrUrl;
}
