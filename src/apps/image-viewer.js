export function createImageViewer(ctx) {
  const root = document.createElement('div');
  root.className = 'image-viewer';
  const img = document.createElement('img');
  img.alt = 'Image';
  img.onerror = () => { img.style.display = 'none'; root.querySelector('.iv-placeholder').style.display = 'grid'; };
  const placeholder = document.createElement('div');
  placeholder.className = 'iv-placeholder';
  placeholder.style.cssText = 'display:none;place-items:center;opacity:0.6';
  placeholder.textContent = 'Drop or open an image';
  const controls = document.createElement('div');
  controls.className = 'iv-controls';
  controls.innerHTML = `
    <button data-act="open">Open</button>
    <button data-act="zoom-in">+</button>
    <button data-act="zoom-out">-</button>
    <button data-act="reset">Reset</button>
  `;
  root.appendChild(img);
  root.appendChild(placeholder);
  root.appendChild(controls);

  let scale = 1;
  const setScale = (s) => { scale = s; img.style.transform = `scale(${scale})`; };

  controls.querySelector('[data-act="open"]').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files[0]; if (!f) return;
      img.src = URL.createObjectURL(f);
      img.style.display = 'block';
      placeholder.style.display = 'none';
      setScale(1);
    };
    input.click();
  });
  controls.querySelector('[data-act="zoom-in"]').addEventListener('click', () => setScale(scale * 1.2));
  controls.querySelector('[data-act="zoom-out"]').addEventListener('click', () => setScale(scale / 1.2));
  controls.querySelector('[data-act="reset"]').addEventListener('click', () => setScale(1));

  return root;
}

export const ImageViewerApp = {
  id: 'image-viewer',
  name: 'Image Viewer',
  icon: 'image',
  open() { return { title: 'Image Viewer', icon: 'image', width: 640, height: 480 }; },
  mount(ctx, win) { win.setContent(createImageViewer(ctx)); },
};
