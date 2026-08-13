export function createNotepad(ctx) {
  const { fs } = ctx;
  const root = document.createElement('div');
  root.className = 'notepad';
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(128,128,128,0.12);';
  toolbar.innerHTML = `
    <button data-act="open" style="padding:4px 12px;border-radius:6px;background:rgba(128,128,128,0.12)">Open</button>
    <button data-act="save" style="padding:4px 12px;border-radius:6px;background:rgba(128,128,128,0.12)">Save</button>
  `;
  const ta = document.createElement('textarea');
  ta.placeholder = 'Type here...';
  root.appendChild(toolbar);
  root.appendChild(ta);

  let currentPath = null;

  toolbar.querySelector('[data-act="open"]').addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.txt,.md,.js,.html,.css';
    input.onchange = async () => {
      const f = input.files[0]; if (!f) return;
      ta.value = await f.text();
      currentPath = null;
    };
    input.click();
  });

  toolbar.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const name = prompt('Save as file name:', currentPath ? currentPath.split('/').pop() : 'note.txt');
    if (!name) return;
    const path = `${fs.normalizeDocPath()}/${name}`;
    await fs.writeFile(path, ta.value);
    currentPath = path;
    alert('Saved to ' + path);
  });

  return root;
}

export const NotepadApp = {
  id: 'notepad',
  name: 'Notepad',
  icon: 'notepad',
  open() { return { title: 'Notepad', icon: 'notepad', width: 600, height: 420 }; },
  mount(ctx, win) { win.setContent(createNotepad(ctx)); },
};
