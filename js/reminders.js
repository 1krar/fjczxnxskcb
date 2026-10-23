import { escapeText as esc } from './tasks-store.js?v=20261024-2';
import { getTodayStr, localDate } from './time.js?v=20261024-2';
import { readAgenda, saveReminderPrefs, MARKET_GROUPS } from './agenda-store.js?v=20261024-2';
import { plannerContext } from './agenda.js?v=20261024-2';
import { buildReminders, clock, MARKET_CALENDAR } from './agenda-model.js?v=20261024-2';

const DELIVERY_KEY='course-dashboard-reminder-delivery-v1';
let setup=false;
function readDelivery() { const raw=localStorage.getItem(DELIVERY_KEY);if(raw===null)return {};const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('提醒处理记录无法读取');return value; }
export function reminderIdentity(item,scope) { return [scope.semester,scope.className,item.key,item.start.toISOString(),item.remindAt.toISOString()].join('|'); }
export function activeReminders(items,scope,now,delivery={}) {
  return items.filter(item=>{
    const record=delivery[reminderIdentity(item,scope)];
    return item.remindAt<=now&&now<item.expires&&(!record||!['done','skip'].includes(record.action))&&(!record?.until||Date.parse(record.until)<=+now);
  }).sort((a,b)=>a.expires-b.expires);
}
export function setupReminders(state,dm) {
  if(setup)return;setup=true;
  const tray=document.createElement('section');tray.id='reminder-tray';tray.className='reminder-tray';tray.setAttribute('aria-label','提前准备提醒');tray.setAttribute('aria-live','polite');tray.hidden=true;
  document.querySelector('.page-container').before(tray);
  let current=null,scope=null,lastMinute='',signature='';
  function update(force=false,now=new Date()) {
    const minute=`${localDate(now)}:${now.getHours()}:${now.getMinutes()}:${state.currentClass}`;
    if(!force&&minute===lastMinute)return;lastMinute=minute;
    if(document.visibilityState==='hidden')return;
    try {
      const context=plannerContext(state,dm,localDate(now));scope=context.scope;
      const delivery=readDelivery(),all=buildReminders(context),active=activeReminders(all,scope,now,delivery);
      current=active[0]||null;
      if(!current){tray.hidden=true;signature='';return;}
      const id=reminderIdentity(current,scope),key=`${id}:${active.length}`;
      tray.hidden=false;
      if(key===signature)return;signature=key;
      const expanded=tray.dataset.currentId===id?tray.querySelector('details')?.open:+current.start-+now<=3600000;
      tray.dataset.currentId=id;
      tray.innerHTML=`<details class="reminder-disclosure"${expanded?' open':''}><summary><span class="agenda-tag">提前准备${active.length>1?` · 另有${active.length-1}条`:''}</span><strong>${esc(current.title)}</strong></summary><div class="reminder-copy"><p>${esc(current.detail)}</p></div><div class="reminder-actions"><button type="button" data-reminder-action="done">已处理</button><button type="button" data-reminder-action="snooze">5分钟后</button><button type="button" data-reminder-action="skip">跳过本次</button><a href="${current.type==='task'?'#/tasks':'#/agenda'}">${current.type==='task'?'查看事项':'看日程'}</a></div></details>`;
    } catch(error) {
      current=null;signature='';tray.hidden=false;tray.innerHTML=`<p role="status">提前提醒暂不可用：${esc(error.message)}</p><a href="#/agenda">检查日程资料</a>`;
    }
  }
  tray.addEventListener('click',event=>{
    const action=event.target.closest('[data-reminder-action]')?.dataset.reminderAction;if(!action||!current)return;
    try {
      const now=new Date(),delivery=readDelivery();
      delivery[reminderIdentity(current,scope)]={action,until:action==='snooze'?new Date(Math.min(+current.expires,+now+5*60000)).toISOString():'',savedAt:now.toISOString()};
      // Remove old delivery records; never touch actual user events.
      const recent=Object.entries(delivery).filter(([,value])=>value&&Date.parse(value.savedAt)>+now-35*86400000).slice(-1000);
      localStorage.setItem(DELIVERY_KEY,JSON.stringify(Object.fromEntries(recent)));signature='';update(true);
    }catch(error){tray.querySelector('.reminder-copy').textContent=`处理状态未保存：${error.message}`;}
  });
  document.addEventListener('app:tick',event=>update(false,event.detail?.now||new Date()));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')update(true);});
  for(const event of ['agenda:changed','courses:changed','personal-items:changed','daily:changed','storage','hashchange'])window.addEventListener(event,()=>update(true));
  update(true);
}

export function renderReminderSettings(container,state,dm) {
  let prefs;
  try { prefs=readAgenda().reminders; }
  catch(error){container.innerHTML=`<p role="alert">${esc(error.message)}</p><a href="#/agenda">检查日程资料 →</a>`;return;}
  const context=plannerContext(state,dm),today=getTodayStr();
  const preview=buildReminders({...context,date:today}).filter(item=>item.expires>new Date());
  container.innerHTML=`<section class="agenda-page"><header class="agenda-heading"><div><h1>提前提醒</h1><p>课程、活动、作业和大A节点各自预留准备时间。</p></div><a class="btn" href="#/agenda">看日程</a></header>
  <form class="agenda-panel agenda-settings" id="reminder-settings"><label class="agenda-check"><input type="checkbox" name="enabled" ${prefs.enabled?'checked':''}>开启页面内提前提醒</label>
  <p class="agenda-muted">网页打开且可见时显示；关掉网页或锁屏后的送达由系统日历负责。在日程页导出ICS后可导入手机日历，需检查手机提醒权限。</p>
  <div class="agenda-form-grid"><label>课程提前准备（分钟）<input name="courseLead" type="number" min="1" max="120" value="${prefs.courseLead}" required></label><label>有具体时刻的事项提前（小时）<input name="taskLeadHours" type="number" min="1" max="168" value="${prefs.taskLeadHours}" required></label></div>
  <label class="agenda-check"><input type="checkbox" name="dateOnlyReminder" ${prefs.dateOnlyReminder?'checked':''}>只有日期的已确认事项，在前一天提醒</label><label>前一天的提醒时间<input type="time" name="dateOnlyTime" value="${prefs.dateOnlyTime}" required></label>
  <p class="agenda-muted">课程另加生活偏好中的匹配路线和早餐时间；活动按其去程、签到和准备时间计算。只有日期的事项使用上述准备提醒，不把它当作具体截止时刻。待核对通知不会自动定时提醒。</p>
  <details class="reminder-market-settings"><summary>大 A 提前提醒${prefs.market?' · 已开启':' · 未开启'}</summary><fieldset><legend>提醒范围与时间</legend><label class="agenda-check"><input type="checkbox" name="market" ${prefs.market?'checked':''}>开启大A提前提醒</label><div class="agenda-option-list">${Object.entries(MARKET_GROUPS).map(([key,label])=>`<label class="agenda-check"><input type="checkbox" name="groups" value="${key}" ${prefs.groups.includes(key)?'checked':''}>${label}</label>`).join('')}</div>
  <div class="agenda-form-grid"><label>固定提前（分钟）<input name="marketLead" type="number" min="1" max="60" value="${prefs.marketLead}" required></label><label>最多提前到（分钟）<input name="maxEarly" type="number" min="1" max="120" value="${prefs.maxEarly}" required></label></div>
  <label class="agenda-check"><input type="checkbox" name="preferBreak" ${prefs.preferBreak?'checked':''}>固定提醒落在上课中时，优先挪到此前课间</label><p class="agenda-muted">只在“最多提前”窗口内查找课间。找不到就使用固定提前量；不会延到节点之后。相邻集合竞价与开收盘合并成一条。</p>
  <p class="agenda-muted">北京时间；内置交易日历覆盖至 ${MARKET_CALENDAR.through}，核对于 ${MARKET_CALENDAR.checkedAt}。超出覆盖年份暂停大A提醒，需更新日历。周末调班不会改变休市判断。<a href="${MARKET_CALENDAR.source}" target="_blank" rel="noopener">交易所休市公告</a></p></fieldset>
  </details><div class="settings-save-bar"><p id="reminder-error" class="personal-error" role="alert"></p><p id="reminder-saved" data-save-feedback role="status"></p><button type="submit" id="reminder-save" class="btn btn-primary">保存提醒设置</button></div></form>
  <section class="agenda-panel"><h2>今天接下来的提前提醒</h2><div id="reminder-preview">${preview.map(item=>`<div class="agenda-record"><div><strong>${clock(item.remindAt)} · ${esc(item.title)}</strong><p>${esc(item.detail)}</p></div></div>`).join('')||'<p class="agenda-muted">今天没有待到来的提醒；记录确认活动或补上事项截止时间后，会在这里出现。</p>'}</div></section></section>`;
  container.querySelector('#reminder-settings').onsubmit=event=>{
    event.preventDefault();const data=new FormData(event.currentTarget);
    try {saveReminderPrefs({enabled:data.has('enabled'),dateOnlyReminder:data.has('dateOnlyReminder'),dateOnlyTime:data.get('dateOnlyTime'),market:data.has('market'),preferBreak:data.has('preferBreak'),groups:data.getAll('groups'),...Object.fromEntries(['courseLead','taskLeadHours','marketLead','maxEarly'].map(key=>[key,Number(data.get(key))]))});renderReminderSettings(container,state,dm);container.querySelector('#reminder-saved').textContent='提醒设置已保存，预览已更新。';container.querySelector('#reminder-settings button[type=submit]').focus({preventScroll:true});}
    catch(error){container.querySelector('#reminder-error').textContent=error.message;}
  };
}
