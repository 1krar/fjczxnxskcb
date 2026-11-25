import { notesForCourse, notesForMoment, isPersistent } from './persistent-model.js?v=20261030-1';
import { renderContextNotes, mountNoteActions } from './context-notes.js?v=20261030-1';
import { getTodayStr, getDayName, getCurrentWeek } from './time.js?v=20261030-1';
import { showCourseDetail } from './app.js?v=20261030-1';
import { formatLocation } from './location.js?v=20261030-1';
import { mountTodayItems, openCapture } from './tasks.js?v=20261030-1';
import { escapeText, itemsForScope } from './tasks-store.js?v=20261030-1';
import { courseKey, getCourseSummary, getTodayState, getFreeTimeInfo, formatMinutes } from './day-plan.js?v=20261030-1';
import { readHomeLayout, defaultHomeLayout, homeModuleHeading, mountHomeLayout, HOME_LAYOUT_KEY } from './home-layout.js?v=20261030-1';
import { renderUpcomingCourses, courseListCount, activeDayCourses, academicCourses } from './home-courses.js?v=20261030-1';
import { getDaySlots, courseSectionRange } from './day-slots.js?v=20261030-1';
import { readStudyData } from './study-store.js?v=20261030-1';
import { applyEveningStudy } from './study-model.js?v=20261030-1';
import { mountDailyAssistant } from './daily-widgets.js?v=20261030-1';
import { mountTodayAgenda } from './today-agenda.js?v=20261030-1';
import { nextDate } from './daily-model.js?v=20261030-1';

const esc = escapeText;
let tickHandler = null;
const STATE_ACCENTS = {
  NO_CLASS: 'muted',
  WEEKEND: 'muted',
  EARLY_MORNING: 'muted',
  BEFORE_FIRST_CLASS: 'before',
  IN_CLASS: 'primary',
  INTERNAL_BREAK: 'info',
  BREAK: 'info',
  LUNCH: 'warning',
  BEFORE_NEXT_CLASS: 'info',
  DAY_FINISHED: 'success',
  TIME_UNKNOWN: 'muted',
};

function scheduleForDate(dm,className,date,studyData) {
  const courses=dm.getCoursesByDate(className,date);
  return studyData?applyEveningStudy(courses,date,{sectionTimes:dm.getSectionTimes(),seasonRule:dm.getSemesterInfo().seasonRule,semesterInfo:dm.getSemesterInfo(),studyData,className,nextDayCourses:dm.getCoursesByDate(className,nextDate(date))}):courses;
}
function findNextClassDay(dm, className, today, studyData) {
  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const candidate=new Date(tomorrow);
  for(let days=0;days<14;days++,candidate.setDate(candidate.getDate()+1)){
    const date=`${candidate.getFullYear()}-${String(candidate.getMonth()+1).padStart(2,'0')}-${String(candidate.getDate()).padStart(2,'0')}`;
    const courses=activeDayCourses(scheduleForDate(dm,className,date,studyData));
    if(courses.length)return {date,weekday:getDayName(date),courses,isTomorrow:+candidate===+tomorrow};
  }
  const nextDate=dm.getCourses(className).map(course=>course.date).filter(date=>date>today).sort()[0];
  if(nextDate){const courses=activeDayCourses(scheduleForDate(dm,className,nextDate,studyData));if(courses.length)return{date:nextDate,weekday:getDayName(nextDate),courses,isTomorrow:false};}
  return null;
}

function getSemesterProgress(info) {
  const week = getCurrentWeek(info.semesterStart);
  const total = info.lastWeek;
  return { progress: Math.max(0, Math.min(100, week / total * 100)),
    label: week < info.firstWeek ? '学期未开始' : week > total ? '学期已结束' : `第${Math.max(1, Math.min(total, week))} / ${total}周` };
}

function countdownText(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return seconds < 60 ? `${seconds}秒` : hours ? `${hours}小时${minutes % 60 ? `${minutes % 60}分` : ''}` : `${minutes}分钟`;
}

function renderStatus(context, courses, nextDay, state) {
  const current=context.currentCourse, segment=context.currentSegment;
  const nextLesson=current?.segments?.find(part=>part.kind==='lesson'&&segment&&part.start>=segment.end);
  const nextCourse=context.nextCourse||nextDay?.courses[0];
  const room=course=>formatLocation(course.location,state.settings.showFullLocation)||(course.source==='evening-study'?'地点待确认':'教室待确认');
  const currentStudy=current?.source==='evening-study';
  const sameDay=nextCourse&&nextCourse!==nextDay?.courses[0];
  const studyName=nextCourse?.studyStatus==='other'?'晚间安排':'晚自习';
  const nextLabel=nextCourse?.source==='evening-study'?(sameDay?studyName:nextDay?.isTomorrow?'明日'+studyName:`${nextCourse.date.slice(5)} ${studyName}`)
    :sameDay?'下节课':nextDay?.isTomorrow?'明日首课':nextCourse?`${nextCourse.date.slice(5)} 下一次课`:'';
  const routeCourse=(course,html)=>`<button type="button" class="today-course-target" data-course-key="${esc(courseKey(course))}">${html}</button>`;
  const destination=(course,label,detail)=>`<div class="today-status-next"><span class="today-status-label">${esc(label)}</span>${routeCourse(course,`<strong>${esc(room(course))}</strong><span>${esc(detail)}</span>`)}</div>`;
  const upcoming=nextLesson?destination(current,'下一小节 · 原教室',`${nextLesson.startTime} 继续第${nextLesson.section}节`)
    :nextCourse?destination(nextCourse,nextLabel,`${nextCourse.startTime||'时间待确认'} · ${nextCourse.courseName}`):'';
  const later=nextLesson&&sameDay&&nextCourse?.source!=='evening-study'
    ?`<div class="today-status-later">${routeCourse(nextCourse,`<span>下节课 ${esc(nextCourse.startTime||'时间待确认')} · ${esc(room(nextCourse))}</span>`)}</div>`:'';
  const countdown=context.countdown!==null?`<strong class="today-time-left" id="dash-countdown">${countdownText(context.countdown)}</strong>`:'';
  const range=current&&courseSectionRange(current);
  const sectionText=range?(range.start===range.end?`第${range.start}节`:`第${range.start}–${range.end}节`):'';
  const lessonText=range&&segment?.kind==='lesson'?` · 当前第${segment.section-range.start+1}小节（当天第${segment.section}节）`:'';
  const clock=current?(segment?.kind==='break'
    ? `${current.endTime} 本次课结束`
    : [`${segment?.startTime||current.startTime} 上课 · ${segment?.endTime||current.endTime} 下课`,nextLesson?`${current.endTime} 本次课结束`:''].filter(Boolean).join(' · ')):'';
  const currentHTML=current?`<div class="today-status-current"><div class="today-status-line"><span class="today-status-label">${current.studyStatus==='other'?'晚间安排':segment?.kind==='break'?'课间':currentStudy?'正在晚自习':'正在上课'}</span>${countdown?`<span class="today-countdown-label">${segment?.kind==='break'?'距继续':'距下课'} ${countdown}</span>`:''}</div>${routeCourse(current,`<strong>${esc(current.courseName)}</strong>${nextLesson?'':`<span>${esc(room(current))}</span>`}`)}<p>${esc(sectionText+lessonText)}</p><p>${esc(clock)}</p></div>`:'';
  const unknown=context.state==='TIME_UNKNOWN'&&!current&&!nextCourse&&courses[0];
  return `${upcoming}${currentHTML}${later}${!current&&nextCourse&&context.nextCourse&&countdown?`<p class="today-status-countdown">距开课 ${countdown}</p>`:''}${!current&&!nextCourse?`<p class="today-status-label">${unknown?'课程时间待确认':context.state==='DAY_FINISHED'?'今日课程结束':'今天无课'}</p>${unknown?routeCourse(unknown,`<strong>${esc(unknown.courseName)}</strong><span>${esc(room(unknown))}</span>`):''}`:''}<div id="dash-course-notes"></div>`;
}

function renderOverview(courses, now, info) {
  const summary = getCourseSummary(courses);
  const free = getFreeTimeInfo(courses, now);
  const semester = getSemesterProgress(info);
  return `<details class="today-overview"><summary>今日概览与学期进度<span>${summary.sessionCount}次课 · ${summary.totalSections}节</span></summary>
    <div class="today-stats-row"><div class="stat-inline"><span class="stat-inline-label">上课次数</span><span class="stat-inline-value">${summary.sessionCount} 次</span></div>
    <div class="stat-inline"><span class="stat-inline-label">课程种类</span><span class="stat-inline-value">${summary.uniqueCourseCount} 门</span></div>
    <div class="stat-inline"><span class="stat-inline-label">节次</span><span class="stat-inline-value">${summary.totalSections} 节</span></div>
    <div class="stat-inline"><span class="stat-inline-label">教学时长</span><span class="stat-inline-value">${summary.totalHours} 小时</span></div></div>
    <div class="overview-gaps"><span>两次课间空档 <strong>${formatMinutes(free.totalMin)}</strong></span><span>最长一段 <strong>${formatMinutes(free.longestMin)}</strong></span><span>大课内短课间 <strong>${formatMinutes(free.internalBreakMin)}</strong></span></div>
    <p class="overview-note">空档仅统计今日相邻课程之间，不含首课前、末课后；尚未扣除吃饭、走路和个人安排。</p>
    <div class="today-semester"><div class="semester-week"><span>学期进度</span><span>${semester.label}</span></div><div class="semester-bar"><div class="semester-bar-fill" style="width:${semester.progress}%"></div></div></div></details>`;
}

export function renderDashboard(container, state, dm) {
  cleanupDashboard();
  const now = new Date();
  const today = getTodayStr();
  let studyData=null;try{studyData=readStudyData();}catch{/* The study settings page keeps recovery available. */}
  const plannedCourses=scheduleForDate(dm,state.currentClass,today,studyData);
  const courses=activeDayCourses(plannedCourses);
  const daySlots = getDaySlots({date:today,courses:plannedCourses,sectionTimes:dm.getSectionTimes(),seasonRule:dm.getSemesterInfo().seasonRule,semesterInfo:dm.getSemesterInfo()});
  const nextDay = findNextClassDay(dm, state.currentClass, today, studyData);
  const context = getTodayState(courses, now);
  const semester = getSemesterProgress(dm.getSemesterInfo());
  const scope={semester:dm.getSemesterInfo().semester,className:state.currentClass};
  const layout=()=>{try{return readHomeLayout(scope);}catch{return defaultHomeLayout();}};
  container.innerHTML = `<section class="today-page"><header class="today-header-row"><h1 class="today-date-sub"><a href="#/agenda" aria-label="打开日历与日程"><time datetime="${today}">${Number(today.slice(5, 7))}月${Number(today.slice(8))}日 · 星期${getDayName(today)}</time></a></h1><span class="today-week-badge">${semester.label}</span><button type="button" class="daily-restore" data-restore-advice hidden>恢复今日一句</button><div id="dash-advice-slot"></div></header><span class="sr-only" id="dash-advice-status" role="status" aria-live="polite"></span>
    <div class="today-priority"><div id="dash-books"></div><div id="dash-prep-slot"><a class="today-tomorrow-link" href="#/wardrobe?day=tomorrow"><strong>明日准备</strong><span>查看穿搭 <span aria-hidden="true">›</span></span></a></div><section class="today-status accent-${STATE_ACCENTS[context.state]}" id="dash-status" aria-label="当前课程与下一次安排">${renderStatus(context,courses,nextDay,state)}</section></div>
    <div class="today-body-grid"><div class="today-now-column"><div id="dash-planner-slot"></div><div id="dash-moment-notes"></div><p class="context-notes-status" data-notes-status role="status" aria-live="polite"></p><div class="home-modules" id="dash-home-modules"><section class="home-module" id="dash-personal-slot" data-home-module="items"></section><section class="home-module today-course-list" id="dash-course-list" data-home-module="courses"${!plannedCourses.length?' hidden':''}>${homeModuleHeading('courses')}<div id="dash-courses-content"><div class="today-timeline" id="dash-timeline">${renderUpcomingCourses(plannedCourses,now,state,layout().expanded.courses)}</div></div></section></div><p class="home-layout-status" id="dash-layout-status" role="status" aria-live="polite"></p></div>
    <div class="today-support-column">
    ${renderOverview(academicCourses(courses), now, dm.getSemesterInfo())}</div></div></section>`;
  const cleanupItems = mountTodayItems(container, state, dm);
  const cleanupAssistant = mountDailyAssistant(container, state, dm);
  const cleanupAgendaBrief = mountTodayAgenda(container, state, dm);
  const cleanupLayout = mountHomeLayout(container,scope);
  const noteItems=()=>{try{return itemsForScope(scope);}catch{return [];}};
  const noteMarkup=new Map();
  function noteSlot(selector,items) {
    const slot=container.querySelector(selector);if(!slot)return;
    const html=renderContextNotes(items,selector.slice(1));
    if(noteMarkup.get(slot)===html)return;
    const opened=slot.querySelector('details')?.open;
    slot.innerHTML=html;noteMarkup.set(slot,html);
    if(opened&&slot.querySelector('details'))slot.querySelector('details').open=true;
  }
  let booksMarkup='';
  function refreshBooks(time,items) {
    const rows=academicCourses(plannedCourses);
    const midday=daySlots.periods[3]?.end??new Date(`${today}T12:00:00`);
    const evening=daySlots.periods[7]?.end??new Date(`${today}T18:00:00`);
    const section=course=>courseSectionRange(course)?.start;
    const period=time<midday?'上午':time>=evening&&rows.some(course=>section(course)>=9)?'晚间':'下午';
    const selected=rows.filter(course=>period==='上午'?section(course)<=4:period==='晚间'?section(course)>=9:section(course)>=5&&section(course)<=8);
    selected.sort((a,b)=>section(a)-section(b));
    const untimed=rows.filter(course=>!section(course));
    const current=[...new Map([...selected,...untimed].map(course=>[course.courseName,course])).values()];
    const bring=items.filter(item=>item.kind==='bring'&&!isPersistent(item)&&!item.deletedAt&&!item.completedAt&&(!item.dueDate||item.dueDate===today));
    const other=bring.filter(item=>item.dueDate===today&&!rows.some(course=>course.courseName===item.courseName));
    const html=`<section class="today-books" aria-label="带书清单"><h2>带书清单</h2>
      <ul aria-label="${period}课程"><li class="today-books-period">${period}</li>${current.map(course=>{
        const names=[...new Set([...notesForCourse(items,course,{now:time,view:'prepare'}).filter(item=>item.kind==='bring'),...bring.filter(item=>item.courseName===course.courseName)].map(item=>item.text))];
        return `<li><button type="button" class="today-book-course" data-course-key="${esc(courseKey(course))}">${esc(course.courseName)}</button>${names.length?`<span>${names.map(esc).join('、')}</span>`:''}</li>`;
      }).join('')}${!current.length?'<li class="today-books-empty">无课</li>':''}${other.length?`<li class="today-books-extra">另带 ${other.map(item=>esc(item.text)).join('、')}</li>`:''}</ul></section>`;
    if(html===booksMarkup)return;
    const slot=container.querySelector('#dash-books'),key=slot.contains(document.activeElement)?document.activeElement.dataset.courseKey:'';
    slot.innerHTML=html;booksMarkup=html;
    if(key)[...slot.querySelectorAll('[data-course-key]')].find(node=>node.dataset.courseKey===key)?.focus({preventScroll:true});
  }
  function refreshNotes(time) {
    const items=noteItems(),value=getTodayState(courses,time),focus=value.currentCourse||value.nextCourse;
    refreshBooks(time,items);
    noteSlot('#dash-course-notes',notesForCourse(items,focus,{now:time,view:'focus'}));
    noteSlot('#dash-moment-notes',notesForMoment(items,time,dm.getCourses(state.currentClass)));
  }
  const cleanupNotes=mountNoteActions(container,openCapture);
  function refreshCourses(time) {
    const timeline=container.querySelector('#dash-timeline');
    const opened=new Set([...timeline.querySelectorAll('[data-course-detail][open]')].map(node=>node.dataset.courseDetail));
    const noteOpened=new Set([...timeline.querySelectorAll('[data-detail][open]')].map(node=>node.dataset.detail));
    const focused=timeline.contains(document.activeElement)?document.activeElement:null;
    const focusKey=focused?.closest('[data-course-detail]')?.dataset.courseDetail;
    const focusButtonKey=focused?.dataset.courseKey;
    timeline.innerHTML=renderUpcomingCourses(plannedCourses,time,state,layout().expanded.courses,opened,noteItems());
    timeline.querySelectorAll('[data-detail]').forEach(node=>node.open=noteOpened.has(node.dataset.detail));
    container.querySelector('#dash-courses-count').textContent=courseListCount(plannedCourses,time);
    if(plannedCourses.some(course=>course.source==='evening-study'))container.querySelector('[data-home-toggle="courses"] > span:first-child').textContent='后续安排';
    if (focusKey) {
      const row=[...timeline.querySelectorAll('[data-course-detail]')].find(node=>node.dataset.courseDetail===focusKey);
      if (row && !row.hidden) {
        if (focusButtonKey) [...row.querySelectorAll('[data-course-key]')].find(node=>node.dataset.courseKey===focusButtonKey)?.focus({preventScroll:true});
        else row.querySelector('summary')?.focus({preventScroll:true});
      } else container.querySelector('[data-home-toggle="courses"]').focus({preventScroll:true});
    }
  }
  refreshCourses(now);
  refreshNotes(now);
  const allCourses = [...plannedCourses, ...(nextDay?.courses || [])];
  const onClick = event => {
    const button = event.target.closest('[data-course-key]');
    if (!button || !container.contains(button)) return;
    const course = allCourses.find(item => courseKey(item) === button.dataset.courseKey);
    if (course) showCourseDetail(course);
  };
  container.addEventListener('click', onClick);
  let previousKey = stateKey(context),noteMinute=Math.floor(+now/60000);
  const handler = event => {
    const time = event.detail?.now || new Date();
    const next = getTodayState(courses, time);
    if (stateKey(next) !== previousKey) {
      previousKey = stateKey(next);
      const status = container.querySelector('#dash-status');
      const statusFocused = status.contains(document.activeElement);
      status.className = `today-status accent-${STATE_ACCENTS[next.state]}`;
      status.innerHTML = renderStatus(next,courses,nextDay,state);
      if (statusFocused) status.querySelector('.today-course-target, a')?.focus({ preventScroll: true });
      refreshCourses(time);
      refreshNotes(time);
    }
    const minute=Math.floor(+time/60000);
    if(minute!==noteMinute){noteMinute=minute;refreshNotes(time);}
    const countdown = container.querySelector('#dash-countdown');
    if (countdown && next.countdown !== null) countdown.textContent = countdownText(next.countdown);
  };
  const preferencesChanged = () => { previousKey = ''; handler({ detail:{ now:new Date() } }); };
  const layoutChanged=()=>refreshCourses(new Date());
  const notesChanged=()=>{refreshNotes(new Date());refreshCourses(new Date());};
  const notesStorage=event=>{if(event.key===null||event.key==='course-dashboard-personal-items-v1')notesChanged();};
  const layoutStorage=event=>{if(event.key===HOME_LAYOUT_KEY||event.key===null)layoutChanged();};
  tickHandler = handler;
  document.addEventListener('app:tick', handler);
  window.addEventListener('daily:changed', preferencesChanged);
  window.addEventListener('personal-items:changed',notesChanged);
  window.addEventListener('storage',notesStorage);
  window.addEventListener('home-layout:changed',layoutChanged);
  window.addEventListener('storage',layoutStorage);
  return () => {
    cleanupItems?.();
    cleanupAssistant();
    cleanupAgendaBrief();
    cleanupLayout();
    cleanupNotes();
    window.removeEventListener('personal-items:changed',notesChanged);
    window.removeEventListener('storage',notesStorage);
    document.removeEventListener('app:tick', handler);
    window.removeEventListener('daily:changed', preferencesChanged);
    window.removeEventListener('home-layout:changed',layoutChanged);
    window.removeEventListener('storage',layoutStorage);
    container.removeEventListener('click', onClick);
    if (tickHandler === handler) tickHandler = null;
  };
}

function stateKey(context) {
  return [context.state, context.currentSegment?.section, context.currentSegment?.nextSection, courseKey(context.currentCourse), courseKey(context.nextCourse), context.remainingCount].join('::');
}

export function cleanupDashboard() {
  if (tickHandler) document.removeEventListener('app:tick', tickHandler);
  tickHandler = null;
}
