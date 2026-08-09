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

export default async function mount(ctx) {
  ctx.injectStyleSheet(new URL('./media-player.css', import.meta.url).href);

  const root = document.createElement('div');
  root.className = 'mp-root';
  root.innerHTML = `
    <div class="mp-left">
      <div class="mp-cover">
        <div class="mp-cover-disc">
          <div class="mp-cover-center"></div>
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
          <button class="btn mp-clear">清空</button>
        </div>
      </div>
      <div class="mp-playlist"></div>
    </div>`;
  ctx.root.appendChild(root);

  const audio = document.createElement('audio');
  audio.crossOrigin = 'anonymous';
  audio.preload = 'metadata';
  /** @type {HTMLVideoElement|null} */
  let video = null;
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
  let sourceNode = null;
  let rafId = 0;

  function ensureAudioGraph() {
    if (audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    sourceNode = audioCtx.createMediaElementSource(player);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
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
    ctx.settings.setLocal('tracks', tracks);
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

  function setPlayerFor(kind) {
    if (kind === 'video') {
      if (!video) {
        video = document.createElement('video');
        video.preload = 'metadata';
        video.controls = false;
      }
      // 接管可视化画布旁的位置
      if (video.parentNode !== coverEl) {
        coverEl.querySelector('.mp-cover-disc')?.replaceWith(video);
        video.className = 'mp-cover-video';
      }
      player = video;
    } else {
      player = audio;
      if (video?.parentNode) video.remove();
      if (!coverEl.querySelector('.mp-cover-disc')) {
        const disc = document.createElement('div');
        disc.className = 'mp-cover-disc';
        disc.innerHTML = '<div class="mp-cover-center"></div>';
        coverEl.appendChild(disc);
      }
    }
  }

  async function playIndex(i) {
    if (i < 0 || i >= tracks.length) return;
    const t = tracks[i];
    currentIndex = i;
    setPlayerFor(t.kind);
    player.src = t.url;
    player.volume = volume;
    coverEl.classList.toggle('is-spinning', t.kind === 'audio');
    coverEl.classList.toggle('is-video', t.kind === 'video');
    titleEl.textContent = t.name;
    artistEl.textContent = P.dirname(t.path);
    try {
      await player.play();
      ensureAudioGraph();
      drawVisualizer();
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

  // 媒体事件
  player.addEventListener('timeupdate', () => {
    const cur = player.currentTime || 0;
    const total = player.duration || 0;
    currentTimeEl.textContent = fmt(cur);
    totalTimeEl.textContent = fmt(total);
    const pct = total ? (cur / total) * 100 : 0;
    progressBar.style.width = pct + '%';
    progressThumb.style.left = pct + '%';
  });
  player.addEventListener('ended', () => {
    if (mode === 'repeat-one') {
      player.currentTime = 0;
      player.play();
      return;
    }
    next();
  });
  player.addEventListener('error', () => {
    ctx.notify.error('播放出错：' + (player.error?.message || '未知错误'));
    next();
  });
  player.addEventListener('play', () => {
    playBtn.innerHTML = pauseIcon();
    coverEl.classList.add('is-spinning');
  });
  player.addEventListener('pause', () => {
    playBtn.innerHTML = playIcon();
    coverEl.classList.remove('is-spinning');
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
    const res = await ctx.fs.pick({ mode: 'open', multiple: true, accept: 'audio/*,video/*' });
    if (!res) return;
    addFiles(res);
  });
  root.querySelector('.mp-clear').addEventListener('click', () => {
    tracks = [];
    currentIndex = -1;
    stop();
    renderPlaylist();
    saveState();
  });

  async function addFiles(res) {
    const paths = res.paths || (res.path ? [res.path] : []);
    for (const p of paths) {
      const ext = P.extname(p).slice(1).toLowerCase();
      const kind = ['mp4', 'webm', 'ogv', 'mov', 'mkv'].includes(ext) ? 'video' : 'audio';
      try {
        const url = await ctx.fs.createObjectURL(p);
        tracks.push({ path: p, name: P.basename(p), kind, url });
      } catch (err) {
        ctx.notify.warning(`无法读取 ${P.basename(p)}`);
      }
    }
    renderPlaylist();
    saveState();
    if (currentIndex < 0 && tracks.length) playIndex(0);
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