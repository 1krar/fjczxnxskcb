// Runs before styles to avoid a flash of the wrong theme; contains no personal data.
(() => {
  const key='course-dashboard-display-v1';
  const options={theme:['system','light','dark'],motion:['system','reduce'],textSize:['normal','large','larger','maximum']};
  const defaults={theme:'system',motion:'system',textSize:'normal'};
  const dark=window.matchMedia('(prefers-color-scheme: dark)'), motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  function read() {
    let saved; try { saved=JSON.parse(localStorage.getItem(key)||'{}'); } catch { saved={}; }
    return Object.fromEntries(Object.entries(options).map(([name,allowed])=>[name,allowed.includes(saved?.[name])?saved[name]:defaults[name]]));
  }
  function apply() {
    const value=read(), root=document.documentElement;
    root.dataset.theme=value.theme==='system'?(dark.matches?'dark':'light'):value.theme;
    root.dataset.motion=value.motion==='reduce'||motion.matches?'reduce':'normal';
    root.dataset.textSize=value.textSize;
    root.style.colorScheme=root.dataset.theme;
    const meta=document.querySelector('meta[name=theme-color]');
    if (meta) meta.content=root.dataset.theme==='dark'?'#0f172a':'#ffffff';
    window.dispatchEvent(new CustomEvent('display:changed'));
    return value;
  }
  function save(partial) {
    const next={...read(),...partial};
    for (const [name,allowed] of Object.entries(options)) if(!allowed.includes(next[name])) throw Error('显示选项无效，未保存');
    try { localStorage.setItem(key,JSON.stringify(next)); }
    catch { throw Error('显示设置暂时无法保存，请检查浏览器存储权限'); }
    return apply();
  }
  window.CourseDisplay=Object.freeze({read,save,apply});
  for(const media of [dark,motion]) media.addEventListener('change',apply);
  window.addEventListener('storage',event=>{if(!event.key||event.key===key)apply();});
  apply();
})();
