export function createMusic(ctx) {
  const root = document.createElement('div');
  root.className = 'music-player';
  root.innerHTML = `
    <div class="music-cover">🎵</div>
    <div class="music-title">Welcome</div>
    <div class="music-artist">WindowsNext</div>
    <div class="music-progress"><div class="bar"></div></div>
    <div class="music-controls">
      <button data-act="prev">⏮</button>
      <button data-act="play">▶</button>
      <button data-act="next">⏭</button>
    </div>
    <input type="file" accept="audio/*" style="margin-top:12px;font-size:12px" />
  `;
  let audio = null;
  let playing = false;
  const titleEl = root.querySelector('.music-title');
  const artistEl = root.querySelector('.music-artist');
  const bar = root.querySelector('.bar');
  const playBtn = root.querySelector('[data-act="play"]');

  const toggle = () => {
    if (!audio) return;
    if (playing) { audio.pause(); playBtn.textContent = '▶'; }
    else { audio.play().catch(() => {}); playBtn.textContent = '⏸'; }
    playing = !playing;
  };

  root.querySelector('[data-act="play"]').addEventListener('click', toggle);
  root.querySelector('[data-act="prev"]').addEventListener('click', () => { if (audio) audio.currentTime = Math.max(0, audio.currentTime - 10); });
  root.querySelector('[data-act="next"]').addEventListener('click', () => { if (audio) audio.currentTime = Math.min(audio.duration, audio.currentTime + 10); });

  root.querySelector('input[type=file]').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (audio) { audio.pause(); audio = null; }
    audio = new Audio(URL.createObjectURL(f));
    titleEl.textContent = f.name.replace(/\.[^.]+$/, '');
    artistEl.textContent = 'Local file';
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) bar.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
    });
    audio.addEventListener('ended', () => { playBtn.textContent = '▶'; playing = false; });
    toggle();
  });
  return root;
}

export const MusicApp = {
  id: 'music',
  name: 'Multimedia Player',
  icon: 'music',
  open() { return { title: 'Multimedia Player', icon: 'music', width: 420, height: 480 }; },
  mount(ctx, win) { win.setContent(createMusic(ctx)); },
};
