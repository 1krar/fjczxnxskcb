import { notesForCourse, notesForMoment } from './persistent-model.js?v=20261029-5';
import { renderContextNotes, mountNoteActions } from './context-notes.js?v=20261029-5';
import { getTodayStr, getDayName, getCurrentWeek } from './time.js?v=20261029-5';
import { showCourseDetail } from './app.js?v=20261029-5';
import { formatLocation } from './location.js?v=20261029-5';
import { mountTodayItems, openCapture } from './tasks.js?v=20261029-5';
import { escapeText, itemsForScope } from './tasks-store.js?v=20261029-5';
import { courseKey, getCourseSummary, getTodayState, getFreeTimeInfo, formatMinutes } from './day-plan.js?v=20261029-5';
import { readHomeLayout, defaultHomeLayout, homeModuleHeading, mountHomeLayout, HOME_LAYOUT_KEY } from './home-layout.js?v=20261029-5';
import { renderUpcomingCourses, courseListCount, courseContinuation, renderUnassignedHint, activeDayCourses, academicCourses, studyStateText } from './home-courses.js?v=20261029-5';
import { getDaySlots } from './day-slots.js?v=20261029-5';
import { readStudyData } from './study-store.js?v=20261029-5';
import { applyEveningStudy } from './study-model.js?v=20261029-5';
import { mountDailyAssistant } from './daily-widgets.js?v=20261029-5';
import { mountTodayAgenda } from './today-agenda.js?v=20261029-5';
import { readDailyData } from './daily-store.js?v=20261029-5';
import { departurePlan } from './daily-model.js?v=20261029-5';
import { mountWeather } from './weather-widget.js?v=20261029-5';

const esc = escapeText;
let tickHandler = null;
const STATE_LABELS = {
  NO_CLASS: { label: '今日无课', accent: 'muted' },
  WEEKEND: { label: '周末无课', accent: 'muted' },
  EARLY_MORNING: { label: '夜间 · 今日准备', accent: 'muted' },
  BEFORE_FIRST_CLASS: { label: '今日首课', accent: 'before' },
  IN_CLASS: { label: '正在上课', accent: 'primary' },
  INTERNAL_BREAK: { label: '大课内课间', accent: 'info' },
  BREAK: { label: '课间', accent: 'info' },
  LUNCH: { label: '午间空档', accent: 'warning' },
  BEFORE_NEXT_CLASS: { label: '下一次课', accent: 'info' },
  DAY_FINISHED: { label: '今日课程结束', accent: 'success' },
  TIME_UNKNOWN: { label: '课程时间待确认', accent: 'muted' },
};

function scheduleForDate(dm,className,date,studyData) {
  const courses=dm.getCoursesByDate(className,date);
  return studyData?applyEveningStudy(courses,date,{sectionTimes:dm.getSectionTimes(),seasonRule:dm.getSemesterInfo().seasonRule,semesterInfo:dm.getSemesterInfo(),studyData,className}):courses;
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

function courseButton(course, state, segment = null) {
  if (!course) return '';
  const lesson = segment?.kind === 'lesson' ? segment : segment?.kind==='break' ? course.segments?.find(part=>part.kind==='lesson'&&part.start>=segment.end) : course.segments?.find(part => part.kind === 'lesson');
  const time = lesson ? `第${lesson.section}小节 · ${lesson.startTime}—${lesson.endTime}` : `${course.startTime || '时间待确认'}${course.endTime ? `—${course.endTime}` : ''}`;
  return `<button type="button" class="status-course" data-course-key="${esc(courseKey(course))}">
    <span class="status-title">${esc(course.courseName)}</span>
    <span class="status-meta">${esc(formatLocation(course.location, state.settings.showFullLocation) || (course.source==='evening-study'?'地点未设置':'教室待确认'))}${course.source==='evening-study'?` · ${esc(studyStateText(course))}`:''}</span>
    <span class="status-course-footer"><span class="status-section mono">${esc(time)}</span><span class="status-detail-hint">详情 <span aria-hidden="true">→</span></span></span>
  </button>`;
}

function renderStatus(context, courses, nextDay, state, now, daySlots) {
  const label = STATE_LABELS[context.state];
  const focus=context.currentCourse||context.nextCourse,study=focus?.source==='evening-study';
  const displayLabel=study?(focus.studyStatus==='other'?'晚间安排':context.state==='IN_CLASS'?'正在晚自习':context.state==='INTERNAL_BREAK'?'晚自习课间':'下一项 · 晚自习'):label.label;
  const current = context.state === 'IN_CLASS';
  const resting = ['NO_CLASS', 'WEEKEND', 'DAY_FINISHED', 'TIME_UNKNOWN'].includes(context.state);
  let content;
  if (resting) {
    content = context.state === 'TIME_UNKNOWN' ? `${courseButton(context.currentCourse||context.nextCourse||courses[0], state)}<a class="status-schedule-link" href="#/data">查看导入的时间信息 →</a>` : '';
    if (context.state !== 'TIME_UNKNOWN' && nextDay) {
      const nextCourse = nextDay.courses[0];
      content += `<h2 class="status-rest-title">${context.state === 'DAY_FINISHED' ? '今天的课上完了' : '今天无课'}</h2><div class="status-next-preview"><p class="next-day-info">${nextDay.isTomorrow ? '明日首课' : '下一有课日'} · ${esc(nextDay.date.slice(5))} 星期${nextDay.weekday}</p><button type="button" class="status-next-course" data-course-key="${esc(courseKey(nextCourse))}"><strong>${esc(nextCourse.courseName)}</strong><span>${esc(nextCourse.startTime || '时间待确认')} · ${esc(formatLocation(nextCourse.location, state.settings.showFullLocation) || '教室待确认')} <span aria-hidden="true">→</span></span></button></div>`;
    } else if (context.state !== 'TIME_UNKNOWN') {
      content = `<h2 class="status-rest-title">${context.state === 'DAY_FINISHED' ? '今天的课上完了' : '今天课表上没有课程'}</h2><p class="status-sub">也给自己的安排留一点时间。</p><a class="status-schedule-link" href="#/schedule">查看其他日期 →</a>`;
    }
  } else {
    const course = context.currentCourse || context.nextCourse;
    content = courseButton(course, state, context.currentSegment);
    if (context.state === 'EARLY_MORNING') content += '<p class="status-sub">夜里先把需要的东西准备好，临近上课时再看倒计时。</p>';
  }
  const countdown = !resting && context.state !== 'EARLY_MORNING' && context.countdown !== null ? `<div class="status-countdown"><span>${study?(current?'距本时段结束':context.state==='INTERNAL_BREAK'?'距继续':'距开始'):current ? '距本小节下课' : context.state === 'INTERNAL_BREAK' ? '距继续上课' : '距开课'}</span><strong id="dash-countdown">${countdownText(context.countdown)}</strong></div>` : '';
  let support = '';
  if (context.state === 'INTERNAL_BREAK') support = `<p class="status-action-line">课间休息 · ${esc(context.currentSegment.endTime)}继续第${context.currentSegment.nextSection}小节</p>`;
  else if (current) support = `<div class="status-progress-mini" aria-hidden="true"><div class="status-progress-mini-fill" id="dash-progress" style="width:${progressPercent(context.currentCourse, now, context.currentSegment)}%"></div></div>`;
  else if (!resting && context.nextCourse) {
    try {
      const plan = departurePlan(context.nextCourse, readDailyData().profile, context.prevCourse);
      if (plan) support = `<p class="status-action-line"><strong>${esc(plan.clock)} 建议出发</strong><span>按你的路线预算估算</span></p>`;
    } catch { /* Course time stays available when optional daily preferences cannot be read. */ }
  }
  const continuation=!resting?courseContinuation(context.currentCourse||context.nextCourse,context.currentSegment,now):'';
  return `<div class="status-main${resting ? ' is-resting' : ''}${study?' is-study':''}">${resting && context.state!=='TIME_UNKNOWN'?'':`<div class="status-heading"><div class="status-tag accent-${label.accent}">${displayLabel}</div></div>`}<div class="status-focus-row${countdown ? ' has-countdown' : ''}"><div class="status-course-info">${content}</div>${countdown}</div>${support}${continuation?`<p class="status-continuation">${esc(continuation)}</p>`:''}${study&&(focus.studyNote||focus.note)?`<p class="status-study-note">${esc(focus.studyNote||focus.note)}</p>`:''}</div><div id="dash-unassigned-hint">${renderUnassignedHint(daySlots, now)}</div><div id="dash-course-notes"></div>`;
}

function progressPercent(course, now, segment) {
  const start = segment?.kind === 'lesson' ? segment.start : course.startDateTime;
  const end = segment?.kind === 'lesson' ? segment.end : course.endDateTime;
  const duration = end - start;
  return duration > 0 ? Math.max(0, Math.min(100, (now - start) / duration * 100)) : 0;
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
  container.innerHTML = `<section class="today-page"><div id="dash-advice-slot"></div><header class="today-header-row"><h1 class="today-date-sub"><a href="#/agenda" aria-label="打开日历与日程"><time datetime="${today}">${Number(today.slice(5, 7))}月${Number(today.slice(8))}日 · 星期${getDayName(today)}</time></a></h1><span class="today-week-badge">${semester.label}</span><button type="button" class="daily-restore" data-restore-advice hidden>恢复今日一句</button></header><span class="sr-only" id="dash-advice-status" role="status" aria-live="polite"></span>
    <div id="dash-weather-slot"></div><div class="today-body-grid"><div class="today-now-column"><section class="today-status accent-${STATE_LABELS[context.state].accent}" id="dash-status" aria-label="当前课程与下一次安排">${renderStatus(context, courses, nextDay, state, now, daySlots)}</section>
    <div id="dash-planner-slot"></div><div id="dash-moment-notes"></div><p class="context-notes-status" data-notes-status role="status" aria-live="polite"></p><div class="home-modules" id="dash-home-modules"><section class="home-module" id="dash-personal-slot" data-home-module="items"></section><section class="home-module today-course-list" id="dash-course-list" data-home-module="courses"${!plannedCourses.length?' hidden':''}>${homeModuleHeading('courses')}<div id="dash-courses-content"><div class="today-timeline" id="dash-timeline">${renderUpcomingCourses(plannedCourses,now,state,layout().expanded.courses)}</div></div></section></div><p class="home-layout-status" id="dash-layout-status" role="status" aria-live="polite"></p></div>
    <div class="today-support-column">
    <div id="dash-prep-slot"></div>${renderOverview(academicCourses(courses), now, dm.getSemesterInfo())}</div></div></section>`;
  const cleanupItems = mountTodayItems(container, state, dm);
  const cleanupAssistant = mountDailyAssistant(container, state, dm);
  const cleanupAgendaBrief = mountTodayAgenda(container, state, dm);
  const cleanupWeather = mountWeather(container);
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
  function refreshNotes(time) {
    const items=noteItems(),value=getTodayState(courses,time),focus=value.currentCourse||value.nextCourse;
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
  function refreshUnassigned(time) {
    const slot=container.querySelector('#dash-unassigned-hint');
    if (!slot) return;
    const markup=renderUnassignedHint(daySlots,time);
    if (slot.innerHTML!==markup) slot.innerHTML=markup;
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
      status.className = `today-status accent-${STATE_LABELS[next.state].accent}`;
      status.innerHTML = renderStatus(next, courses, nextDay, state, time, daySlots);
      if (statusFocused) status.querySelector('.status-course, a')?.focus({ preventScroll: true });
      refreshCourses(time);
      refreshNotes(time);
    }
    const minute=Math.floor(+time/60000);
    if(minute!==noteMinute){noteMinute=minute;refreshNotes(time);refreshUnassigned(time);}
    const countdown = container.querySelector('#dash-countdown');
    if (countdown && next.countdown !== null) countdown.textContent = countdownText(next.countdown);
    const progress = container.querySelector('#dash-progress');
    if (progress && next.currentCourse) progress.style.width = `${progressPercent(next.currentCourse, time, next.currentSegment)}%`;
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
    cleanupWeather();
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
