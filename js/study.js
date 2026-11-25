import { readStudyData, studyProfile, saveStudySettings, saveStudyOverride, saveStudyExcusalReasons, removeStudyOverride, rawStudyData } from './study-store.js?v=20261030-1';
import { applyEveningStudy, describeEveningStudy } from './study-model.js?v=20261030-1';
import { scopedActivities, readAgenda } from './agenda-store.js?v=20261030-1';
import { getTodayStr, getDayName } from './time.js?v=20261030-1';
import { addDate, activityOnDate } from './agenda-model.js?v=20261030-1';
import { escapeText as esc, validDate } from './tasks-store.js?v=20261030-1';
import { markFormSaved } from './refresh-guard.js?v=20261030-1';

const statuses={normal:'正常参加',other:'有其他安排',pending:'请假待确认',excused:'已请假'};
const drafts=new Map();
const download=(value,name)=>{const url=URL.createObjectURL(new Blob([value],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

export function renderStudy(container,state,dm) {
  const requested=state.routeParams?.get('date');let date=validDate(requested)?requested:getTodayStr(),data;
  try{data=readStudyData();}
  catch(error){container.innerHTML=`<section class="study-page"><h1>晚自习资料需要检查</h1><p role="alert">${esc(error.message)}</p><button type="button" class="btn" data-study-raw>下载原始资料</button></section>`;const button=container.querySelector('[data-study-raw]');button.onclick=()=>download(rawStudyData(),'晚自习-原始资料.json');return()=>{button.onclick=null;};}
  const info=dm.getSemesterInfo(),className=state.currentClass,profile=studyProfile(data,className);
  let activities=[];try{activities=scopedActivities({semester:info.semester,className},readAgenda());}catch{/* The separate activity store never blocks a study entry. */}
  container.innerHTML=`<section class="study-page"><header class="study-heading"><div><h1>晚自习</h1><p>19:00 开始 · 次日有课才安排</p></div><a href="#/schedule" class="daily-link">回到课表 →</a></header>
    <div class="study-date-navigation"><label>查看日期<input type="date" id="study-date" data-refresh-safe min="2000-01-01" max="2100-12-31" value="${date}"></label><div><button type="button" class="daily-text-button" data-study-day="-1" aria-label="前一天">‹</button><button type="button" class="daily-text-button" data-study-today>今天</button><button type="button" class="daily-text-button" data-study-day="1" aria-label="后一天">›</button></div></div>
    <p class="study-feedback" data-save-feedback role="status" id="study-feedback"></p>
    <section class="study-panel"><div id="study-day-summary"></div><form id="study-day-form"><label>这天怎么安排<select name="status">${Object.entries(statuses).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>
      <div class="study-fields"><label><span data-study-title-label>安排名称（可选）</span><input name="title" maxlength="160" placeholder="例如社团排练、比赛培训"></label><label>地点（可选）<input name="location" maxlength="200" placeholder="例如社团活动室"></label></div>
      <details class="study-extra"><summary>关联活动与备注</summary><label>关联已记录的活动<select name="activityId"><option value="">不关联，直接记安排</option></select></label><p class="daily-small" data-study-activity-note>活动的实际起止时间以日历记录为准。</p><label>备注（可选）<textarea name="note" rows="2" maxlength="500" placeholder="例如已向班委报备，或等待审批"></textarea></label></details>
      <p class="study-form-hint" data-study-status-hint></p><p class="personal-error" role="alert" data-study-error></p><div class="study-form-actions"><button type="submit" class="btn btn-primary">保存当天安排</button><button type="button" class="daily-text-button" data-study-reset>恢复每周规则</button></div></form></section>
    <details class="study-panel study-settings"><summary>每周规则 <span data-study-rule-label></span></summary><form id="study-settings-form"><label class="study-check"><input type="checkbox" name="enabled"${profile.enabled?' checked':''}> 启用每周晚自习规则</label><fieldset><legend>每周参加哪些天</legend><div class="study-weekdays">${[1,2,3,4,5,6,7].map(day=>`<label><input type="checkbox" name="weekday" value="${day}"${profile.weekdays.includes(day)?' checked':''}><span>周${'一二三四五六日'[day-1]}</span></label>`).join('')}</div></fieldset><label>常用地点（可选）<input name="location" maxlength="200" value="${esc(profile.location)}"></label><p class="daily-small">次日有课时才安排晚自习。可勾选参与规则的日期，课表已有课程时优先显示课程。</p><button type="submit" class="btn">保存每周规则</button></form></details>
    <details class="study-panel study-settings"><summary>快捷销假标签</summary><form id="study-reasons-form"><label>每行一个原因<textarea name="reasons" rows="4">${esc(profile.excusalReasons.join('\n'))}</textarea></label><p class="daily-small">最多 20 个标签，每个最多 24 字。保存后可在晚自习弹窗里选择。</p><p class="personal-error" role="alert" data-reasons-error></p><button type="submit" class="btn">保存快捷标签</button></form></details>
    <details class="study-backup"><summary>保存与备份</summary><p class="daily-small">晚自习规则和当天安排保存在当前浏览器。</p><button type="button" class="daily-text-button" data-study-download>下载晚自习备份</button></details></section>`;
  const $=selector=>container.querySelector(selector),form=$('#study-day-form'),message=$('#study-feedback'),error=$('[data-study-error]');
  let expectedDateStamp='',baselineSnapshot='',reasonsBaseline=profile.excusalReasons;
  const draftKey=()=>`${className}:${date}`;
  const values=()=>Object.fromEntries(new FormData(form));
  const snapshot=()=>JSON.stringify(['status','title','location','note','activityId'].map(key=>form.elements[key].value));
  function rememberDraft(){
    if(snapshot()===baselineSnapshot)drafts.delete(draftKey());
    else drafts.set(draftKey(),{values:values(),expectedDateStamp,baselineSnapshot});
  }
  function checkDateVersion(){
    if((studyProfile(readStudyData(),className).overrides[date]?.updatedAt||'')!==expectedDateStamp)throw Error('这一天已在另一页面修改。输入已保留，请先复制当前内容，再刷新此页核对。');
  }
  function statusHint(){const value=form.elements.status.value;form.elements.title.required=value==='other';$('[data-study-title-label]').textContent=value==='other'?'安排名称（必填）':'安排名称（可选）';$('[data-study-status-hint]').textContent=value==='excused'?'仅在你确认已经请假后选择；这里只保存你的记录。':value==='pending'?'尚未确认请假，日程仍会保留晚自习，方便提前处理。':value==='other'?'显示为晚间特殊安排；活动时间请按实际通知核对。':'显示正常晚自习，具体内容和地点可以留空。';}
  function preview(){
    const courses=dm.getCoursesByDate(className,date),options={sectionTimes:dm.getSectionTimes(),seasonRule:info.seasonRule,semesterInfo:info,studyData:data,className,nextDayCourses:dm.getCoursesByDate(className,addDate(date,1))};
    const rows=applyEveningStudy(courses,date,options).filter(course=>course.source==='evening-study'),description=describeEveningStudy(courses,date,options);
    const p=studyProfile(data,className),saved=p.overrides[date];
    const label=rows.length?(saved?.quickExcusal?'销假':saved?statuses[saved.status]:'正常参加'):description.blockedSections.length===2?'按课表参加课程':['当天未设置晚自习','次日课表无课'].includes(description.reason)?'无晚自习':'待核对';
    $('#study-day-summary').innerHTML=`<div class="study-summary-line"><h2>${Number(date.slice(5,7))}月${Number(date.slice(8))}日 · 周${getDayName(date)}</h2><span>${label}</span></div>${rows.map(row=>`<p class="study-summary-time">${esc(row.startTime)}—${esc(row.endTime)}<span>${row.startSection===row.endSection?`第${row.startSection}节`:`第${row.startSection}—${row.endSection}节`}</span></p>`).join('')}${description.reason?`<p class="daily-small">${esc(description.reason==='当天未设置晚自习'?'此日不在每周规则内；保存当天安排可以单独设置。':description.reason)}</p>`:''}${saved?.title?`<p class="study-saved-title">${esc(saved.title)}</p>`:''}`;
    $('[data-study-rule-label]').textContent=p.enabled?p.weekdays.length===7?'每天按次日课表判断':p.weekdays.map(day=>'周'+'一二三四五六日'[day-1]).join('、')||'未选择日期':'已关闭';
  }
  function fill(){
    const p=studyProfile(data,className),draft=drafts.get(draftKey()),saved=draft?.values||p.overrides[date]||{status:'normal',title:'',location:p.location,note:'',activityId:''};
    expectedDateStamp=draft?draft.expectedDateStamp:p.overrides[date]?.updatedAt||'';
    const linked=activities.filter(item=>item.status!=='cancelled'&&activityOnDate(item,date));
    form.elements.activityId.innerHTML='<option value="">不关联，直接记安排</option>'+linked.map(item=>`<option value="${esc(item.id)}">${esc(item.title)} · ${esc(item.startTime||'时间未定')}</option>`).join('')+(saved.activityId&&!linked.some(item=>item.id===saved.activityId)?`<option value="${esc(saved.activityId)}">原关联活动（当前不可用，保留记录）</option>`:'');
    for(const key of ['status','title','location','note','activityId'])form.elements[key].value=saved[key]||'';
    baselineSnapshot=draft?draft.baselineSnapshot:snapshot();
    $('#study-date').value=date;error.textContent='';statusHint();preview();
  }
  function changeDate(next){if(!validDate(next)){error.textContent='请选择有效日期';return;}if(next===date)return;const freshData=readStudyData();rememberDraft();data=freshData;date=next;state.routeParams?.set('date',date);history.replaceState(null,'','#/study?date='+date);fill();markFormSaved(form);if(drafts.has(draftKey()))form.dispatchEvent(new Event('input',{bubbles:true}));}
  const change=event=>{
    try{
      if(event.target.id==='study-date')changeDate(event.target.value);
      else if(event.target===form.elements.status)statusHint();
      else if(event.target===form.elements.activityId){const activity=activities.find(item=>item.id===event.target.value);if(activity){form.elements.title.value=activity.title.slice(0,160);form.elements.location.value=activity.location.slice(0,200);form.elements.status.value='other';statusHint();}}
    }catch(e){error.textContent=e.message;$('#study-date').value=date;}
  };
  const click=event=>{const button=event.target.closest('button');if(!button)return;try{if(button.hasAttribute('data-study-day'))changeDate(addDate(date,Number(button.dataset.studyDay)));else if(button.hasAttribute('data-study-today'))changeDate(getTodayStr());else if(button.hasAttribute('data-study-reset')){checkDateVersion();removeStudyOverride(className,date);drafts.delete(draftKey());data=readStudyData();fill();markFormSaved(form);message.textContent='这一天已恢复每周规则。';}else if(button.hasAttribute('data-study-download'))download(JSON.stringify(readStudyData(),null,2),`晚自习-备份-${getTodayStr()}.json`);}catch(e){error.textContent=e.message;}};
  const submit=event=>{event.preventDefault();error.textContent='';
    if(event.target.id==='study-reasons-form'){
      const editor=event.target,field=editor.elements.reasons,notice=editor.querySelector('[data-reasons-error]');
      notice.textContent='';
      try {
        const updated=saveStudyExcusalReasons(className,field.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean),reasonsBaseline);
        reasonsBaseline=updated.excusalReasons;
        field.value=reasonsBaseline.join('\n');
        data=readStudyData();markFormSaved(editor);message.textContent='快捷销假标签已保存。';
      }catch(e){notice.textContent=e.message;}
      return;
    }
    try{if(event.target===form){checkDateVersion();saveStudyOverride(className,date,values());drafts.delete(draftKey());data=readStudyData();expectedDateStamp=studyProfile(data,className).overrides[date]?.updatedAt||'';baselineSnapshot=snapshot();markFormSaved(form);preview();message.textContent='当天安排已保存，首页和课表会同步显示。';}else if(event.target.id==='study-settings-form'){const fields=new FormData(event.target);saveStudySettings(className,{enabled:fields.has('enabled'),weekdays:fields.getAll('weekday').map(Number),location:String(fields.get('location')).trim()});data=readStudyData();markFormSaved(event.target);preview();message.textContent='每周规则已保存，单独设置的日期继续保留。';}}catch(e){error.textContent=e.message;}};
  container.addEventListener('change',change);container.addEventListener('click',click);container.addEventListener('submit',submit);fill();
  return()=>{container.removeEventListener('change',change);container.removeEventListener('click',click);container.removeEventListener('submit',submit);};
}
