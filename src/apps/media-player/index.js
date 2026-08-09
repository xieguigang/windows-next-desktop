/**
 * 媒体播放器
 *
 * 模仿 Windows 10 Groove / Windows Media Player 的双面板布局：
 *   - 左侧：专辑封面、标题、艺术家、播放控件、进度条、音量、播放模式
 *   - 右侧：可视化频谱 + 播放列表
 *
 * 支持：本地 VFS 内的音视频文件、顺序/随机/单曲循环、键盘空格暂停、左右方向键换曲。
 *
 * 频谱用 Web Audio AnalyserNode（取 fftSize=512），60fps 渲染。
 */

import * as P from '../../core/fs/path-utils.js';
import { iconForExtension } from '../../ui/icons.js';

const PLAY_MODES = ['sequence', 'repeat-one', 'shuffle'];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
const VIDEO_EXTS = ['mp4', 'webm', 'ogv', 'mov', 'mkv', 'm4v'];

/**
 * 按扩展名判断媒体类型
 * @param {string} nameOrPath
 * @returns {'audio'|'video'}
 */
function kindOf(nameOrPath) {
  const ext = String(nameOrPath).split('.').pop().toLowerCase();
  return VIDEO_EXTS.includes(ext) ? 'video' : 'audio';
}

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./media-player.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'mp-root';
  root.innerHTML = `
    <div class="mp-left">
      <div class="mp-cover">
        <div class="mp-stage-audio">
          <div class="mp-cover-disc">
            <div class="mp-cover-center"></div>
          </div>
        </div>
        <div class="mp-stage-video">
          <video class="mp-video" preload="metadata" playsinline></video>
          <button class="mp-fullscreen" title="全屏">${fullscreenIcon()}</button>
        </div>
      </div>
      <div class="mp-meta">
        <div class="mp-title">未选择媒体</div>
        <div class="mp-artist">点击下方「添加文件」或拖入文件以开始</div>
      </div>
      <div class="mp-progress">
        <span class="mp-time-current">00:00</span>
        <div class="mp-progress-track">
          <div class="mp-progress-bar"></div>
          <div class="mp-progress-thumb"></div>
        </div>
        <span class="mp-time-total">00:00</span>
      </div>
      <div class="mp-controls">
        <button class="mp-btn mp-prev" title="上一首">${prevIcon()}</button>
        <button class="mp-btn mp-play" title="播放/暂停">${playIcon()}</button>
        <button class="mp-btn mp-next" title="下一首">${nextIcon()}</button>
        <button class="mp-btn mp-mode" title="播放模式"></button>
        <button class="mp-btn mp-volume" title="音量">${volumeIcon()}</button>
        <input class="mp-volume-slider" type="range" min="0" max="100" value="80" aria-label="音量">
      </div>
    </div>
    <div class="mp-right">
      <div class="mp-visualizer"><canvas></canvas></div>
      <div class="mp-playlist-head">
        <span class="mp-playlist-title">播放列表</span>
        <div>
          <button class="btn mp-add-file">添加文件</button>
          <button class="btn mp-import">从本机导入</button>
          <button class="btn mp-clear">清空</button>
        </div>
      </div>
      <div class="mp-playlist"></div>
    </div>`;
  ctx.root.appendChild(root);

  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  /** 视频元素在模板中预置，避免 replaceWith 破坏 DOM 结构后无法还原为音频态 */
  const video = root.querySelector('.mp-video');
  /** 当前媒体元素（audio 或 video），二者互斥 */
  let player = audio;

  const playlistEl = root.querySelector('.mp-playlist');
  const coverEl = root.querySelector('.mp-cover');
  const titleEl = root.querySelector('.mp-title');
  const artistEl = root.querySelector('.mp-artist');
  const progressBar = root.querySelector('.mp-progress-bar');
  const progressThumb = root.querySelector('.mp-progress-thumb');
  const trackEl = root.querySelector('.mp-progress-track');
  const currentTimeEl = root.querySelector('.mp-time-current');
  const totalTimeEl = root.querySelector('.mp-time-total');
  const playBtn = root.querySelector('.mp-play');
  const modeBtn = root.querySelector('.mp-mode');
  const volumeBtn = root.querySelector('.mp-volume');
  const volumeSlider = root.querySelector('.mp-volume-slider');
  const canvas = root.querySelector('canvas');

  /** @type {Array<{path:string, name:string, kind:'audio'|'video', url:string}>} */
  let tracks = ctx.settings.getLocal('tracks', []);
  let currentIndex = ctx.settings.getLocal('currentIndex', -1);
  let mode = ctx.settings.getLocal('mode', 'sequence');
  let volume = (ctx.settings.getLocal('volume', 0.8));

  volumeSlider.value = String(Math.round(volume * 100));
  applyModeBtn();

  // ── 频谱 ────────────────────────────────────────────
  let audioCtx = null;
  let analyser = null;
  let rafId = 0;
  /**
   * 每个媒体元素只能创建一次 MediaElementAudioSourceNode（Web Audio 规范约束），
   * 因此按元素缓存。旧实现只在首次调用时用当时的 player 建 source，
   * 切到 video 后 source 仍绑在 audio 上，导致视频无声且频谱不动。
   * @type {Map<HTMLMediaElement, MediaElementAudioSourceNode>}
   */
  const sourceNodes = new Map();

  /**
   * 确保当前 player 已接入分析器。
   * @param {HTMLMediaElement} el 目标媒体元素
   */
  function ensureAudioGraph(el) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) {
      audioCtx = new Ctx();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(audioCtx.destination);
    }
    // 自动播放策略可能让 AudioContext 处于 suspended，需在用户手势后恢复
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

    let node = sourceNodes.get(el);
    if (!node) {
      try {
        node = audioCtx.createMediaElementSource(el);
        sourceNodes.set(el, node);
      } catch {
        // 该元素已被其他上下文接管，放弃可视化但不影响播放
        return;
      }
    }
    // 断开旧连接再重连，避免多个元素同时灌入分析器
    for (const [, n] of sourceNodes) n.disconnect();
    node.connect(analyser);
  }

  function drawVisualizer() {
    if (!analyser) return;
    const ctx2 = canvas.getContext('2d');
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const w = canvas.width, h = canvas.height;
    const bars = 64;
    const step = Math.floor(buf.length / bars);
    analyser.getByteFrequencyData(buf);
    ctx2.clearRect(0, 0, w, h);
    const bw = w / bars;
    for (let i = 0; i < bars; i++) {
      const v = buf[i * step] / 255;
      const bh = v * h * 0.8;
      const x = i * bw + bw * 0.15;
      const grad = ctx2.createLinearGradient(0, h, 0, h - bh);
      grad.addColorStop(0, 'rgba(0,120,212,0.85)');
      grad.addColorStop(1, 'rgba(74,194,255,0.85)');
      ctx2.fillStyle = grad;
      ctx2.fillRect(x, h - bh, bw * 0.7, bh);
    }
    rafId = requestAnimationFrame(drawVisualizer);
  }

  // ── 播放列表 ─────────────────────────────────────────
  function renderPlaylist() {
    playlistEl.innerHTML = '';
    if (!tracks.length) {
      const empty = document.createElement('div');
      empty.className = 'mp-empty';
      empty.textContent = '播放列表为空，点击右上「添加文件」开始';
      playlistEl.appendChild(empty);
      return;
    }
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const row = document.createElement('div');
      row.className = 'mp-track';
      if (i === currentIndex) row.classList.add('is-active');
      row.innerHTML = `
        <span class="mp-track-num">${i + 1}</span>
        <span class="mp-track-icon">${iconForExtension(P.extname(t.path).slice(1))}</span>
        <span class="mp-track-name">${escapeHtml(t.name)}</span>
        <button class="mp-track-remove" aria-label="移除">×</button>`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.mp-track-remove')) return;
        playIndex(i);
      });
      row.querySelector('.mp-track-remove').addEventListener('click', () => {
        tracks.splice(i, 1);
        if (currentIndex === i) { stop(); currentIndex = -1; }
        else if (currentIndex > i) currentIndex--;
        saveState();
        renderPlaylist();
      });
      playlistEl.appendChild(row);
    }
  }

  function saveState() {
    // 剔除 blob URL：它只在本次会话有效，持久化后刷新即失效，
    // 会导致恢复的列表一播放就报错。播放时按 path 懒重建。
    ctx.settings.setLocal('tracks', tracks.map(({ path, name, kind }) => ({ path, name, kind })));
    ctx.settings.setLocal('currentIndex', currentIndex);
    ctx.settings.setLocal('mode', mode);
    ctx.settings.setLocal('volume', volume);
  }

  // ── 播放控制 ─────────────────────────────────────────
  function applyModeBtn() {
    modeBtn.dataset.mode = mode;
    modeBtn.innerHTML = ({
      'sequence': '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 6h11l-3-3 1.4-1.4L18 5.6l-3.6 4-1.4-1.4 3-3H5V6Zm0 12h11l-3 3 1.4 1.4L18 18.4l-3.6-4-1.4 1.4 3 3H5v-1Z" fill="currentColor"/></svg>顺序',
      'repeat-one': '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 6h11l-3-3 1.4-1.4L18 5.6l-3.6 4-1.4-1.4 3-3H5V6Zm0 12h11l-3 3 1.4 1.4L18 18.4l-3.6-4-1.4 1.4 3 3H5v-1Z" fill="currentColor"/><text x="12" y="14" text-anchor="middle" font-size="6" fill="currentColor">1</text></svg>单曲',
      'shuffle': '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M3 6h3l11 12h-3L3 6Zm15 0h3v3l-3-3Zm-3 0h3l-3 3V6ZM3 18h3l4-4-1.4-1.4L3 18Zm15 0h3v-3l-3 3Zm-3 0h3l-3-3v3Z" fill="currentColor"/></svg>随机',
    })[mode];
  }

  /**
   * 切换音频 / 视频舞台。两个容器都常驻 DOM，仅切换显隐，
   * 避免结构被破坏后无法还原。
   * @param {'audio'|'video'} kind
   */
  function setPlayerFor(kind) {
    const isVideo = kind === 'video';
    coverEl.classList.toggle('is-video', isVideo);
    // 切换前暂停另一个元素，防止两路声音重叠
    const other = isVideo ? audio : video;
    if (!other.paused) other.pause();
    player = isVideo ? video : audio;
  }

  /**
   * 取得可播放的 URL。持久化时不保存 blob URL（刷新后即失效），
   * 因此这里在首次播放时按需重建。
   * @param {{path:string,url?:string}} t
   */
  async function resolveUrl(t) {
    if (t.url) return t.url;
    t.url = await ctx.fs.createObjectURL(t.path);
    return t.url;
  }

  async function playIndex(i) {
    if (i < 0 || i >= tracks.length) return;
    const t = tracks[i];
    currentIndex = i;
    setPlayerFor(t.kind);

    let src;
    try {
      src = await resolveUrl(t);
    } catch (err) {
      ctx.notify.error(`无法读取 ${t.name}：${err?.message || err}`);
      return;
    }

    player.src = src;
    player.volume = volume;
    coverEl.classList.toggle('is-spinning', t.kind === 'audio');
    titleEl.textContent = t.name;
    artistEl.textContent = P.dirname(t.path);
    try {
      await player.play();
      ensureAudioGraph(player);
      if (!rafId) drawVisualizer();
      playBtn.innerHTML = pauseIcon();
    } catch (err) {
      ctx.notify.warning('播放失败：' + (err?.message || err));
    }
    saveState();
    renderPlaylist();
  }

  function stop() {
    player.pause();
    player.removeAttribute('src');
    player.load();
    coverEl.classList.remove('is-spinning', 'is-video');
    titleEl.textContent = '未选择媒体';
    artistEl.textContent = '';
    playBtn.innerHTML = playIcon();
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function toggle() {
    if (currentIndex < 0 && tracks.length) return playIndex(0);
    if (player.paused) {
      player.play().then(() => playBtn.innerHTML = pauseIcon()).catch(() => {});
      coverEl.classList.add('is-spinning');
    } else {
      player.pause();
      playBtn.innerHTML = playIcon();
      coverEl.classList.remove('is-spinning');
    }
  }

  function next() {
    if (!tracks.length) return;
    if (mode === 'shuffle') {
      let next = Math.floor(Math.random() * tracks.length);
      if (tracks.length > 1) while (next === currentIndex) next = Math.floor(Math.random() * tracks.length);
      playIndex(next);
    } else {
      const i = (currentIndex + 1) % tracks.length;
      playIndex(i);
    }
  }

  function prev() {
    if (!tracks.length) return;
    if (player.currentTime > 3) { player.currentTime = 0; return; }
    const i = (currentIndex - 1 + tracks.length) % tracks.length;
    playIndex(i);
  }

  /*
   * 媒体事件必须同时绑定到 audio 与 video 两个元素上。
   * 旧实现只绑在初始的 player（audio）上，切到视频后进度条、
   * 自动下一首、播放态图标全部失效。
   * 处理器内统一用 el === player 过滤，忽略非当前元素的事件。
   */
  for (const el of [audio, video]) {
    el.addEventListener('timeupdate', () => {
      if (el !== player) return;
      const cur = el.currentTime || 0;
      const total = el.duration || 0;
      currentTimeEl.textContent = fmt(cur);
      totalTimeEl.textContent = fmt(total);
      const pct = total ? (cur / total) * 100 : 0;
      progressBar.style.width = pct + '%';
      progressThumb.style.left = pct + '%';
    });
    el.addEventListener('loadedmetadata', () => {
      if (el === player) totalTimeEl.textContent = fmt(el.duration || 0);
    });
    el.addEventListener('ended', () => {
      if (el !== player) return;
      if (mode === 'repeat-one') {
        el.currentTime = 0;
        el.play().catch(() => {});
        return;
      }
      next();
    });
    el.addEventListener('error', () => {
      if (el !== player || !el.getAttribute('src')) return;
      ctx.notify.error('播放出错：' + (el.error?.message || '未知错误'));
    });
    el.addEventListener('play', () => {
      if (el !== player) return;
      playBtn.innerHTML = pauseIcon();
      if (el === audio) coverEl.classList.add('is-spinning');
    });
    el.addEventListener('pause', () => {
      if (el !== player) return;
      playBtn.innerHTML = playIcon();
      coverEl.classList.remove('is-spinning');
    });
  }

  // 视频全屏
  root.querySelector('.mp-fullscreen').addEventListener('click', () => {
    video.requestFullscreen?.().catch((err) => ctx.notify.warning('无法全屏：' + (err?.message || err)));
  });

  // 进度条拖动
  trackEl.addEventListener('pointerdown', (e) => {
    if (currentIndex < 0) return;
    const r = trackEl.getBoundingClientRect();
    const seek = (clientX) => {
      const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      if (player.duration) player.currentTime = p * player.duration;
    };
    seek(e.clientX);
    const onMove = (ev) => seek(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // 控件
  playBtn.addEventListener('click', toggle);
  root.querySelector('.mp-prev').addEventListener('click', prev);
  root.querySelector('.mp-next').addEventListener('click', next);
  modeBtn.addEventListener('click', () => {
    mode = PLAY_MODES[(PLAY_MODES.indexOf(mode) + 1) % PLAY_MODES.length];
    applyModeBtn();
    saveState();
  });
  volumeBtn.addEventListener('click', () => {
    volumeSlider.style.display = volumeSlider.style.display === 'block' ? 'none' : 'block';
  });
  volumeSlider.addEventListener('input', () => {
    volume = Number(volumeSlider.value) / 100;
    player.volume = volume;
    saveState();
  });

  root.querySelector('.mp-add-file').addEventListener('click', async () => {
    // pickFile 返回单个路径字符串（不是对象），且用 extensions 过滤扩展名
    const picked = await ctx.fs.pick({
      title: '添加媒体文件',
      path: ctx.fs.folders.music,
      extensions: [...AUDIO_EXTS, ...VIDEO_EXTS],
    });
    if (!picked) return;
    await addPaths([picked]);
  });

  // 从本机导入：VFS 内没有媒体文件时的主要入口
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.multiple = true;
  importInput.accept = 'audio/*,video/*';
  importInput.style.display = 'none';
  root.appendChild(importInput);

  root.querySelector('.mp-import').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const files = [...(importInput.files || [])];
    importInput.value = '';
    if (files.length) await importLocalFiles(files);
  });

  /**
   * 把本机文件写入 VFS 的音乐 / 视频目录后加入播放列表。
   * @param {File[]} files
   */
  async function importLocalFiles(files) {
    const paths = [];
    for (const f of files) {
      const kind = kindOf(f.name);
      const dir = kind === 'video' ? ctx.fs.folders.videos : ctx.fs.folders.music;
      const target = P.join(dir, f.name);
      try {
        await ctx.fs.writeFile(target, await f.arrayBuffer());
        paths.push(target);
      } catch (err) {
        ctx.notify.warning(`导入 ${f.name} 失败：${err?.message || err}`);
      }
    }
    if (paths.length) {
      await addPaths(paths);
      ctx.notify.success(`已导入 ${paths.length} 个媒体文件`);
    }
  }
  root.querySelector('.mp-clear').addEventListener('click', () => {
    tracks = [];
    currentIndex = -1;
    stop();
    renderPlaylist();
    saveState();
  });

  /**
   * 把 VFS 路径加入播放列表。
   * URL 采用懒加载：仅在真正播放时才 createObjectURL，
   * 避免一次性为整个列表创建 blob 造成内存浪费。
   * @param {string[]} paths
   */
  async function addPaths(paths) {
    let added = 0;
    for (const p of paths) {
      if (tracks.some((t) => t.path === p)) continue; // 去重
      tracks.push({ path: p, name: P.basename(p), kind: kindOf(p) });
      added++;
    }
    if (!added) return;
    renderPlaylist();
    saveState();
    if (currentIndex < 0 && tracks.length) await playIndex(0);
  }

  // 拖入文件
  root.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files') || e.dataTransfer?.types?.includes('application/x-wn-path')) {
      e.preventDefault();
    }
  });
  root.addEventListener('drop', async (e) => {
    e.preventDefault();
    // 来自资源管理器（自定义 type）
    const wnPath = e.dataTransfer.getData('application/x-wn-path');
    if (wnPath) {
      addFiles({ paths: [wnPath] });
      return;
    }
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) {
      for (const f of files) {
        const target = P.join(ctx.fs.folders.music, f.name);
        try {
          await ctx.fs.writeFile(target, await f.arrayBuffer());
        } catch { /* 可能已存在 */ }
      }
      addFiles({ paths: files.map((f) => P.join(ctx.fs.folders.music, f.name)) });
    }
  });

  // 键盘
  root.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      volume = Math.min(1, volume + 0.05);
      volumeSlider.value = String(Math.round(volume * 100));
      player.volume = volume;
      saveState();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      volume = Math.max(0, volume - 0.05);
      volumeSlider.value = String(Math.round(volume * 100));
      player.volume = volume;
      saveState();
    }
  });

  // 窗口聚焦时把媒体元素挂上，确保键盘事件能进入
  ctx.events.on('window:focused', () => {
    if (!ctx.window.isActive) return;
    if (!root.contains(document.activeElement)) {
      // 不抢焦点，避免输入框失焦
    }
  });

  renderPlaylist();
  if (currentIndex >= 0 && tracks[currentIndex]) playIndex(currentIndex);

  // 渲染画布尺寸
  ctx.observeResize(canvas, () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * window.devicePixelRatio;
    canvas.height = r.height * window.devicePixelRatio;
  });
  // 立即设一次
  queueMicrotask(() => {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * window.devicePixelRatio || r.width;
    canvas.height = r.height * window.devicePixelRatio || r.height;
  });

  ctx.onDispose(() => {
    cancelAnimationFrame(rafId);
    audioCtx?.close();
    audio.remove();
    video?.remove();
  });

  ctx.setPreviewProvider(() => {
    const t = tracks[currentIndex];
    return t ? `▶ ${t.name}` : '媒体播放器';
  });
}

function fmt(s) {
  if (!Number.isFinite(s)) return '00:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function playIcon() {
  return '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5l12 7-12 7V5Z" fill="currentColor"/></svg>';
}
function pauseIcon() {
  return '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 5h4v14H6V5Zm8 0h4v14h-4V5Z" fill="currentColor"/></svg>';
}
function prevIcon() {
  return '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 5h2v14H6V5Zm2.5 7L19 5v14L8.5 12Z" fill="currentColor"/></svg>';
}
function nextIcon() {
  return '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16 5h2v14h-2V5ZM5 19V5l10.5 7L5 19Z" fill="currentColor"/></svg>';
}
function volumeIcon() {
  return '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 9v6h4l5 4V5L7 9H3Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Z" fill="currentColor"/></svg>';
}