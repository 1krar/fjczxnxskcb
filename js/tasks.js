import { NOTE_SCENES, isPersistent, normalizeNoteRule, noteRuleLabel, notesForCourse } from './persistent-model.js?v=20261024-1';
import { renderContextNotes, mountNoteActions } from './context-notes.js?v=20261024-1';
import { KINDS, SOURCES, escapeText as esc, readItems, itemsForScope, saveItem, updateItemState, exportBackup, validateBackup, mergeBackup, dateLabel, isOverdue, sortItems, sortHomeItems, saveHomeOrder } from './tasks-store.js?v=20261024-1';
import { setupHoldSort } from './hold-sort.js?v=20261024-1';
import { getTodayStr } from './time.js?v=20261024-1';
import { setupCaptureAI } from './capture-ai.js?v=20261024-1';
import { homeModuleHeading, readHomeLayout, HOME_LAYOUT_KEY } from './home-layout.js?v=20261024-1';

let context = null;
let editingId = '';
let activeTab = 'open';
let search = '';
let courseFilter = '';
let notice = '';

function scope(state, dm) { return { semester: dm.getSemesterInfo().semester, className: state.currentClass }; }
function notify(message) {
  const target = document.getElementById('personal-feedback');
  target.textContent = message;
  target.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { target.hidden = true; }, 4500);
}

export function setupPersonalItems(state, dm, rerender, closeCourse) {
  context = { state, dm, rerender, closeCourse };
  const root = document.createElement('div');
  root.innerHTML = `
    <button type="button" class="quick-capture btn btn-primary" id="quick-capture"><span aria-hidden="true">＋</span> 记一下</button>
    <div id="personal-feedback" class="personal-feedback" role="status" aria-live="polite" hidden></div>
    <dialog id="capture-dialog" class="capture-dialog" aria-labelledby="capture-title">
      <form id="capture-form">
        <div class="capture-heading"><div><h2 id="capture-title">记一下</h2><p>先记住一句话，其他信息可以以后补。</p></div><button type="button" class="capture-close" aria-label="关闭记录">×</button></div>
        <label for="capture-text">要记住什么 <span class="capture-required">必填</span></label>
        <textarea id="capture-text" name="text" rows="4" maxlength="5000" required placeholder="例如：英语演讲稿下周交，具体日期再确认"></textarea>
        <label for="capture-course">关联课程</label><select id="capture-course" name="courseName"></select>
        <label class="capture-check"><input type="checkbox" id="capture-persistent" name="persistent"> 长期记着</label>
        <fieldset id="capture-note-options" class="capture-note-options" hidden><legend>在相关地方轻提醒</legend>
          <label>出现在哪里<select id="capture-note-scene" name="noteScene">${Object.entries(NOTE_SCENES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>
          <label data-note-field="place" hidden>教学楼关键词<input id="capture-note-place" name="notePlace" maxlength="300" placeholder="例如：艺新楼（匹配课表地点）"></label>
          <div class="capture-fields" data-note-field="time" hidden><label>开始<input type="time" id="capture-note-start" name="noteStart"></label><label>结束<input type="time" id="capture-note-end" name="noteEnd"></label></div>
          <label data-note-field="lead" hidden>课前多少分钟开始出现<input type="number" id="capture-note-lead" name="noteLead" min="0" max="180" step="1" value="20"></label>
          <div class="capture-note-days" role="group" aria-label="适用星期">${[1,2,3,4,5,6,0].map(day=>`<label><input type="checkbox" name="noteDay" value="${day}">周${'日一二三四五六'[day]}</label>`).join('')}</div>
          <p class="capture-hint">星期不选表示每天适用；关联课程或教学楼时，仍只跟随课表中匹配的课。时间段可跨过午夜，按开始的那天计算。</p>
          <p id="capture-note-hint" class="capture-hint" role="status"></p>
        </fieldset>
        <details id="capture-extra"><summary>补充日期、类别或来源 <span>可选</span></summary>
          <label>事项名称（可选）<input id="capture-summary" name="title" maxlength="300" placeholder="AI识别后自动填写，也可以自己改"></label>
          <div class="capture-fields">
            <label>类别<select id="capture-kind" name="kind">${Object.entries(KINDS).map(([key, value]) => `<option value="${key}">${value}</option>`).join('')}</select></label>
            <label>来源<select id="capture-source" name="source">${Object.entries(SOURCES).map(([key, value]) => `<option value="${key}">${value}</option>`).join('')}</select></label>
            <label><span id="capture-date-label">日期（截止或要记得的日期）</span><input type="date" id="capture-date" name="dueDate" min="2000-01-01" max="2100-12-31"></label>
            <label>具体时间（截止 / 提醒）<input type="time" id="capture-time" name="dueTime"></label>
            <label>这个时刻表示<select id="capture-time-role" name="timeRole"><option value="">未指定</option><option value="start">开始时间</option><option value="deadline">截止时间</option></select></label>
            <label>相关区间开始<input type="time" id="capture-window-start" name="windowStart"></label>
            <label>相关区间结束<input type="time" id="capture-window-end" name="windowEnd"></label>
            <label>地点<input id="capture-location" name="location" maxlength="300"></label>
            <label>课程或时间区间<input id="capture-context" name="timeContext" maxlength="500" placeholder="例如：第3、4节之间"></label>
          </div>
          <p id="capture-applied" class="capture-applied" role="status" hidden></p>
          <p class="capture-hint">相关区间会保留供查看，不自动视为作业截止。活动可在识别结果里另存为候选日程。</p>
          <label class="capture-check"><input type="checkbox" id="capture-confirm" name="needsConfirmation"> 这条通知还需要核对</label>
          <label for="capture-next">容易开始的下一步</label><input type="text" id="capture-next" name="nextStep" maxlength="1000" placeholder="例如：先打开老师发的作业要求">
        </details>
        <p class="capture-hint">原话会完整保留。日期由你选择；没确定的通知可以先标为待确认。</p>
        <p id="capture-error" class="personal-error" role="alert"></p>
        <div class="capture-footer"><span>保存在本机浏览器</span><button type="submit" class="btn btn-primary">保存</button></div>
      </form>
    </dialog>`;
  document.body.append(root);
  const dialog = document.getElementById('capture-dialog');
  dialog.querySelector('#capture-persistent').addEventListener('change', refreshNoteForm);
  dialog.querySelector('#capture-note-scene').addEventListener('change', refreshNoteForm);
  document.getElementById('quick-capture').addEventListener('click', () => openCapture());
  root.querySelector('.capture-close').addEventListener('click', () => dialog.close());
  document.getElementById('capture-date').addEventListener('change', event => {
    document.getElementById('capture-time').disabled = false;
  });
  document.getElementById('capture-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      saveItem({
        ...dialog.captureScope,
        reminderMode:form.has('persistent')?'persistent':'task',
        noteRule:form.has('persistent')?{scene:form.get('noteScene'),place:(form.get('notePlace')||'').trim(),startTime:form.get('noteStart')||'',endTime:form.get('noteEnd')||'',leadMinutes:Number(form.get('noteLead')??20),weekdays:form.getAll('noteDay').map(Number)}:normalizeNoteRule(),
        text: form.get('text').trim(), title:form.get('title').trim(),timeRole:form.get('timeRole'),courseName: form.get('courseName'),
        kind: form.get('kind'), source: form.get('source'), dueDate: form.get('dueDate'), dueTime: form.get('dueTime') || '',
        needsConfirmation: form.has('needsConfirmation'), nextStep: form.get('nextStep').trim(),
        location: form.get('location').trim(), timeContext: form.get('timeContext').trim(), referenceAt: dialog.captureReferenceAt || '',
        windowStart: form.get('windowStart') || '', windowEnd: form.get('windowEnd') || '',
      }, editingId);
      dialog.close();
      rerender();
      notify(editingId ? '已保存修改' : '已记下，查课表时也能看到');
    } catch (error) { document.getElementById('capture-error').textContent = error.message; }
  });
  setupCaptureAI(dialog, dm, rerender, notify);
  window.addEventListener('storage', event => {
    if (event.key === 'course-dashboard-personal-items-v1' || event.key === null) rerender();
  });
}

function refreshNoteForm() {
  const dialog=document.getElementById('capture-dialog'),on=dialog.querySelector('#capture-persistent').checked,scene=dialog.querySelector('#capture-note-scene').value;
  dialog.querySelector('#capture-note-options').hidden=!on;
  dialog.querySelector('#capture-note-options').disabled=!on;
  for(const field of dialog.querySelectorAll('[data-note-field]')) {
    field.hidden=!on||!({place:['place','prepare'],time:['time'],lead:['course','place']}[field.dataset.noteField].includes(scene));
    field.querySelectorAll('input').forEach(input=>input.disabled=field.hidden);
  }
  for(const id of ['capture-time','capture-time-role','capture-window-start','capture-window-end']) dialog.querySelector('#'+id).closest('label').hidden=on;
  dialog.querySelector('#capture-date-label').textContent=on?'仅在这个日期适用（留空则不限制日期）':'日期（截止或要记得的日期）';
  dialog.querySelector('#capture-note-hint').textContent={manual:'先保存原话。以后可修改关联，再让它出现在相关地方。',course:'请选择上方的关联课程。课程详情一直可查；临近上课和课间也会出现。',prepare:'请选择上方课程或填写教学楼关键词，在对应日期的出门准备中出现。',place:'按课表地点的关键词匹配。课程详情可查，临近上课时出现；不会读取你的位置。',time:'填写开始和结束时间；若选了关联课程，只在有这门课的当天显示。时间未填全就先保存，不猜测时段。',home:'在首页保留一行轻提示；不占用“要记得”的事项预览。'}[scene];
}

export function openCapture({ courseName = '', item = null } = {}) {
  if (!context) return;
  const { state, dm, closeCourse } = context;
  closeCourse();
  const dialog = document.getElementById('capture-dialog');
  const form = document.getElementById('capture-form');
  form.reset();
  editingId = item?.id || '';
  dialog.captureScope = item ? { semester: item.semester, className: item.className } : scope(state, dm);
  const names = [...new Set(dm.getCourses(dialog.captureScope.className).map(course => course.courseName))];
  const selected = item ? item.courseName : courseName;
  if (selected && !names.includes(selected)) names.push(selected);
  const select = document.getElementById('capture-course');
  select.innerHTML = `<option value="">先不关联课程</option>${names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
  select.value = selected;
  document.getElementById('capture-title').textContent = item ? '补充这条事项' : '记一下';
  document.getElementById('capture-text').value = item?.text || '';
  document.getElementById('capture-summary').value = item?.title || '';
  document.getElementById('capture-time-role').value = item?.timeRole || '';
  document.getElementById('capture-kind').value = item?.kind || 'task';
  document.getElementById('capture-source').value = item?.source || (selected ? 'oral' : 'other');
  document.getElementById('capture-date').value = item?.dueDate || '';
  document.getElementById('capture-time').value = item?.dueTime || '';
  document.getElementById('capture-time').disabled = false;
  document.getElementById('capture-confirm').checked = item ? item.needsConfirmation : false;
  document.getElementById('capture-location').value = item?.location || '';
  document.getElementById('capture-context').value = item?.timeContext || '';
  document.getElementById('capture-window-start').value = item?.windowStart || '';
  document.getElementById('capture-window-end').value = item?.windowEnd || '';
  document.getElementById('capture-applied').hidden = true;
  dialog.captureReferenceAt = item?.referenceAt || '';
  document.getElementById('capture-next').value = item?.nextStep || '';
  document.getElementById('capture-error').textContent = '';
  document.getElementById('capture-extra').open = !!item;
  const rule=normalizeNoteRule(item?.noteRule);
  document.getElementById('capture-persistent').checked = !!item&&isPersistent(item);
  for(const [key,value] of Object.entries({scene:rule.scene,place:rule.place,start:rule.startTime,end:rule.endTime,lead:rule.leadMinutes})) document.getElementById('capture-note-'+key).value=value;
  form.querySelectorAll('[name=noteDay]').forEach(input=>input.checked=rule.weekdays.includes(Number(input.value)));
  refreshNoteForm();
  dialog.showModal();
  dialog.resetAI(item);
  document.getElementById('capture-text').focus();
}

function itemCard(item, today, compact = false) {
  const overdue = isOverdue(item, today), persistent=isPersistent(item);
  return `<article class="personal-item ${item.completedAt ? 'is-complete' : ''}" data-personal-id="${esc(item.id)}">
    <div class="personal-item-main">
      <div class="personal-tags"><span>${persistent?'长期记着':esc(KINDS[item.kind])}</span>${persistent?`<span>${item.notePaused?'已暂停':item.noteHiddenOn===today?'今天已收起':'启用中'}</span>`:''}${item.courseName ? `<span>${esc(item.courseName)}</span>` : ''}</div>
      ${item.title?`<h2 class="personal-title">${esc(item.title)}</h2><details class="personal-source"><summary>原通知</summary><p class="personal-text">${esc(item.text)}</p></details>`:`<p class="personal-text">${esc(item.text)}</p>`}
      ${item.location || item.timeContext ? `<p class="daily-small">${esc([item.location, item.timeContext].filter(Boolean).join(' · '))}</p>` : ''}
      <div class="personal-meta"><span class="${overdue ? 'is-overdue' : ''}">${overdue ? '已过所设时间 · ' : ''}${esc(persistent?noteRuleLabel(item):dateLabel(item, today))}</span>${item.needsConfirmation && item.dueDate ? '<span>通知待核对</span>' : ''}<span>${esc(SOURCES[item.source])}</span></div>
      ${item.nextStep ? `<p class="personal-next">下一步：${esc(item.nextStep)}</p>` : ''}
    </div>
    <div class="personal-item-actions">
      ${item.deletedAt ? `<button type="button" data-item-action="restore">恢复</button>` : `
      <button type="button" data-item-action="${item.completedAt ? 'reopen' : 'complete'}">${item.completedAt ? '恢复' : persistent?'归档':'完成'}</button>
      <button type="button" data-item-action="edit">${persistent?'修改关联':'补充'}</button>
      ${persistent&&!item.completedAt?`<button type="button" data-item-action="${item.notePaused?'resume':'pause'}">${item.notePaused?'启用':'暂停'}</button><button type="button" data-item-action="${item.noteHiddenOn===today?'showToday':'hideToday'}">${item.noteHiddenOn===today?'今天恢复':'今天收起'}</button><button type="button" data-item-action="stopPersistent">改为普通事项</button>`:''}
      ${compact ? '' : '<button type="button" data-item-action="trash">移入回收站</button>'}`}
    </div>
  </article>`;
}

function attachItemActions(container, refresh) {
  container.addEventListener('click', event => {
    const button = event.target.closest('[data-item-action]');
    if (!button || !container.contains(button)) return;
    const id = button.closest('[data-personal-id]').dataset.personalId;
    try {
      if (button.dataset.itemAction === 'edit') {
        const item = readItems().find(row => row.id === id);
        if (!item) throw new Error('这条事项已不存在，请刷新后重试');
        openCapture({ item });
      } else {
        updateItemState(id, button.dataset.itemAction);
        refresh();
        notify({ complete: '已归入已完成，可在事项页恢复', reopen: '已恢复为未完成', trash: '已移入回收站，可以恢复', restore: '已恢复事项', pause:'已暂停，内容保留在长期记着中', resume:'已启用', hideToday:'今天已收起，明天恢复', showToday:'今天已恢复', stopPersistent:'已改为普通事项' }[button.dataset.itemAction]);
      }
    } catch (error) { notify(error.message); }
  });
}

function homeItemCard(item,today,tomorrow,sorting=false,index=0,total=1) {
  const title=item.title||item.text;
  const date=!item.dueDate?'日期未定':item.dueDate===today?'今天':item.dueDate===tomorrow?'明天':`${Number(item.dueDate.slice(5,7))}月${Number(item.dueDate.slice(8))}日${item.dueDate.slice(0,4)!==today.slice(0,4)?' · '+item.dueDate.slice(0,4):''}`;
  const clock=item.dueTime||item.windowStart||'';
  const role=item.timeRole==='deadline'?'截止':item.timeRole==='start'?'开始':'时间';
  const end=item.windowEnd&&clock===item.windowStart?item.windowEnd:'';
  const elapsed=isOverdue(item,today);
  return `<article class="personal-item home-personal-item" data-personal-id="${esc(item.id)}">
    <div class="home-personal-date"><span>${esc(date)}</span>${item.needsConfirmation?'<span class="home-personal-state">有待确认项</span>':elapsed?`<span class="home-personal-state">${item.timeRole==='deadline'?'已过截止':item.dueTime?'已到所设时间':'已过日期'}</span>`:''}<button type="button" class="home-drag-handle" data-drag-handle aria-pressed="false" aria-label="调整顺序：${esc(title)}" aria-describedby="home-order-help" title="长按拖动，或点击显示上移下移"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></button></div>
    <button type="button" class="home-personal-open" data-item-action="edit" aria-label="查看原通知与详情：${esc(title)}">
      <span class="home-personal-time"><span>${role}</span><strong>${esc(clock||'未定时')}</strong>${end?`<small>— ${esc(end)}</small>`:''}</span>
      <span class="home-personal-content"><strong class="personal-text">${esc(title)}</strong>
        ${item.location?`<span class="home-personal-fact"><span>地点</span><strong>${esc(item.location)}</strong></span>`:''}
        ${item.nextStep?`<span class="home-personal-fact"><span>准备</span><span>${esc(item.nextStep)}</span></span>`:''}
        ${item.courseName?`<span class="personal-meta">${esc(item.courseName)}</span>`:''}
      </span>
    </button>
    <button type="button" class="home-personal-complete" data-item-action="complete" aria-label="完成：${esc(title)}">完成</button>
    ${sorting?`<div class="home-order-steps"><button type="button" data-order-step="-1" ${index===0?'disabled':''} aria-label="上移：${esc(title)}">↑ 上移</button><button type="button" data-order-step="1" ${index===total-1?'disabled':''} aria-label="下移：${esc(title)}">↓ 下移</button></div>`:''}
  </article>`;
}

export function mountTodayItems(container, state, dm) {
  const block = document.createElement('section');
  block.className = 'personal-today';
  const slot = container.querySelector('#dash-personal-slot');
  const timeline = container.querySelector('.today-timeline-section, .today-empty-section');
  if (slot) slot.append(block);
  else container.insertBefore(block, timeline);
  block.innerHTML = `${homeModuleHeading('items','<button type="button" class="home-capture-button" data-today-capture>＋ 记一句</button>')}
    <div id="dash-items-content"><div class="home-order-toolbar"><span id="home-order-help" class="sr-only">临近时间优先 · 展开后可长按卡片拖动</span><button type="button" data-order-reset hidden>恢复按时间</button></div><div class="home-personal-list"></div><div class="home-order-more"></div></div><p class="home-order-status" role="status" aria-live="polite" aria-atomic="true"></p>`;
  const list=block.querySelector('.home-personal-list'),status=block.querySelector('.home-order-status');
  let limit=1,sorting=false,controller,minute=-1;
  const announce=message=>{status.textContent=message;};
  const activeItems=()=>itemsForScope(scope(state,dm)).filter(item=>!isPersistent(item)&&!item.completedAt&&!item.deletedAt);
  function renderList(now=new Date()) {
    controller?.destroy();
    try {
      let expanded=false;try{expanded=readHomeLayout(scope(state,dm)).expanded.items;}catch{ /* The layout controller displays preference errors without hiding records. */ }
      if(!sorting)limit=expanded?Math.max(10,limit):1;
      const items=sortHomeItems(activeItems(),now),shown=items.slice(0,limit),manual=items.some(item=>item.homeOrder!==null);
      const nearest=sortHomeItems(items,now,false).find(item=>!item.needsConfirmation&&item.dueDate&&+new Date(`${item.dueDate}T${item.dueTime||'23:59'}`)>=+now&&+new Date(`${item.dueDate}T${item.dueTime||'23:59'}`)<=+now+86400000);
      block.querySelector('#dash-items-count').textContent=`${items.length}条${manual&&nearest&&!shown.some(item=>item.id===nearest.id)?' · 另有临近事项':''}`;
      const today=getTodayStr(),tomorrow=new Date(`${today}T12:00`);tomorrow.setDate(tomorrow.getDate()+1);
      const tomorrowStr=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
      list.innerHTML=shown.length?shown.map((item,index)=>homeItemCard(item,today,tomorrowStr,sorting,index,shown.length)).join(''):'<p class="personal-muted personal-home-empty">还没有记录的事项，先记一句就好。</p>';
      block.querySelector('#home-order-help').textContent=manual?'手动顺序 · 长按卡片可调整':'临近时间优先 · 长按卡片拖动';
      block.querySelector('[data-order-reset]').hidden=!manual||!sorting;
      block.querySelector('[data-order-edit]').hidden=items.length<2&&!sorting;
      block.querySelector('[data-order-edit]').textContent=sorting?'完成事项排序':'事项排序';
      block.classList.toggle('is-sorting',sorting);
      block.querySelector('[data-home-toggle="items"]').setAttribute('aria-expanded',String(expanded||sorting));
      block.querySelector('.home-order-more').innerHTML=`${expanded&&items.length>shown.length?`<button type="button" data-order-more>再显示${Math.min(10,items.length-shown.length)}条</button>`:''}${sorting?'<button type="button" data-order-finish>完成排序</button>':''}${items.length&&(expanded||sorting)?`<a class="personal-view-all" href="#/tasks">全部事项 →</a>`:''}`;
      if(expanded||sorting)controller=setupHoldSort(list,{announce,onCommit:commit});
    }catch(error){list.innerHTML=`<p class="personal-error">${esc(error.message)}</p><a href="#/tasks">检查个人事项</a>`;}
  }
  function commit(ids,focusId) {
    saveHomeOrder(scope(state,dm),ids);renderList();
    const row=[...list.querySelectorAll('[data-personal-id]')].find(row=>row.dataset.personalId===focusId);
    row?.querySelector(sorting?'[data-drag-handle]':'[data-item-action="edit"]')?.focus({preventScroll:true});announce('已保存手动顺序，可随时恢复按时间排序。');
  }
  block.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    try{
      if(button.matches('[data-order-edit],[data-drag-handle],[data-order-finish]')){sorting=button.matches('[data-order-finish]')?false:button.matches('[data-drag-handle]')||!sorting;if(sorting)limit=Math.max(10,limit);const menu=button.closest('details');if(menu)menu.open=false;renderList();if(sorting)list.querySelector('[data-drag-handle]')?.focus({preventScroll:true});else block.querySelector('[data-home-toggle="items"]')?.focus({preventScroll:true});}
      else if(button.matches('[data-order-reset]')){saveHomeOrder(scope(state,dm));renderList();announce('已恢复按时间排序');}
      else if(button.matches('[data-order-more]')){limit+=10;renderList();}
      else if(button.matches('[data-order-step]')){
        const ids=[...list.querySelectorAll('[data-personal-id]')].map(row=>row.dataset.personalId),id=button.closest('[data-personal-id]').dataset.personalId,index=ids.indexOf(id),next=index+Number(button.dataset.orderStep);
        if(next>=0&&next<ids.length){[ids[index],ids[next]]=[ids[next],ids[index]];commit(ids,id);}
      }
    }catch(error){announce(error.message);}
  });
  block.querySelector('[data-today-capture]')?.addEventListener('click', () => openCapture());
  attachItemActions(block, () => context.rerender());
  renderList();
  const layoutChanged=()=>{sorting=false;renderList();};
  const storage=event=>{if(event.key===HOME_LAYOUT_KEY||event.key===null)layoutChanged();};
  window.addEventListener('home-layout:changed',layoutChanged);window.addEventListener('storage',storage);
  const tick=event=>{const now=event.detail?.now||new Date(),next=Math.floor(+now/60000);if(next!==minute){minute=next;if(!sorting&&!controller?.active&&!block.contains(document.activeElement)&&!document.getElementById('capture-dialog')?.open)renderList(now);}};
  document.addEventListener('app:tick',tick);
  return ()=>{controller?.destroy();document.removeEventListener('app:tick',tick);window.removeEventListener('home-layout:changed',layoutChanged);window.removeEventListener('storage',storage);};
}

export function mountCourseItems(container, course) {
  const section = document.createElement('section');
  section.className = 'course-personal';
  let items = [];
  let error = '', notes=[];
  try { notes=notesForCourse(itemsForScope({semester:context.dm.getSemesterInfo().semester,className:course.className}),course); items = sortItems(itemsForScope({ semester: context.dm.getSemesterInfo().semester, className: course.className }).filter(item => item.courseName === course.courseName && !isPersistent(item) && !item.completedAt && !item.deletedAt)); }
  catch (err) { error = err.message; }
  section.innerHTML = `<div class="personal-section-heading"><h3>这门课要记得</h3><button type="button" class="btn" data-course-capture>＋ 记一下</button></div>
    ${renderContextNotes(notes,'course-detail')}<p class="context-notes-status" data-notes-status role="status"></p>
    ${error ? `<p class="personal-error">${esc(error)}</p>` : items.length ? items.map(item => itemCard(item, getTodayStr(), true)).join('') : notes.length?'':'<p class="personal-muted">老师交代的作业、下次要带的东西，可以直接记在这里。</p>'}`;
  container.querySelector('.detail-body').append(section);
  section.querySelector('[data-course-capture]').addEventListener('click', () => openCapture({ courseName: course.courseName }));
  mountNoteActions(section,openCapture,()=>{section.remove();mountCourseItems(container,course);context.rerender();return container.querySelector('.course-personal')||container;});
  attachItemActions(section, () => { section.remove(); mountCourseItems(container, course); context.rerender(); });
}

export function renderTasks(container, state, dm) {
  const currentScope = scope(state, dm);
  let all;
  try { all = itemsForScope(currentScope); }
  catch (error) {
    container.innerHTML = `<section class="card personal-page"><h1>个人事项</h1><p class="personal-error">${esc(error.message)}</p><button type="button" class="btn" id="personal-raw-export">导出原始数据</button></section>`;
    container.querySelector('#personal-raw-export').addEventListener('click', () => { try { exportBackup(true); } catch (err) { notify(err.message); } });
    return;
  }
  const today = getTodayStr();
  if (!all.length) { activeTab = 'open'; search = ''; courseFilter = ''; }
  const courses = [...new Set(all.map(item => item.courseName).filter(Boolean))].sort();
  if (courseFilter && !courses.includes(courseFilter)) courseFilter = '';
  const counts = { notes:all.filter(item=>isPersistent(item)&&!item.completedAt&&!item.deletedAt).length, open: all.filter(item => !isPersistent(item) && !item.completedAt && !item.deletedAt).length, done: all.filter(item => item.completedAt && !item.deletedAt).length, trash: all.filter(item => item.deletedAt).length };
  container.innerHTML = `<div class="personal-page">
    <div class="personal-page-heading"><div><h1>个人事项</h1><p>先记一句，稍后补充</p></div><button type="button" class="btn btn-primary" id="personal-add">＋ 记一下</button></div>
    <div class="personal-tabs"${!all.length ? ' hidden' : ''} role="group" aria-label="事项状态">${[['open', '未完成'], ['notes','长期记着'], ['done', '已完成'], ['trash', '回收站']].map(([key, label]) => `<button type="button" data-personal-tab="${key}" aria-pressed="${activeTab === key}" class="${activeTab === key ? 'active' : ''}">${label} <span>${counts[key]}</span></button>`).join('')}</div>
    <div class="personal-filters"${!all.length ? ' hidden' : ''}><label>搜索<input type="search" id="personal-search" placeholder="搜索通知原话或下一步" value="${esc(search)}"></label><label>课程<select id="personal-course-filter"><option value="">全部课程与未关联事项</option>${courses.map(name => `<option value="${esc(name)}" ${courseFilter === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label></div>
    <div id="personal-list"></div>
    <details class="personal-backup card"><summary>保存与备份</summary><p>个人事项保存在当前浏览器，刷新后仍在。本地预览与在线网站各自保存；云同步尚未启用。换设备前可以导出备份。</p><p>备份包含所有班级、学期的个人事项，也包含长期记着、已完成和回收站中的记录。</p><div class="personal-backup-actions"><button type="button" class="btn" id="personal-export">导出备份</button><button type="button" class="btn" id="personal-import">恢复备份</button><input type="file" id="personal-import-file" accept=".json,application/json" hidden></div><div id="personal-import-preview" hidden></div><p id="personal-backup-message" role="status">${esc(notice)}</p></details>
  </div>`;
  function showList() {
    const filtered = sortItems(all.filter(item => (activeTab === 'trash' ? !!item.deletedAt : !item.deletedAt && (activeTab === 'done' ? !!item.completedAt : !item.completedAt && (activeTab==='notes'?isPersistent(item):!isPersistent(item)))) &&
      (!courseFilter || item.courseName === courseFilter) && (!search || `${item.title} ${item.text} ${item.location} ${item.nextStep} ${item.courseName}`.toLowerCase().includes(search.toLowerCase()))));
    const list = container.querySelector('#personal-list');
    list.innerHTML = filtered.length ? filtered.map(item => itemCard(item, today)).join('') : `<div class="personal-empty"><h2>${search || courseFilter ? '没有找到匹配的事项' : activeTab === 'done' ? '完成的事情会留在这里' : activeTab === 'trash' ? '回收站是空的' : activeTab==='notes'?'长期要记住的小事放在这里':'先记住一件小事'}</h2><p>${activeTab === 'open' && !search && !courseFilter ? '只写一句话就能保存，日期和课程都可以以后补。' : '可以调整筛选，或到其他状态中查看。'}</p></div>`;
  }
  showList();
  attachItemActions(container.querySelector('#personal-list'), () => renderTasks(container, state, dm));
  container.querySelector('#personal-add').addEventListener('click', () => openCapture());
  container.querySelectorAll('[data-personal-tab]').forEach(button => button.addEventListener('click', () => { activeTab = button.dataset.personalTab; renderTasks(container, state, dm); }));
  container.querySelector('#personal-search').addEventListener('input', event => { search = event.target.value; showList(); });
  container.querySelector('#personal-course-filter').addEventListener('change', event => { courseFilter = event.target.value; showList(); });
  const backupMessage = container.querySelector('#personal-backup-message');
  container.querySelector('#personal-export').addEventListener('click', () => { try { exportBackup(); backupMessage.textContent = '已生成个人事项备份。'; } catch (error) { backupMessage.textContent = error.message; } });
  const file = container.querySelector('#personal-import-file');
  const preview = container.querySelector('#personal-import-preview');
  container.querySelector('#personal-import').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    preview.hidden = true;
    backupMessage.textContent = '';
    try {
      const selected = file.files?.[0];
      if (!selected) return;
      if (selected.size > 8 * 1024 * 1024) throw new Error('备份过大，请选择8MB以内的个人事项文件');
      const incoming = validateBackup(JSON.parse(await selected.text()));
      preview.innerHTML = `<p>读到 ${incoming.items.length} 条事项。将按编号合并；已有的较新修改会保留。</p><button type="button" class="btn btn-primary">确认合并恢复</button>`;
      preview.hidden = false;
      preview.querySelector('button').addEventListener('click', () => {
        try { const result = mergeBackup(incoming); notice = `恢复完成：新增 ${result.added} 条，更新 ${result.updated} 条。`; renderTasks(container, state, dm); notify(notice); }
        catch (error) { backupMessage.textContent = error.message; }
      });
    } catch (error) { backupMessage.textContent = error instanceof SyntaxError ? '文件不是有效的 JSON 备份，未改动本机数据。' : error.message; }
    finally { file.value = ''; }
  });
}
