import { getTodayStr, getDayName, getCurrentWeek, getCourseState } from './time.js?v=20261021-3';
import { showCourseDetail } from './app.js?v=20261021-3';
import { formatLocation } from './location.js?v=20261021-3';
import { mountTodayItems } from './tasks.js?v=20261021-3';
import { escapeText } from './tasks-store.js?v=20261021-3';
import { courseKey, getCourseSummary, getTodayState, getFreeTimeInfo, formatMinutes } from './day-plan.js?v=20261021-3';
import { mountDailyAssistant } from './daily-widgets.js?v=20261021-3';
import { mountTodayAgenda } from './today-agenda.js?v=20261021-3';

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

function courseButton(course, state) {
  if (!course) return '';
  return `<button type="button" class="status-course" data-course-key="${esc(courseKey(course))}">
    <span class="status-title">${esc(course.courseName)}</span>
    <span class="status-meta">${esc(formatLocation(course.location, state.settings.showFullLocation) || '教室待确认')}</span>
    <span class="status-course-footer"><span class="status-section mono">${esc(course.startTime || '时间待确认')}${course.endTime ? ` — ${esc(course.endTime)}` : ''}</span><span class="status-detail-hint">详情 <span aria-hidden="true">→</span></span></span>
  </button>`;
}

function renderStatus(context, courses, nextDay, state, now) {
  const label = STATE_LABELS[context.state];
  const current = context.state === 'IN_CLASS';
  const resting = ['NO_CLASS', 'WEEKEND', 'DAY_FINISHED', 'TIME_UNKNOWN'].includes(context.state);
  let content;
  if (resting) {
    content = context.state === 'TIME_UNKNOWN' ? '<h2 class="status-rest-title">先核对一下课程时间</h2><a class="status-schedule-link" href="#/data">检查导入的课程时间 →</a>' : '';
    if (context.state !== 'TIME_UNKNOWN' && nextDay) {
      content += `<p class="next-day-info">${nextDay.isTomorrow ? '明日首课' : '下一有课日'} · ${esc(nextDay.date.slice(5))} 星期${nextDay.weekday}</p>${courseButton(nextDay.courses[0], state)}`;
    } else if (context.state !== 'TIME_UNKNOWN') {
      content = `<h2 class="status-rest-title">${context.state === 'DAY_FINISHED' ? '今天的课上完了' : '今天课表上没有课程'}</h2><p class="status-sub">也给自己的安排留一点时间。</p><a class="status-schedule-link" href="#/schedule">查看其他日期 →</a>`;
    }
  } else {
    const course = context.currentCourse || context.nextCourse;
    content = courseButton(course, state);
    if (context.currentSegment) content += `<p class="status-sub">${context.currentSegment.kind === 'break' ? `下一小节：第${context.currentSegment.nextSection}节 · ${context.currentSegment.endTime}开始` : `当前：第${context.currentSegment.section}节 · ${context.currentSegment.startTime}—${context.currentSegment.endTime}`}</p>`;
    if (context.state === 'EARLY_MORNING') content += '<p class="status-sub">夜里先把需要的东西准备好，临近上课时再看倒计时。</p>';
    if (current) content += `<div class="status-progress-mini" aria-hidden="true"><div class="status-progress-mini-fill" id="dash-progress" style="width:${progressPercent(course, now)}%"></div></div>`;
  }
  const countdown = !resting && context.state !== 'EARLY_MORNING' && context.countdown !== null ? `<span class="status-countdown"><span id="dash-countdown">${countdownText(context.countdown)}</span>${current ? '后本小节下课' : context.state === 'INTERNAL_BREAK' ? '后继续上课' : '后开课'}</span>` : '';
  return `<div class="status-main"><div class="status-heading"><div class="status-tag accent-${label.accent}">${label.label}</div>${countdown}</div>${content}</div>`;
}

function progressPercent(course, now) {
  const duration = course.endDateTime - course.startDateTime;
  return duration > 0 ? Math.max(0, Math.min(100, (now - course.startDateTime) / duration * 100)) : 0;
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
  const free = getFreeTimeInfo(courses, now);
  const past = courses.filter(course => getCourseState(course, now) === 'finished');
  const focusKey = courseKey(context.currentCourse || context.nextCourse);
  const upcoming = courses.filter(course => getCourseState(course, now) !== 'finished' && courseKey(course) !== focusKey);
  const history = past.length ? `<details class="tl-history"><summary>已结束 ${past.length} 次课<span>展开查看</span></summary>${past.map(course => renderCourseRow(course, context, now, state)).join('')}</details>` : '';
  const rows = upcoming.map(course => {
    const gap = free.gaps.find(interval => interval.nextCourse === course);
    let gapHTML = '';
    if (gap) {
      const active = now >= gap.start && now < gap.end;
      const spansNoon = gap.start.getHours() < 14 && gap.end.getHours() >= 12 && gap.durationMin > 45;
      gapHTML = `<div class="tl-gap${active ? ' now' : ''}"><span class="tl-gap-line"></span><span class="tl-gap-text">${active ? '<span class="tl-gap-now">当前</span>' : ''}<span>课表空档 ${formatMinutes(gap.durationMin)}${spansNoon ? ' · 含午间' : ''}</span></span><span class="tl-gap-line"></span></div>`;
    }
    return gapHTML + renderCourseRow(course, context, now, state);
  }).join('');
  const allDone = !context.currentCourse && !context.nextCourse;
  return `${history}${rows}<div class="tl-end-block${allDone ? ' done' : ''}"><span class="tl-end-marker" aria-hidden="true"></span><div class="tl-end-text"><span>${allDone ? '今日课程已结束' : '今日课程结束'}</span><span class="tl-end-time mono">${esc(getCourseSummary(courses).endTime)}</span></div></div>`;
}

function courseListSummary(courses, context, now) {
  const focusKey = courseKey(context.currentCourse || context.nextCourse);
  const remaining = courses.filter(course => getCourseState(course, now) !== 'finished' && courseKey(course) !== focusKey);
  return `<span class="course-list-title">${remaining.length ? '后续课程' : '今日课程记录'}</span><span class="course-list-meta">${remaining.length ? `还有${remaining.length}次课` : `共${courses.length}次课`}<span class="course-list-chevron" aria-hidden="true"></span></span>`;
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
  container.innerHTML = `<section class="today-page"><header class="today-header-row"><h1 class="today-date-sub"><a href="#/agenda" aria-label="打开日历与日程"><time datetime="${today}">${Number(today.slice(5, 7))}月${Number(today.slice(8))}日 · 星期${getDayName(today)}</time></a></h1><span class="today-week-badge">${semester.label}</span></header>
    <div class="today-body-grid"><div class="today-now-column"><section class="today-status accent-${STATE_LABELS[context.state].accent}" id="dash-status" aria-label="当前课程与下一次安排">${renderStatus(context, courses, nextDay, state, now)}</section>
    <div id="dash-planner-slot"></div><div class="today-priority" id="dash-personal-slot"></div><div id="dash-advice-slot"></div></div>
    <div class="today-support-column">${courses.length ? `<details class="today-course-list" id="dash-course-list"><summary>${courseListSummary(courses, context, now)}</summary><div class="today-timeline" id="dash-timeline">${renderTimeline(courses, context, now, state)}</div><a class="personal-view-all" href="#/schedule">查看完整课表 →</a></details>` : ''}
    <div id="dash-prep-slot"></div>${renderOverview(courses, now, dm.getSemesterInfo())}</div></div></section>`;
  mountTodayItems(container, state, dm);
  const cleanupAssistant = mountDailyAssistant(container, state, dm);
  const cleanupAgendaBrief = mountTodayAgenda(container, state, dm);
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
      const listSummary = container.querySelector('#dash-course-list > summary');
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
    if (progress && next.currentCourse) progress.style.width = `${progressPercent(next.currentCourse, time)}%`;
  };
  tickHandler = handler;
  document.addEventListener('app:tick', handler);
  return () => {
    cleanupAssistant();
    cleanupAgendaBrief();
    document.removeEventListener('app:tick', handler);
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
