export function createVideo(ctx) {
  const root = document.createElement('div');
  root.className = 'video-player';
  const video = document.createElement('video');
  video.src = '/assets/media/os.mp4';
  video.controls = false;
  const controls = document.createElement('div');
  controls.className = 'video-controls';
  controls.innerHTML = `
    <button data-act="play">▶</button>
    <input type="range" min="0" max="100" value="0" />
    <button data-act="full">⛶</button>
  `;
  root.appendChild(video);
  root.appendChild(controls);

  const playBtn = controls.querySelector('[data-act="play"]');
  const range = controls.querySelector('input[type=range]');
  playBtn.addEventListener('click', () => {
    if (video.paused) { video.play(); playBtn.textContent = '⏸'; }
    else { video.pause(); playBtn.textContent = '▶'; }
  });
  video.addEventListener('timeupdate', () => {
    if (video.duration) range.value = (video.currentTime / video.duration) * 100;
  });
  range.addEventListener('input', () => {
    if (video.duration) video.currentTime = (range.value / 100) * video.duration;
  });
  controls.querySelector('[data-act="full"]').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else video.requestFullscreen?.();
  });
  return root;
}

export const VideoApp = {
  id: 'video',
  name: 'Video Player',
  icon: 'video',
  open() { return { title: 'Video Player', icon: 'video', width: 720, height: 460 }; },
  mount(ctx, win) { win.setContent(createVideo(ctx)); },
};
