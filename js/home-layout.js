import { animateReorder } from './hold-sort.js?v=20261024-1';

export const HOME_LAYOUT_KEY = 'course-dashboard-home-layout-v1';
const modules = ['items','courses'];
const labels = { items:'要记得', courses:'后续课程' };
export const defaultHomeLayout = () => ({ order:[...modules], expanded:{ items:false, courses:true } });
const scopeKey = scope => JSON.stringify([scope.semester,scope.className]);
function readStore() {
  let raw;
  try { raw = localStorage.getItem(HOME_LAYOUT_KEY); }
  catch { throw Error('暂时无法读取首页偏好。'); }
  if (!raw) return { scopes:[] };
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value?.scopes) || value.scopes.length > 60 || value.scopes.some(row => typeof row?.key !== 'string' || !Array.isArray(row.order) || row.order.length !== 2 || new Set(row.order).size !== 2 || row.order.some(id => !modules.includes(id)) || modules.some(id => typeof row.expanded?.[id] !== 'boolean'))) throw Error();
    return value;
  } catch { throw Error('首页偏好暂不可读，原内容已保留；当前使用默认排版。'); }
}
export function readHomeLayout(scope) {
  const row = readStore().scopes.find(row => row.key === scopeKey(scope));
  return row ? { order:[...row.order], expanded:{...row.expanded} } : defaultHomeLayout();
}
export function saveHomeLayout(scope, change) {
  const store = readStore(), key = scopeKey(scope), old = readHomeLayout(scope);
  const value = { ...old, ...change, expanded:{...old.expanded,...change.expanded} };
  if (!Array.isArray(value.order) || value.order.length !== 2 || new Set(value.order).size !== 2 || value.order.some(id => !modules.includes(id)) || modules.some(id => typeof value.expanded[id] !== 'boolean')) throw Error('首页偏好无效，未改动排版。');
  const scopes = [...store.scopes.filter(row => row.key !== key),{key,...value}].slice(-60);
  try { localStorage.setItem(HOME_LAYOUT_KEY,JSON.stringify({scopes})); }
  catch { throw Error('首页偏好保存失败，排版未改动。'); }
  window.dispatchEvent(new CustomEvent('home-layout:changed',{detail:{key}}));
  return value;
}
export function homeModuleHeading(id, actions = '') {
  return `<div class="home-module-heading"><h2><button type="button" class="home-module-toggle" data-home-toggle="${id}" aria-expanded="${id==='courses'}" aria-controls="dash-${id}-content"><span>${labels[id]}</span><span class="home-module-count" id="dash-${id}-count"></span><span class="course-list-chevron" aria-hidden="true"></span></button></h2><div class="home-module-actions">${actions}<details class="home-module-menu"><summary aria-label="${labels[id]}模块操作">⋯</summary><div class="home-module-options"><button type="button" data-home-move="${id}"></button><button type="button" data-home-reset>恢复默认模块顺序</button>${id==='items'?'<button type="button" data-order-edit>事项排序</button>':''}</div></details></div></div>`;
}
export function mountHomeLayout(container,scope) {
  const root = container.querySelector('#dash-home-modules'), status = container.querySelector('#dash-layout-status');
  function apply() {
    let value = defaultHomeLayout();
    try { value = readHomeLayout(scope); }
    catch(error) { status.textContent = error.message; }
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const first = root.querySelector(`[data-home-module="${value.order[0]}"]`);
    if (first && first !== root.firstElementChild) animateReorder(root,()=>root.prepend(first));
    for (const id of modules) {
      const toggle = root.querySelector(`[data-home-toggle="${id}"]`), move = root.querySelector(`[data-home-move="${id}"]`);
      toggle?.setAttribute('aria-expanded',String(value.expanded[id]));
      if (toggle) toggle.title = value.expanded[id] ? `收起${labels[id]}，保留一条预览` : `展开${labels[id]}`;
      if (move) { move.textContent = `移到${labels[id==='items'?'courses':'items']}${value.order[0]===id?'下方':'上方'}`; move.disabled=!!root.querySelector(`[data-home-module="${id==='items'?'courses':'items'}"]`)?.hidden; }
    }
    if (focused && document.activeElement !== focused && focused.isConnected) focused.focus({preventScroll:true});
  }
  function click(event) {
    const button = event.target.closest('[data-home-toggle],[data-home-move],[data-home-reset]');
    if (!button || !root.contains(button)) return;
    const menu = button.closest('.home-module-menu'), returnFocus = menu?.querySelector('summary');
    try {
      const value = readHomeLayout(scope);
      if (button.dataset.homeToggle) {
        const id = button.dataset.homeToggle;
        saveHomeLayout(scope,{expanded:{[id]:!value.expanded[id]}});
      } else {
        if (menu) menu.open = false;
        saveHomeLayout(scope,{order:button.hasAttribute('data-home-reset')?[...modules]:value.order.slice().reverse()});
        returnFocus?.focus({preventScroll:true});
      }
      status.textContent = button.dataset.homeToggle ? '' : '模块顺序已保存。';
    } catch(error) { status.textContent = error.message; }
  }
  const escape = event => { if (event.key==='Escape') { const menu=event.target.closest('.home-module-menu[open]');if(menu){menu.open=false;menu.querySelector('summary').focus();} } };
  const storage = event => { if (event.key===HOME_LAYOUT_KEY || event.key===null) apply(); };
  root.addEventListener('click',click);root.addEventListener('keydown',escape);
  window.addEventListener('home-layout:changed',apply);window.addEventListener('storage',storage);apply();
  return () => { root.removeEventListener('click',click);root.removeEventListener('keydown',escape);window.removeEventListener('home-layout:changed',apply);window.removeEventListener('storage',storage); };
}
