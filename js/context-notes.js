import { escapeText as esc, readItems, updateItemState } from './tasks-store.js?v=20261023-4b';
import { noteRuleLabel } from './persistent-model.js?v=20261023-4b';

export function renderContextNotes(items,key='context') {
  if(!items.length)return '';
  return `<details class="context-notes" data-detail="notes-${esc(key)}"><summary><span class="context-note-label">常记</span><span class="context-note-preview">${esc(items[0].title||items[0].text)}</span>${items.length>1?`<span class="context-note-count">+${items.length-1}</span>`:''}<span class="course-list-chevron" aria-hidden="true"></span></summary><div class="context-note-body">${items.map(item=>`<article data-note-id="${esc(item.id)}"><p>${esc(item.text)}</p><small>${esc(noteRuleLabel(item))}</small><div class="context-note-actions"><button type="button" data-note-action="hideToday">今天收起</button><button type="button" data-note-action="pause">暂停</button><button type="button" data-note-action="edit">修改关联</button></div></article>`).join('')}</div></details>`;
}
export function mountNoteActions(container,onEdit,onChanged=()=>{}) {
  const click=event=>{
    const button=event.target.closest('[data-note-action]');
    if(!button||!container.contains(button))return;
    const id=button.closest('[data-note-id]').dataset.noteId,action=button.dataset.noteAction;
    const live=container.querySelector('[data-notes-status]');
    const parent=button.closest('.context-notes')?.parentElement;
    try{
      const item=readItems().find(row=>row.id===id);
      if(!item)throw new Error('这条记录已不存在，请刷新后重试');
      if(action==='edit'){onEdit({item});return;}
      updateItemState(id,action);
      const refreshed=onChanged()||container;
      const status=refreshed.querySelector('[data-notes-status]')||live;
      if(status)status.textContent=action==='pause'?'已暂停，可到个人事项的“长期记着”中恢复。':'今天已收起，明天恢复；可到“长期记着”中提前恢复。';
      const target=(parent?.isConnected?parent.querySelector('.context-notes > summary'):null)||refreshed.querySelector('[data-notes-focus], .status-course, [data-course-capture]');
      target?.focus({preventScroll:true});
    }catch(error){if(live)live.textContent=error.message;}
  };
  container.addEventListener('click',click);
  return ()=>container.removeEventListener('click',click);
}
