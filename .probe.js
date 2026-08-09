(()=>{
  const sr = document.querySelector('.window .window-host').shadowRoot;
  const sections = [...sr.querySelectorAll('.set-nav-item')].map(n => n.textContent);
  const active = sr.querySelector('.set-nav-item.is-active')?.textContent;
  return JSON.stringify({sections, active});
})()