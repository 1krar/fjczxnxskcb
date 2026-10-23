import { getTodayStr, getDayName, getCurrentWeek, getCourseState } from './time.js?v=20261023-1';
import { showCourseDetail } from './app.js?v=20261023-1';
import { formatLocation } from './location.js?v=20261023-1';
import { mountTodayItems } from './tasks.js?v=20261023-1';
import { escapeText } from './tasks-store.js?v=20261023-1';
import { courseKey, getCourseSummary, getTodayState, getFreeTimeInfo, formatMinutes, getRemainingPeriods } from './day-plan.js?v=20261023-1';
import { mountDailyAssistant } from './daily-widgets.js?v=20261023-1';
import { mountTodayAgenda } from './today-agenda.js?v=20261023-1';
import { readDailyData } from './daily-store.js?v=20261023-1';
import { departurePlan } from './daily-model.js?v=20261023-1';
import { mountWeather } from './weather-widget.js?v=20261023-1';

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

function findNextClassDay(dm, className, today) {
  const nextDate = dm.getCourses(className).map(course => course.date).filter(date => date > today).sort()[0];
  if (!nextDate) return null;
  const courses = dm.getCoursesByDate(className, nextDate);
  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { date: nextDate, weekday: getDayName(nextDate), courses,
    isTomorrow: new Date(`${nextDate}T00:00:00`).getTime() === tomorrow.getTime() };
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
  const lesson = segment?.kind === 'lesson' ? segment : !segment ? course.segments?.find(part => part.kind === 'lesson') : null;
  const time = lesson ? `第${lesson.section}小节 · ${lesson.startTime}—${lesson.endTime}` : `${course.startTime || '时间待确认'}${course.endTime ? `—${course.endTime}` : ''}`;
  return `<button type="button" class="status-course" data-course-key="${esc(courseKey(course))}">
    <span class="status-title">${esc(course.courseName)}</span>
    <span class="status-meta">${esc(formatLocation(course.location, state.settings.showFullLocation) || '教室待确认')}</span>
    <span class="status-course-footer"><span class="status-section mono">${esc(time)}</span><span class="status-detail-hint">详情 <span aria-hidden="true">→</span></span></span>
  </button>`;
}

function renderStatus(context, courses, nextDay, state, now) {
  const label = STATE_LABELS[context.state];
  const current = context.state === 'IN_CLASS';
  const resting = ['NO_CLASS', 'WEEKEND', 'DAY_FINISHED', 'TIME_UNKNOWN'].includes(context.state);
  let content;
  if (resting) {
    content = context.state === 'TIME_UNKNOWN' ? `${courseButton(courses[0], state)}<a class="status-schedule-link" href="#/data">查看导入的时间信息 →</a>` : '';
    if (context.state !== 'TIME_UNKNOWN' && nextDay) {
      content += `<p class="next-day-info">${nextDay.isTomorrow ? '明日首课' : '下一有课日'} · ${esc(nextDay.date.slice(5))} 星期${nextDay.weekday}</p>${courseButton(nextDay.courses[0], state)}`;
    } else if (context.state !== 'TIME_UNKNOWN') {
      content = `<h2 class="status-rest-title">${context.state === 'DAY_FINISHED' ? '今天的课上完了' : '今天课表上没有课程'}</h2><p class="status-sub">也给自己的安排留一点时间。</p><a class="status-schedule-link" href="#/schedule">查看其他日期 →</a>`;
    }
  } else {
    const course = context.currentCourse || context.nextCourse;
    content = courseButton(course, state, context.currentSegment);
    if (context.state === 'EARLY_MORNING') content += '<p class="status-sub">夜里先把需要的东西准备好，临近上课时再看倒计时。</p>';
  }
  const countdown = !resting && context.state !== 'EARLY_MORNING' && context.countdown !== null ? `<div class="status-countdown"><span>${current ? '距本小节下课' : context.state === 'INTERNAL_BREAK' ? '距继续上课' : '距开课'}</span><strong id="dash-countdown">${countdownText(context.countdown)}</strong></div>` : '';
  let support = '';
  if (context.state === 'INTERNAL_BREAK') support = `<p class="status-action-line">课间休息 · ${esc(context.currentSegment.endTime)}继续第${context.currentSegment.nextSection}小节</p>`;
  else if (current) support = `<div class="status-progress-mini" aria-hidden="true"><div class="status-progress-mini-fill" id="dash-progress" style="width:${progressPercent(context.currentCourse, now, context.currentSegment)}%"></div></div>`;
  else if (!resting && context.nextCourse) {
    try {
      const plan = departurePlan(context.nextCourse, readDailyData().profile, context.prevCourse);
      if (plan) support = `<p class="status-action-line"><strong>${esc(plan.clock)} 建议出发</strong><span>按你的路线预算估算</span></p>`;
    } catch { /* Course time stays available when optional daily preferences cannot be read. */ }
  }
  return `<div class="status-main${resting ? ' is-resting' : ''}"><div class="status-heading"><div class="status-tag accent-${label.accent}">${label.label}</div></div><div class="status-focus-row${countdown ? ' has-countdown' : ''}"><div class="status-course-info">${content}</div>${countdown}</div>${support}</div>`;
}

function progressPercent(course, now, segment) {
  const start = segment?.kind === 'lesson' ? segment.start : course.startDateTime;
  const end = segment?.kind === 'lesson' ? segment.end : course.endDateTime;
  const duration = end - start;
  return duration > 0 ? Math.max(0, Math.min(100, (now - start) / duration * 100)) : 0;
}

function renderCourseRow(course, context, now, state) {
  const status = getCourseState(course, now);
  const isNext = course === context.nextCourse;
  const tag = status === 'in_progress' ? '进行中' : status === 'break' ? '课间' : status === 'finished' ? '已结束' : isNext ? '下一次课' : '';
  return `<button type="button" class="tl-item ${status === 'finished' ? 'tl-finished' : status === 'in_progress' ? 'tl-in-progress' : 'tl-before'}${isNext ? ' tl-next' : ''}" data-course-key="${esc(courseKey(course))}">
    <span class="tl-time mono"><span class="tl-start">${esc(course.startTime || '待确认')}</span><span class="tl-end">${esc(course.endTime)}</span></span>
    <span class="tl-marker ${status === 'in_progress' ? 'active' : ''}" aria-hidden="true"></span>
    <span class="tl-content"><span class="tl-name">${esc(course.courseName)}</span>
      <span class="tl-meta"><span class="tl-section">第${course.startSection}—${course.endSection}节</span>${tag ? `<span class="tl-state">${tag}</span>` : ''}</span>
      <span class="tl-loc">${esc(formatLocation(course.location, state.settings.showFullLocation) || '教室待确认')}</span>
      ${course.teacher && state.settings.showTeacher ? `<span class="tl-teacher">${esc(course.teacher)}</span>` : ''}
    </span></button>`;
}

function renderTimeline(courses, context, now, state) {
  const past = courses.filter(course => getCourseState(course, now) === 'finished');
  const remaining = getRemainingPeriods(courses, now);
  const history = past.length ? `<details class="tl-history"><summary>已结束 ${past.length} 次课<span>展开查看</span></summary>${past.map(course => renderCourseRow(course, context, now, state)).join('')}</details>` : '';
  const clock=value=>`${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`;
  const rows = remaining.rows.map(part => {
    if (part.kind === 'break') return `<div class="remaining-break${part.start <= now ? ' is-current' : ''}">${part.start <= now ? '当前 · ' : ''}${part.internal ? '课间' : '课表空档'} ${clock(part.start)}—${clock(part.end)} · 共${formatMinutes((part.end-part.start)/60000)}</div>`;
    return `<button type="button" class="remaining-lesson" data-course-key="${esc(courseKey(part.course))}"><span class="remaining-clock mono">${esc(part.startTime)}<small>${esc(part.endTime)}</small></span><span class="remaining-info"><strong>${esc(part.course.courseName)}</strong><span>${part.unsplit ? '原始课程时段' : `第${part.section}小节`} · ${esc(formatLocation(part.course.location,state.settings.showFullLocation)||'教室待确认')}</span></span></button>`;
  }).join('');
  const unknown = remaining.unknown.map(course => `<button type="button" class="remaining-lesson" data-course-key="${esc(courseKey(course))}"><span class="remaining-clock">时间待定</span><span class="remaining-info"><strong>${esc(course.courseName)}</strong><span>${esc(course.location || '教室待确认')}</span></span></button>`).join('');
  return `${rows}${unknown}${!remaining.lessons.length&&!remaining.unknown.length ? `<p class="remaining-done">${context.currentCourse ? '本节之后，今天没有待开始的课程' : '今日课程已结束'}</p>` : ''}${history}`;
}

function courseListSummary(courses, context, now) {
  const remaining = getRemainingPeriods(courses, now);
  return `<span class="course-list-title">今天接下来</span><span class="course-list-meta">${remaining.lessons.length ? `待开始 ${remaining.lessons.length}${remaining.lessons.some(row=>row.unsplit) ? '个时段' : '小节'}` : '无待开始小节'}${remaining.unknown.length ? ` · ${remaining.unknown.length}次课时间待定` : ''}</span>`;
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
  const courses = dm.getCoursesByDate(state.currentClass, today);
  const nextDay = findNextClassDay(dm, state.currentClass, today);
  const context = getTodayState(courses, now);
  const semester = getSemesterProgress(dm.getSemesterInfo());
  container.innerHTML = `<section class="today-page"><div id="dash-advice-slot"></div><header class="today-header-row"><h1 class="today-date-sub"><a href="#/agenda" aria-label="打开日历与日程"><time datetime="${today}">${Number(today.slice(5, 7))}月${Number(today.slice(8))}日 · 星期${getDayName(today)}</time></a></h1><span class="today-week-badge">${semester.label}</span><button type="button" class="daily-restore" data-restore-advice hidden>恢复今日一句</button></header><span class="sr-only" id="dash-advice-status" role="status" aria-live="polite"></span>
    <div id="dash-weather-slot"></div><div class="today-body-grid"><div class="today-now-column"><section class="today-status accent-${STATE_LABELS[context.state].accent}" id="dash-status" aria-label="当前课程与下一次安排">${renderStatus(context, courses, nextDay, state, now)}</section>
    <div id="dash-planner-slot"></div>${courses.length ? `<section class="today-course-list" id="dash-course-list" aria-label="今日剩余课程"><div class="remaining-heading">${courseListSummary(courses, context, now)}</div><div class="today-timeline" id="dash-timeline">${renderTimeline(courses, context, now, state)}</div><a class="personal-view-all" href="#/schedule">查看完整课表 →</a></section>` : ''}</div><div class="today-priority" id="dash-personal-slot"></div>
    <div class="today-support-column">
    <div id="dash-prep-slot"></div>${renderOverview(courses, now, dm.getSemesterInfo())}</div></div></section>`;
  const cleanupItems = mountTodayItems(container, state, dm);
  const cleanupAssistant = mountDailyAssistant(container, state, dm);
  const cleanupAgendaBrief = mountTodayAgenda(container, state, dm);
  const cleanupWeather = mountWeather(container);
  const allCourses = [...courses, ...(nextDay?.courses || [])];
  const onClick = event => {
    const button = event.target.closest('[data-course-key]');
    if (!button || !container.contains(button)) return;
    const course = allCourses.find(item => courseKey(item) === button.dataset.courseKey);
    if (course) showCourseDetail(course);
  };
  container.addEventListener('click', onClick);
  let previousKey = stateKey(context);
  const handler = event => {
    const time = event.detail?.now || new Date();
    const next = getTodayState(courses, time);
    if (stateKey(next) !== previousKey) {
      previousKey = stateKey(next);
      const status = container.querySelector('#dash-status');
      const statusFocused = status.contains(document.activeElement);
      status.className = `today-status accent-${STATE_LABELS[next.state].accent}`;
      status.innerHTML = renderStatus(next, courses, nextDay, state, time);
      if (statusFocused) status.querySelector('.status-course, a')?.focus({ preventScroll: true });
      const listSummary = container.querySelector('#dash-course-list > .remaining-heading');
      if (listSummary) listSummary.innerHTML = courseListSummary(courses, next, time);
      const timeline = container.querySelector('#dash-timeline');
      if (timeline) {
        const historyWasOpen = timeline.querySelector('.tl-history')?.open || false;
        const focusKey = timeline.contains(document.activeElement) ? document.activeElement?.dataset.courseKey : null;
        timeline.innerHTML = renderTimeline(courses, next, time, state);
        const history = timeline.querySelector('.tl-history');
        if (history) history.open = historyWasOpen;
        if (focusKey) {
          const focusedCourse = [...container.querySelectorAll('[data-course-key]')].find(button => button.dataset.courseKey === focusKey);
          if (focusedCourse?.closest('.tl-history')) history.open = true;
          focusedCourse?.focus({ preventScroll: true });
        }
      }
    }
    const countdown = container.querySelector('#dash-countdown');
    if (countdown && next.countdown !== null) countdown.textContent = countdownText(next.countdown);
    const progress = container.querySelector('#dash-progress');
    if (progress && next.currentCourse) progress.style.width = `${progressPercent(next.currentCourse, time, next.currentSegment)}%`;
  };
  const preferencesChanged = () => { previousKey = ''; handler({ detail:{ now:new Date() } }); };
  tickHandler = handler;
  document.addEventListener('app:tick', handler);
  window.addEventListener('daily:changed', preferencesChanged);
  return () => {
    cleanupItems?.();
    cleanupAssistant();
    cleanupAgendaBrief();
    cleanupWeather();
    document.removeEventListener('app:tick', handler);
    window.removeEventListener('daily:changed', preferencesChanged);
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
