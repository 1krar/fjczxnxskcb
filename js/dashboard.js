import { formatClockDisplay, formatCountdown, getTodayStr, getDayName, formatDateShort, getCurrentWeek, getCourseState } from './time.js?v=20261020-6';
import { showCourseDetail } from './app.js?v=20261020-6';
import { formatLocation } from './location.js?v=20261020-6';
import { mountTodayItems } from './tasks.js?v=20261020-6';
import { escapeText } from './tasks-store.js?v=20261020-6';
import { courseKey, getCourseSummary, getTodayState, getFreeTimeInfo, formatMinutes } from './day-plan.js?v=20261020-6';
import { mountDailyAssistant } from './daily-widgets.js?v=20261020-6';

const esc = escapeText;
let tickHandler = null;
const STATE_LABELS = {
  NO_CLASS: { label: '今日无课', accent: 'muted' },
  WEEKEND: { label: '周末无课', accent: 'muted' },
  EARLY_MORNING: { label: '夜间 · 今日准备', accent: 'muted' },
  BEFORE_FIRST_CLASS: { label: '今日首课', accent: 'before' },
  IN_CLASS: { label: '正在上课', accent: 'primary' },
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

function clockHTML(now, state) {
  const display = formatClockDisplay(now, state.settings.timeFormat !== '12h');
  return `${display.main}<span class="seconds">${display.seconds}</span>${display.ampm ? ` <span class="clock-period">${display.ampm}</span>` : ''}`;
}

function countdownText(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}小时${minutes % 60}分` : minutes ? `${minutes}分钟` : `${seconds}秒`;
}

function courseButton(course, state) {
  if (!course) return '';
  return `<button type="button" class="status-course" data-course-key="${esc(courseKey(course))}">
    <span class="status-title">${esc(course.courseName)}</span>
    <span class="status-meta">${esc(formatLocation(course.location, state.settings.showFullLocation) || '教室待确认')}</span>
    <span class="status-section mono">${esc(course.startTime || '时间待确认')}${course.endTime ? ` — ${esc(course.endTime)}` : ''} · 第${course.startSection}—${course.endSection}节</span>
    ${course.teacher && state.settings.showTeacher ? `<span class="status-teacher">${esc(course.teacher)}</span>` : ''}
    <span class="status-detail-hint">查看课程详情 <span aria-hidden="true">→</span></span>
  </button>`;
}

function renderStatus(context, courses, nextDay, state, now) {
  const label = STATE_LABELS[context.state];
  const summary = getCourseSummary(courses);
  const current = context.state === 'IN_CLASS';
  const resting = ['NO_CLASS', 'WEEKEND', 'DAY_FINISHED', 'TIME_UNKNOWN'].includes(context.state);
  let content;
  if (resting) {
    const title = context.state === 'DAY_FINISHED' ? '今天的课程已经结束了' : context.state === 'TIME_UNKNOWN' ? '先核对一下课程时间' : '今天课表上没有课程';
    const subtitle = context.state === 'DAY_FINISHED' ? `今日共 ${summary.sessionCount} 次课 · ${summary.totalSections} 节。接下来也给自己留一点时间。` :
      context.state === 'TIME_UNKNOWN' ? '课程已导入，但没有可用的上课时刻，请到数据页检查。' : '个人安排和要记得的事，可以在下面查看。';
    content = `<h2 class="status-rest-title">${title}</h2><p class="status-sub">${subtitle}</p>`;
  } else {
    const course = context.currentCourse || context.nextCourse;
    content = courseButton(course, state);
    if (context.state === 'EARLY_MORNING') content += '<p class="status-sub">夜里先把需要的东西准备好，临近上课时再看倒计时。</p>';
    else if (context.countdown !== null) {
      content += `<div class="status-countdown"><span class="countdown-text">${current ? '距离下课' : '距离开课'}</span>
        <span class="countdown-value mono" id="dash-countdown">${countdownText(context.countdown)}</span>
        <span class="countdown-sec mono" id="dash-countdown-sec">${formatCountdown(context.countdown)}</span></div>`;
    }
    if (current) content += `<div class="status-progress-mini" aria-hidden="true"><div class="status-progress-mini-fill" id="dash-progress" style="width:${progressPercent(course, now)}%"></div></div>`;
    if (current && context.nextCourse) {
      content += `<button type="button" class="status-next" data-course-key="${esc(courseKey(context.nextCourse))}"><span class="next-prefix">下一次课</span><span class="next-name">${esc(context.nextCourse.courseName)}</span><span class="next-time mono">${esc(context.nextCourse.startTime)}</span></button>`;
    }
    content += `<p class="status-remaining">${current && !context.remainingCount ? '这是今天最后一次课' : `${current ? '本次课后还有' : '今天还有'} <strong>${context.remainingCount}</strong> 次课`}</p>`;
  }
  if (resting && nextDay) {
    content += `<div class="today-next-day"><div class="next-day-info">${nextDay.isTomorrow ? '明日首课' : '下一有课日'} · ${esc(nextDay.date.slice(5))} 星期${nextDay.weekday} · ${nextDay.courses.length} 次课</div>${courseButton(nextDay.courses[0], state)}</div>`;
  } else if (resting && context.state !== 'TIME_UNKNOWN') content += '<a class="status-schedule-link" href="#/schedule">查看其他日期的课表 →</a>';
  return `<div class="status-main"><div class="status-tag accent-${label.accent}">${label.label}${current ? '<span class="status-dot" aria-hidden="true"></span>' : ''}</div>${content}</div>`;
}

function progressPercent(course, now) {
  const duration = course.endDateTime - course.startDateTime;
  return duration > 0 ? Math.max(0, Math.min(100, (now - course.startDateTime) / duration * 100)) : 0;
}

function renderCourseRow(course, context, now, state) {
  const status = getCourseState(course, now);
  const isNext = course === context.nextCourse;
  const tag = status === 'in_progress' ? '进行中' : status === 'finished' ? '已结束' : isNext ? '下一次课' : '';
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
  const upcoming = courses.filter(course => getCourseState(course, now) !== 'finished');
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
  const allDone = upcoming.length === 0;
  return `${history}${rows}<div class="tl-end-block${allDone ? ' done' : ''}"><span class="tl-end-marker" aria-hidden="true"></span><div class="tl-end-text"><span>${allDone ? '今日课程已结束' : '今日课程结束'}</span><span class="tl-end-time mono">${esc(getCourseSummary(courses).endTime)}</span></div></div>`;
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
    <div class="overview-gaps"><span>课间空档合计 <strong>${formatMinutes(free.totalMin)}</strong></span><span>最长一段 <strong>${formatMinutes(free.longestMin)}</strong></span></div>
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
  container.innerHTML = `<section class="today-page"><header class="today-header-row"><div class="today-time-block"><h1 class="today-clock mono" id="dash-clock">${clockHTML(now, state)}</h1><div class="today-date-sub">星期${getDayName(today)} · ${formatDateShort(today)}</div></div><span class="today-week-badge">${semester.label}</span></header>
    <section class="today-status accent-${STATE_LABELS[context.state].accent}" id="dash-status" aria-label="当前课程与下一次安排">${renderStatus(context, courses, nextDay, state, now)}</section>
    <div class="today-body-grid"><div class="today-priority" id="dash-personal-slot"></div>
    ${courses.length ? `<section class="today-timeline-section"><div class="section-label-row"><h2>今日时间线</h2><span class="badge badge-muted">${courses.length} 次课 · ${getCourseSummary(courses).totalSections} 节</span></div><div class="today-timeline" id="dash-timeline">${renderTimeline(courses, context, now, state)}</div></section>` : '<section class="today-empty-section"><h2>课表留白，也可以有自己的安排</h2><p>休息、运动或约朋友都可以。需要记的事情，随手记一下就好。</p><a href="#/schedule">查看课表 →</a></section>'}
    ${renderOverview(courses, now, dm.getSemesterInfo())}</div></section>`;
  mountTodayItems(container, state, dm);
  const cleanupAssistant = mountDailyAssistant(container, state, dm);
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
    const clock = container.querySelector('#dash-clock');
    if (clock) clock.innerHTML = clockHTML(time, state);
    if (stateKey(next) !== previousKey) {
      previousKey = stateKey(next);
      const status = container.querySelector('#dash-status');
      status.className = `today-status accent-${STATE_LABELS[next.state].accent}`;
      status.innerHTML = renderStatus(next, courses, nextDay, state, time);
      const timeline = container.querySelector('#dash-timeline');
      if (timeline) {
        const historyWasOpen = timeline.querySelector('.tl-history')?.open || false;
        const focusKey = timeline.contains(document.activeElement) ? document.activeElement?.dataset.courseKey : null;
        timeline.innerHTML = renderTimeline(courses, next, time, state);
        const history = timeline.querySelector('.tl-history');
        if (history) history.open = historyWasOpen;
        if (focusKey) {
          const focusedCourse = [...timeline.querySelectorAll('[data-course-key]')].find(button => button.dataset.courseKey === focusKey);
          if (focusedCourse?.closest('.tl-history')) history.open = true;
          focusedCourse?.focus({ preventScroll: true });
        }
      }
    }
    const countdown = container.querySelector('#dash-countdown');
    const seconds = container.querySelector('#dash-countdown-sec');
    if (countdown && next.countdown !== null) countdown.textContent = countdownText(next.countdown);
    if (seconds && next.countdown !== null) seconds.textContent = formatCountdown(next.countdown);
    const progress = container.querySelector('#dash-progress');
    if (progress && next.currentCourse) progress.style.width = `${progressPercent(next.currentCourse, time)}%`;
  };
  tickHandler = handler;
  document.addEventListener('app:tick', handler);
  return () => {
    cleanupAssistant();
    document.removeEventListener('app:tick', handler);
    container.removeEventListener('click', onClick);
    if (tickHandler === handler) tickHandler = null;
  };
}

function stateKey(context) {
  return [context.state, courseKey(context.currentCourse), courseKey(context.nextCourse), context.remainingCount].join('::');
}

export function cleanupDashboard() {
  if (tickHandler) document.removeEventListener('app:tick', tickHandler);
  tickHandler = null;
}
