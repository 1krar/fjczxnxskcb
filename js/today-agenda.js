import { getTodayStr } from './time.js?v=20261021-1';
import { readAgenda, scopedActivities } from './agenda-store.js?v=20261021-1';
import { activityInterval } from './agenda-model.js?v=20261021-1';
import { escapeText as esc } from './tasks-store.js?v=20261021-1';
export function mountTodayAgenda(container,state,dm) {
  const slot=container.querySelector('#dash-planner-slot');if(!slot)return ()=>{};
  let minute='';
  function render(now=new Date()) {
    try {const scope={semester:dm.getSemesterInfo().semester,className:state.currentClass};const next=scopedActivities(scope).filter(item=>item.status==='confirmed'&&item.date<=getTodayStr()&&(item.endDate||item.date)>=getTodayStr()).map(item=>({...item,...activityInterval(item)})).filter(item=>item.end>now).sort((a,b)=>a.start-b.start)[0];
      const html=next?`<div class="today-activity-brief"><a href="#/agenda"><div>${next.start<=now?'当前活动':'接下来活动'} · ${esc(next.title)}<span style="display:block">${esc(next.startTime)}—${esc(next.endTime)} · ${esc(next.location||'地点待核对')}</span></div><span>看日程 →</span></a></div>`:'';
      if(slot.innerHTML!==html)slot.innerHTML=html;
    }catch(error){slot.textContent=`日程暂不可读：${error.message}`;}
  }
  const onTick=event=>{const now=event.detail?.now||new Date();const key=`${getTodayStr()}:${now.getHours()}:${now.getMinutes()}`;if(key!==minute){minute=key;render(now);}};
  const onChange=()=>render();render();document.addEventListener('app:tick',onTick);window.addEventListener('agenda:changed',onChange);
  return ()=>{document.removeEventListener('app:tick',onTick);window.removeEventListener('agenda:changed',onChange);};
}
