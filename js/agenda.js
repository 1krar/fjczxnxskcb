import { getTodayStr, localDate, getDayName } from './time.js?v=20261021-8';
import { escapeText as esc, itemsForScope, itemTimeLabel } from './tasks-store.js?v=20261021-8';
import { readDailyData } from './daily-store.js?v=20261021-8';
import { readAgenda, scopedActivities, saveActivity, exportAgenda, mergeAgenda, validateAgenda, validateActivity, downloadFile } from './agenda-store.js?v=20261021-8';
import { at, addDate, clock, activityInterval, activityOnDate, checkActivity, buildReminders, marketReminders, tradingDay, exportCalendarEvents } from './agenda-model.js?v=20261021-8';
import { showCourseDetail } from './app.js?v=20261021-8';
import { segmentMarkup } from './course-segments.js?v=20261021-8';

let selectedDate = getTodayStr();
let displayedMonth = selectedDate.slice(0,7);
let compactWeek = false;
let notice = '';
export function selectAgendaDate(date) { selectedDate=date;displayedMonth=date.slice(0,7); }
let agendaCleanup = null;
export function cleanupAgenda() { agendaCleanup?.(); agendaCleanup=null; }
export function plannerContext(state, dm, date = getTodayStr()) {
  const data = readAgenda(), scope = { semester: dm.getSemesterInfo().semester, className: state.currentClass };
  return { date, data, scope, prefs: data.reminders, courses: dm.getCourses(state.currentClass), activities: scopedActivities(scope,data), tasks: itemsForScope(scope), profile: readDailyData().profile };
}
function monthDates(month) {
  const first = new Date(`${month}-01T12:00:00`), start = new Date(first);
  start.setDate(1-((first.getDay()+6)%7));
  const count = Math.ceil((((first.getDay()+6)%7)+new Date(first.getFullYear(),first.getMonth()+1,0).getDate())/7)*7;
  return Array.from({length:count},(_,index)=>addDate(localDate(start),index));
}
function activityLabel(item) { return item.status==='confirmed'?'已确认':item.status==='cancelled'?'已取消':'候选'; }
function warnings(issues) {
  return issues.length ? `<ul class="agenda-issues">${issues.map(issue=>`<li class="issue-${issue.type}">${esc(issue.text)}</li>`).join('')}</ul>` : '<p class="agenda-clear">在已记录的课程和确认活动中，尚未发现冲突。</p>';
}
export function renderAgenda(container,state,dm) {
  cleanupAgenda();
  let context;
  try { context=plannerContext(state,dm,selectedDate); }
  catch(error) {
    container.innerHTML=`<section class="agenda-panel"><h1>日程资料需要检查</h1><p role="alert">${esc(error.message)}</p><button type="button" class="btn" id="agenda-raw">下载日程原始数据</button></section>`;
    container.querySelector('#agenda-raw').onclick=()=>exportAgenda(true); return;
  }
  const {courses,activities,tasks,prefs,profile}=context;
  const dateCourses=courses.filter(course=>course.date===selectedDate);
  const dateActivities=activities.filter(item=>item.status!=='cancelled'&&activityOnDate(item,selectedDate));
  const dateTasks=tasks.filter(item=>!item.deletedAt&&!item.completedAt&&item.dueDate===selectedDate);
  const dateReminders=buildReminders(context).filter(item=>localDate(item.remindAt)===selectedDate);
  const dayRows=[];
  const checked=new Map();
  for(const item of activities.filter(item=>item.status!=='cancelled'))checked.set(item.id,checkActivity(item,courses,activities));
  for(const course of dateCourses)dayRows.push({time:course.startTime||'待定',sort:course.startDateTime?+course.startDateTime:Infinity,html:`<article class="agenda-item"><div class="agenda-time">${esc(course.startTime||'待定')}<small>${esc(course.endTime)}</small></div><div class="agenda-content"><button type="button" class="agenda-course" data-agenda-course="${esc(courses.indexOf(course))}">${esc(course.courseName)}<span>课程详情 →</span></button><p>${esc(course.location||'教室待核对')}</p>${segmentMarkup(course)}</div></article>`});
  for(const item of dateActivities) {
    const interval=activityInterval(item);
    const time=item.date<selectedDate?'跨天':item.startTime||'待定';
    dayRows.push({sort:interval.start?Math.max(+interval.start,+at(selectedDate,'00:00')):Infinity,html:`<article class="agenda-item"><div class="agenda-time">${esc(time)}<small>${esc(item.endTime)}</small></div><div class="agenda-content"><div class="agenda-title-line"><strong>${esc(item.title)}</strong><span class="agenda-tag">${activityLabel(item)}</span></div><p>${esc(item.location||'地点待核对')}${item.checkInTime?` · ${esc(item.checkInTime)}签到`:''}${item.endDate&&item.endDate!==item.date?` · 至${esc(item.endDate)}`:''}</p>${warnings(checked.get(item.id))}<button type="button" class="agenda-text-button" data-edit-activity="${esc(item.id)}">查看 / 修改</button></div></article>`});
  }
  for(const item of dateTasks)dayRows.push({sort:item.dueTime||item.windowStart?+at(item.dueDate,item.dueTime||item.windowStart):Infinity,html:`<article class="agenda-item"><div class="agenda-time">${esc(item.dueTime||item.windowStart||'未定时')}${item.windowEnd?`<small>${esc(item.windowEnd)}</small>`:''}</div><div class="agenda-content"><div class="agenda-title-line"><strong>${esc(item.text)}</strong><span class="agenda-tag">${item.needsConfirmation?'待核对':'日期事项'}</span></div><p>${esc([itemTimeLabel(item),item.location,item.nextStep||item.courseName||'日期节点，不占用全天'].filter(Boolean).join(' · '))}</p><a class="agenda-text-button" href="#/tasks">去待办处理 →</a></div></article>`});
  for(const item of activities.filter(item=>item.status!=='cancelled'&&item.registrationDate===selectedDate))dayRows.push({sort:item.registrationTime?+at(selectedDate,item.registrationTime):Infinity,html:`<article class="agenda-item"><div class="agenda-time">${esc(item.registrationTime||'未定时')}</div><div class="agenda-content"><strong>${esc(item.title)} · 报名截止</strong><p>报名节点，与活动时间分开记录。</p><button type="button" class="agenda-text-button" data-edit-activity="${esc(item.id)}">查看通知</button></div></article>`});
  const reminderRows=dateReminders.map(item=>`<article class="agenda-item agenda-reminder"><div class="agenda-time">${clock(item.remindAt)}</div><div class="agenda-content"><span class="agenda-tag">提前提醒</span><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div></article>`).join('');
  dayRows.sort((a,b)=>a.sort-b.sort);
  const pendingActivities=activities.filter(item=>!item.date&&item.status!=='cancelled');
  const pendingTasks=tasks.filter(item=>!item.deletedAt&&!item.completedAt&&!item.dueDate);
  const archive=[...activities].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const monthDays=monthDates(displayedMonth);
  const weekStart=addDate(selectedDate,-((new Date(`${selectedDate}T12:00`).getDay()+6)%7));
  const dates=compactWeek?Array.from({length:7},(_,index)=>addDate(weekStart,index)):monthDays;
  container.innerHTML=`<section class="agenda-page"><header class="agenda-heading"><div><h1>日程</h1><p>把课程、活动和提前准备放在同一天看。</p></div><button type="button" class="btn btn-primary" id="agenda-add">＋记活动</button></header>
    <nav class="agenda-view-switch" aria-label="课表视图"><a href="#/schedule">周课表</a><a href="#/agenda" aria-current="page">日历与日程</a><a href="#/reminders">提醒设置</a></nav>
    <p class="agenda-notice" role="status">${esc(notice)}</p>
    <div class="agenda-layout"><div><section class="agenda-panel agenda-calendar" aria-label="选择日程日期"><div class="agenda-month-heading"><button type="button" class="agenda-icon-button" id="agenda-prev" aria-label="${compactWeek?'上一周':'上个月'}">‹</button><h2>${esc(compactWeek?selectedDate.slice(0,7):displayedMonth).replace('-',' 年 ')} 月</h2><button type="button" class="agenda-icon-button" id="agenda-next" aria-label="${compactWeek?'下一周':'下个月'}">›</button></div><div class="agenda-calendar-tools"><button type="button" class="agenda-text-button" id="agenda-today">回到今天</button><button type="button" class="agenda-text-button" id="agenda-collapse">${compactWeek?'展开月历':'收为一周'}</button></div>
    <div class="agenda-week-labels" aria-hidden="true">${['一','二','三','四','五','六','日'].map(day=>`<span>${day}</span>`).join('')}</div><div class="agenda-date-grid" role="group" aria-label="日期">${dates.map(date=>{
      const hasCourses=courses.some(item=>item.date===date),active=activities.filter(item=>item.status!=='cancelled'&&activityOnDate(item,date)),due=tasks.some(item=>!item.deletedAt&&!item.completedAt&&item.dueDate===date)||activities.some(item=>item.status!=='cancelled'&&item.registrationDate===date);
      const risk=active.some(item=>checked.get(item.id)?.length);
      return `<button type="button" data-agenda-date="${date}" aria-pressed="${date===selectedDate}" ${date===getTodayStr()?'aria-current="date"':''} aria-label="${date}${hasCourses?'，有课':''}${active.length?`，${active.length}项活动`:''}${due?'，有日期事项':''}${risk?'，需核对':''}" class="agenda-date ${date.slice(0,7)!==displayedMonth?'other-month':''}"><span>${Number(date.slice(8))}</span><span class="agenda-date-marks" aria-hidden="true">${hasCourses||active.length||due?'<i></i>':''}${risk?'<b>!</b>':''}</span></button>`;
    }).join('')}</div><div class="agenda-legend"><span>● 有安排</span><span>! 需核对</span></div></section>
    ${pendingActivities.length+pendingTasks.length?`<details class="agenda-panel agenda-pending"><summary>待核对日期 ${pendingActivities.length+pendingTasks.length} 条</summary>${pendingActivities.slice(0,15).map(item=>`<button type="button" class="agenda-pending-item" data-edit-activity="${esc(item.id)}">${esc(item.title)}<span>补充日期 →</span></button>`).join('')}${pendingTasks.slice(0,10).map(item=>`<a class="agenda-pending-item" href="#/tasks">${esc(item.text)}<span>到待办核对 →</span></a>`).join('')}</details>`:''}</div>
    <section class="agenda-panel agenda-day" aria-label="所选日期安排"><header class="agenda-day-heading"><div><h2>${Number(selectedDate.slice(5,7))} 月 ${Number(selectedDate.slice(8))} 日 · 星期${getDayName(selectedDate)}</h2><p>${dateCourses.length} 次课 · ${dateActivities.length} 项活动 · ${dateTasks.length} 项日期事项</p></div><button type="button" class="agenda-text-button" id="agenda-export-ics">导出这天日历</button></header><div class="agenda-items">${dayRows.map(row=>row.html).join('')||'<p class="agenda-empty">这一天还没有记录安排，可以先记下活动或通知。课表无课不代表没有其他事情。</p>'}</div>${dateReminders.length?`<details class="agenda-day-reminders"><summary>这天的提前提醒（${dateReminders.length} 条）</summary>${reminderRows}</details>`:''}${prefs.market&&tradingDay(selectedDate)==='unknown'?'<p class="agenda-muted">这一天的交易日历尚未核对，未生成大A提醒。</p>':''}<p class="agenda-muted">核对依据：当前班级课表与本机已记录活动。截止和提醒时点不占用全天。</p></section></div>
    <details class="agenda-panel agenda-archive"><summary>全部活动与取消记录（${archive.length}）</summary>${archive.map(item=>`<div class="agenda-record"><div><strong>${esc(item.title)}</strong><p>${esc(item.date||'日期待核对')} · ${activityLabel(item)}</p></div><button type="button" class="agenda-text-button" data-edit-activity="${esc(item.id)}">查看 / 修改</button></div>`).join('')||'<p class="agenda-muted">还没有活动记录。</p>'}</details>
    <details class="agenda-panel agenda-backup"><summary>日程保存与备份</summary><p class="agenda-muted">活动和提醒设置保存在当前浏览器。与课表导入、个人待办和衣橱分别备份；本地与在线网站各自保存。</p><div class="agenda-actions"><button type="button" class="btn" id="agenda-backup">导出日程备份</button><label class="btn agenda-file-label">恢复日程备份<input type="file" id="agenda-restore" accept="application/json,.json" hidden></label></div><div id="agenda-import-preview" role="status"></div></details>
    <dialog class="capture-dialog activity-dialog" id="activity-dialog" aria-labelledby="activity-title"><form id="activity-form"><div class="capture-heading"><div><h2 id="activity-title">记活动</h2><p>先保存通知，时间不清楚可以留作候选。</p></div><button type="button" class="capture-close" aria-label="关闭活动">×</button></div>
    <label>活动名称<input name="title" maxlength="300" required></label><label>通知原文<textarea name="sourceText" maxlength="6000" rows="3" placeholder="粘贴QQ群通知；原文只保存在本机"></textarea></label>
    <div class="capture-fields"><label>开始日期<input type="date" name="date" min="2000-01-01" max="2100-12-31"></label><label>开始时间<input type="time" name="startTime"></label><label>结束日期（跨天时填写）<input type="date" name="endDate" min="2000-01-01" max="2100-12-31"></label><label>结束时间<input type="time" name="endTime"></label></div>
    <label>地点<input name="location" maxlength="300" placeholder="例如南区某教学楼"></label>
    <div class="capture-fields"><label>签到时间（当天）<input type="time" name="checkInTime"></label><label>状态<select name="status"><option value="candidate">候选，考虑参加</option><option value="confirmed">已确认参加</option><option value="cancelled">已取消 / 不参加</option></select></label><label>去程分钟<input type="number" name="travelBefore" min="0" max="180" placeholder="未知可留空"></label><label>回程分钟<input type="number" name="travelAfter" min="0" max="180" placeholder="未知可留空"></label><label>提前准备分钟（另加去程）<input type="number" name="reminderMinutes" min="1" max="1440" value="30" required></label></div>
    <details><summary>报名截止（可选）</summary><div class="capture-fields"><label>报名截止日期<input type="date" name="registrationDate" min="2000-01-01" max="2100-12-31"></label><label>报名截止时间<input type="time" name="registrationTime"></label></div></details>
    <div id="activity-conflicts" aria-live="polite"></div><p class="capture-hint">候选只供比较；确认参加后才计入其他活动的冲突核对。时间有冲突仍可保存，方便后续调整。</p><p class="personal-error" id="activity-error" role="alert"></p><div class="capture-footer"><button type="button" class="btn" id="activity-check">核对时间</button><button type="submit" class="btn btn-primary">保存活动</button></div></form></dialog></section>`;
  const refresh=()=>renderAgenda(container,state,dm);
  let editing=null, frozenScope=null;
  const dialog=container.querySelector('#activity-dialog'),form=container.querySelector('#activity-form');
  function open(item=null) {
    editing=item; frozenScope=item?{semester:item.semester,className:item.className}:context.scope; form.reset();
    form.elements.date.value=item?.date||selectedDate;
    for(const key of ['title','sourceText','date','endDate','startTime','endTime','location','checkInTime','status','travelBefore','travelAfter','reminderMinutes','registrationDate','registrationTime'])if(item)form.elements[key].value=item[key]??'';
    container.querySelector('#activity-title').textContent=item?'查看 / 修改活动':'记活动';
    container.querySelector('#activity-error').textContent='';container.querySelector('#activity-conflicts').innerHTML='';
    dialog.showModal();form.elements.title.focus();
  }
  function fields() { const values=Object.fromEntries(new FormData(form));for(const key of ['travelBefore','travelAfter'])values[key]=values[key]===''?null:Number(values[key]);values.reminderMinutes=Number(values.reminderMinutes);return {...values,...frozenScope}; }
  function preview() {
    try { const item=validateActivity({...fields(),status:'candidate',id:editing?.id||'preview',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});container.querySelector('#activity-conflicts').innerHTML=warnings(checkActivity(item,courses,activities));container.querySelector('#activity-error').textContent=''; }
    catch(error){container.querySelector('#activity-error').textContent=error.message;}
  }
  container.querySelector('#agenda-add').onclick=()=>open();
  container.querySelector('.capture-close').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  container.querySelector('#activity-check').onclick=preview;
  form.addEventListener('change',()=>{container.querySelector('#activity-conflicts').innerHTML='';});
  form.addEventListener('submit',event=>{event.preventDefault();try{saveActivity(fields(),editing?.id||'');dialog.close();notice='活动已保存；日程和冲突已更新。';refresh();}catch(error){container.querySelector('#activity-error').textContent=error.message;}});
  container.querySelectorAll('[data-edit-activity]').forEach(button=>button.onclick=()=>open(activities.find(item=>item.id===button.dataset.editActivity)));
  container.querySelectorAll('[data-agenda-course]').forEach(button=>button.onclick=()=>showCourseDetail(courses[Number(button.dataset.agendaCourse)]));
  container.querySelectorAll('[data-agenda-date]').forEach(button=>button.onclick=()=>{selectedDate=button.dataset.agendaDate;displayedMonth=selectedDate.slice(0,7);refresh();});
  for(const [id,direction]of [['agenda-prev',-1],['agenda-next',1]])container.querySelector(`#${id}`).onclick=()=>{if(compactWeek)selectedDate=addDate(selectedDate,direction*7);else{const value=new Date(`${displayedMonth}-01T12:00`);value.setMonth(value.getMonth()+direction);selectedDate=localDate(value);}displayedMonth=selectedDate.slice(0,7);refresh();};
  container.querySelector('#agenda-today').onclick=()=>{selectedDate=getTodayStr();displayedMonth=selectedDate.slice(0,7);refresh();};
  container.querySelector('#agenda-collapse').onclick=()=>{compactWeek=!compactWeek;refresh();};
  container.querySelector('#agenda-backup').onclick=()=>exportAgenda();
  container.querySelector('#agenda-restore').onchange=async event=>{
    const preview=container.querySelector('#agenda-import-preview');
    try { const file=event.target.files?.[0];if(!file)return;if(file.size>3*1024*1024)throw new Error('文件太大，请选择3MB以内的日程备份');const incoming=validateAgenda(JSON.parse(await file.text()));preview.replaceChildren();const message=document.createElement('p');message.textContent=`包含 ${incoming.activities.length} 条活动；确认后按编号合并较新的记录，当前提醒设置保持。`;const confirm=document.createElement('button');confirm.type='button';confirm.className='btn btn-primary';confirm.textContent='确认合并';confirm.onclick=()=>{try{const changed=mergeAgenda(incoming);notice=`恢复完成，合并 ${changed} 条活动。`;refresh();}catch(error){preview.textContent=error.message;}};preview.append(message,confirm); }
    catch(error){preview.textContent=error.message;}finally{event.target.value='';}
  };
  container.querySelector('#agenda-export-ics').onclick=()=>{
    const rows=dateCourses.filter(c=>c.startDateTime&&c.endDateTime).map(c=>({key:`course:${c.date}:${c.startSection}:${c.courseName}:${c.location}`,title:c.courseName,start:c.startDateTime,end:c.endDateTime,location:c.location,detail:c.segments.map(part=>`${part.startTime}—${part.endTime} ${part.kind==='break'?'课间':`第${part.section}节`}`).join('\n')}));
    for(const item of dateActivities.filter(item=>item.status==='confirmed')){const interval=activityInterval(item);rows.push({key:`activity:${item.id}`,title:item.title,...interval,location:item.location,detail:item.checkInTime?`${item.checkInTime}签到`:''});}
    const reminders=buildReminders(context);
    for(const item of marketReminders(selectedDate,dateCourses,prefs))rows.push({...item,end:new Date(Math.max(+item.end,+item.start+60000))});
    for(const item of dateTasks.filter(item=>!item.needsConfirmation)){if(item.dueTime){const start=at(item.dueDate,item.dueTime);rows.push({key:`task:${item.id}`,title:`截止：${item.text}`,start,end:new Date(+start+60000),detail:item.nextStep,transparent:true});}else rows.push({key:`task:${item.id}`,dateOnly:item.dueDate,title:`日期事项：${item.text}`,detail:'具体截止时间未设'+(item.nextStep?` · ${item.nextStep}`:'')});}
    for(const item of activities.filter(item=>item.status!=='cancelled'&&item.registrationDate===selectedDate&&item.registrationTime)){const start=at(selectedDate,item.registrationTime);rows.push({key:`registration:${item.id}`,title:`报名截止：${item.title}`,start,end:new Date(+start+60000),transparent:true});}
    const prefix=`${context.scope.semester}:${context.scope.className}:`;
    downloadFile(exportCalendarEvents(rows.map(row=>({...row,key:prefix+row.key})),reminders.map(item=>({...item,key:prefix+item.key}))),`日程-${selectedDate}.ics`,'text/calendar;charset=utf-8');
    container.querySelector('.agenda-notice').textContent='已导出。导入手机系统日历后，请检查提醒权限和提前时间；网页改动后需重新导出更新。';
  };
  const onStorage=event=>{if(!dialog.open&&(!event.key||['course-dashboard-agenda-v1','course-dashboard-personal-items-v1','course-dashboard-class-updates-v1'].includes(event.key)))refresh();};
  window.addEventListener('storage',onStorage);
  let lastDate=getTodayStr();
  const onTick=()=>{if(lastDate!==getTodayStr()){lastDate=getTodayStr();if(!dialog.open)refresh();}};
  document.addEventListener('app:tick',onTick);
  agendaCleanup=()=>{window.removeEventListener('storage',onStorage);document.removeEventListener('app:tick',onTick);if(dialog.open)dialog.close();};
  return cleanupAgenda;
}
