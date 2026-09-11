import { formatClockDisplay, formatCountdown, getTodayStr, getDayName, formatDate, formatDateShort, getCurrentWeek, getWeekDates, getCourseState, getNextCourse, getCurrentCourse } from './time.js';
import { showCourseDetail } from './app.js';

let tickHandler = null;
let dashState = { courses: [], state: 'NO_CLASS', currentCourse: null, nextCourse: null, prevCourse: null, remainingCount: 0 };

// ========== State Machine ==========
const STATE_LABELS = {
  NO_CLASS: { label: '今日无课', accent: 'muted' },
  BEFORE_FIRST_CLASS: { label: '课前准备', accent: 'before' },
  IN_CLASS: { label: '正在上课', accent: 'primary' },
  BREAK: { label: '课间休息', accent: 'warning' },
  LUNCH: { label: '午休时间', accent: 'warning' },
  BEFORE_NEXT_CLASS: { label: '下一节课', accent: 'info' },
  EVENING_STUDY: { label: '晚间自习', accent: 'muted' },
  AFTER_CLASS: { label: '课后时间', accent: 'muted' },
  DAY_FINISHED: { label: '今日结束', accent: 'success' },
  WEEKEND: { label: '周末', accent: 'muted' },
};

function getTodayState(courses, now) {
  if (courses.length === 0) {
    return { state: 'NO_CLASS', currentCourse: null, nextCourse: null, prevCourse: null, countdown: null, remainingCount: 0 };
  }

  // Current course
  const current = getCurrentCourse(courses, now);
  if (current) {
    const idx = courses.indexOf(current);
    const next = getNextCourse(courses, now);
    const prev = idx > 0 ? courses[idx - 1] : null;
    const remaining = courses.length - idx - 1;
    return {
      state: 'IN_CLASS',
      currentCourse: current,
      nextCourse: next,
      prevCourse: prev,
      countdown: current.endDateTime - now,
      remainingCount: remaining,
    };
  }

  // Find next and previous courses
  const next = getNextCourse(courses, now);
  const past = courses.filter(c => c.endDateTime && c.endDateTime <= now);
  const prev = past.length > 0 ? past[past.length - 1] : null;

  // Before first class
  if (!prev && next) {
    return {
      state: 'BEFORE_FIRST_CLASS',
      currentCourse: null,
      nextCourse: next,
      prevCourse: null,
      countdown: next.startDateTime - now,
      remainingCount: courses.length,
    };
  }

  // Between classes
  if (prev && next) {
    const gap = next.startDateTime - prev.endDateTime;
    const wait = next.startDateTime - now;
    const prevEndHour = prev.endDateTime.getHours();
    const nextStartHour = next.startDateTime.getHours();
    const remainingIdx = courses.indexOf(next);

    // Lunch: gap crosses 12:00-13:30 and is longer than 45min
    if (prevEndHour <= 12 && nextStartHour >= 13 && gap > 45 * 60 * 1000) {
      return {
        state: 'LUNCH',
        currentCourse: null,
        nextCourse: next,
        prevCourse: prev,
        countdown: wait,
        remainingCount: courses.length - remainingIdx,
      };
    }

    // Short break (<= 20min)
    if (gap <= 20 * 60 * 1000) {
      return {
        state: 'BREAK',
        currentCourse: null,
        nextCourse: next,
        prevCourse: prev,
        countdown: wait,
        remainingCount: courses.length - remainingIdx,
      };
    }

    // Longer break before next class
    return {
      state: 'BEFORE_NEXT_CLASS',
      currentCourse: null,
      nextCourse: next,
      prevCourse: prev,
      countdown: wait,
      remainingCount: courses.length - remainingIdx,
    };
  }

  // All courses finished
  if (past.length === courses.length && courses.length > 0) {
    const lastCourse = courses[courses.length - 1];
    const endHour = lastCourse.endDateTime ? lastCourse.endDateTime.getHours() : 0;
    if (endHour >= 19) {
      return {
        state: 'EVENING_STUDY',
        currentCourse: null,
        nextCourse: null,
        prevCourse: lastCourse,
        countdown: null,
        remainingCount: 0,
      };
    }
    return {
      state: 'DAY_FINISHED',
      currentCourse: null,
      nextCourse: null,
      prevCourse: lastCourse,
      countdown: null,
      remainingCount: 0,
    };
  }

  return {
    state: 'AFTER_CLASS',
    currentCourse: null,
    nextCourse: null,
    prevCourse: prev,
    countdown: null,
    remainingCount: 0,
  };
}

// ========== Free Time Calculation ==========
function calculateFreeTime(courses, now) {
  if (courses.length === 0) {
    return { totalMin: 0, longestMin: 0, currentFreeMin: 0, currentFreeEnd: null, nextFreeMin: 0, nextFreeStart: null, isInFreeTime: false };
  }

  let totalFreeMin = 0;
  let longestMin = 0;
  let currentFreeMin = 0;
  let currentFreeEnd = null;
  let nextFreeMin = 0;
  let nextFreeStart = null;
  let isInFreeTime = false;

  // Calculate gaps between courses
  for (let i = 0; i < courses.length - 1; i++) {
    const c = courses[i];
    const next = courses[i + 1];
    if (!c.endDateTime || !next.startDateTime) continue;
    const gap = next.startDateTime - c.endDateTime;
    const gapMin = gap / (1000 * 60);
    if (gapMin > 0) {
      totalFreeMin += gapMin;
      if (gapMin > longestMin) longestMin = gapMin;
      // Check if now is in this gap
      if (now >= c.endDateTime && now < next.startDateTime) {
        isInFreeTime = true;
        currentFreeMin = (next.startDateTime - now) / (1000 * 60);
        currentFreeEnd = next.startDateTime;
      }
    }
  }

  // Next free time (when currently in class)
  const current = getCurrentCourse(courses, now);
  if (current) {
    const idx = courses.indexOf(current);
    if (idx < courses.length - 1) {
      const next = courses[idx + 1];
      const gap = next.startDateTime - current.endDateTime;
      const gapMin = gap / (1000 * 60);
      if (gapMin > 0) {
        nextFreeMin = gapMin;
        nextFreeStart = current.endDateTime;
      }
    }
  }

  return {
    totalMin: Math.round(totalFreeMin),
    longestMin: Math.round(longestMin),
    currentFreeMin: Math.round(currentFreeMin),
    currentFreeEnd,
    nextFreeMin: Math.round(nextFreeMin),
    nextFreeStart,
    isInFreeTime,
  };
}

// ========== Semester Progress ==========
function getSemesterProgress(info, now) {
  const totalWeeks = info.lastWeek;
  const currentWeek = getCurrentWeek(info.semesterStart);
  const progress = Math.max(0, Math.min(100, (currentWeek / totalWeeks) * 100));
  const weekDates = getWeekDates(currentWeek, info.semesterStart);
  const beforeSemester = currentWeek < info.firstWeek;
  const afterSemester = currentWeek > info.lastWeek;

  return {
    currentWeek: Math.max(1, Math.min(totalWeeks, currentWeek)),
    totalWeeks,
    progress: Math.max(0, Math.min(100, progress)),
    weekStart: weekDates[0].slice(5),
    weekEnd: weekDates[4].slice(5),
    beforeSemester,
    afterSemester,
    percentLabel: beforeSemester ? '未开始' : afterSemester ? '已结束' : `${progress.toFixed(1)}%`,
  };
}

// ========== Today Stats ==========
function getTodayStats(courses, freeTimeInfo) {
  if (courses.length === 0) {
    return { courseCount: 0, totalSections: 0, totalHours: 0, freeMin: 0, endTime: '—' };
  }
  const totalSections = courses.reduce((sum, c) => sum + (c.endSection - c.startSection + 1), 0);
  // 教学时长按每节 45 分钟计算，不含课间休息
  const totalHours = (totalSections * 45) / 60;
  const lastCourse = courses[courses.length - 1];
  return {
    courseCount: courses.length,
    totalSections,
    totalHours: Math.round(totalHours * 10) / 10,
    freeMin: freeTimeInfo.totalMin,
    endTime: lastCourse.endTime || '—',
  };
}

// ========== Find next class day ==========
function findNextClassDay(dm, className, fromDate) {
  const info = dm.getSemesterInfo();
  const startDate = new Date(fromDate + 'T00:00:00');
  const maxDays = 14; // Look up to 2 weeks ahead

  for (let i = 1; i <= maxDays; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;
    const courses = dm.getCoursesByDate(className, dateStr);
    if (courses.length > 0) {
      const weekday = getDayName(dateStr);
      return { date: dateStr, weekday, courseCount: courses.length, firstCourse: courses[0] };
    }
  }
  return null;
}

// ========== Main Render ==========
export function renderDashboard(container, state, dm) {
  const info = dm.getSemesterInfo();
  const todayStr = getTodayStr();
  const weekday = new Date().getDay() === 0 ? 7 : new Date().getDay();
  const isWeekend = weekday >= 6;
  const courses = dm.getTodayCourses(state.currentClass);
  const now = new Date();

  let rawState = getTodayState(courses, now);

  // Weekend override: if weekend and no classes, show WEEKEND state
  if (isWeekend && courses.length === 0) {
    rawState = { ...rawState, state: 'WEEKEND' };
  }

  dashState = { courses, ...rawState };

  const freeTimeInfo = calculateFreeTime(courses, now);
  const semProgress = getSemesterProgress(info, now);
  const todayStats = getTodayStats(courses, freeTimeInfo);
  const nextClassDay = courses.length === 0 ? findNextClassDay(dm, state.currentClass, todayStr) : null;

  // Build HTML
  container.innerHTML = buildTodayHTML({
    courses,
    dashState,
    freeTimeInfo,
    semProgress,
    todayStats,
    now,
    state,
    info,
    todayStr,
    isWeekend,
    nextClassDay,
  });

  // Attach event listeners
  attachCourseClickHandlers(container, courses);

  // Start tick loop
  tickHandler = () => tick(container, state, dm);
  document.addEventListener('app:tick', tickHandler);

  return function cleanup() {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  };
}

export function cleanupDashboard() {
  if (tickHandler) {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  }
}

// ========== HTML Builder ==========
function buildTodayHTML({ courses, dashState, freeTimeInfo, semProgress, todayStats, now, state, info, todayStr, isWeekend, nextClassDay }) {
  const stateInfo = STATE_LABELS[dashState.state] || STATE_LABELS.NO_CLASS;
  const displayCourse = dashState.currentCourse || dashState.nextCourse;
  const hasCourses = courses.length > 0;

  return `
    <div class="today-layout">
      <!-- LEFT COLUMN: Status -->
      <div class="today-main">
        <div class="today-header-row">
          <div class="today-time-block">
            <div class="today-clock mono" id="dash-clock"></div>
            <div class="today-date-sub">星期${getDayName(todayStr)} · ${formatDateShort(todayStr)}</div>
          </div>
          <div class="today-week-badge">
            <span class="week-badge-num mono">${String(semProgress.currentWeek).padStart(2, '0')}</span>
            <span class="week-badge-label">周</span>
          </div>
        </div>

        <div class="today-status accent-${stateInfo.accent}" id="dash-status">
          ${renderStatusBlock(dashState, displayCourse, stateInfo, state, freeTimeInfo)}
        </div>

        ${hasCourses ? `
        <div class="today-stats-row" id="dash-stats">
          <div class="stat-inline">
            <span class="stat-inline-label">课程</span>
            <span class="stat-inline-value mono">${String(todayStats.courseCount).padStart(2, '0')}</span>
          </div>
          <div class="stat-inline">
            <span class="stat-inline-label">节次</span>
            <span class="stat-inline-value mono">${String(todayStats.totalSections).padStart(2, '0')}</span>
          </div>
          <div class="stat-inline">
            <span class="stat-inline-label">空闲</span>
            <span class="stat-inline-value mono">${formatMinCompact(todayStats.freeMin)}</span>
          </div>
          <div class="stat-inline">
            <span class="stat-inline-label">结束</span>
            <span class="stat-inline-value mono">${todayStats.endTime}</span>
          </div>
        </div>` : ''}
      </div>

      <!-- RIGHT COLUMN: Next class day + Semester -->
      <div class="today-side">
        ${!hasCourses && nextClassDay ? `
        <div class="today-next-day">
          <div class="section-label">下一有课日</div>
          <div class="next-day-date mono">${nextClassDay.date.slice(5)}</div>
          <div class="next-day-info">
            星期${nextClassDay.weekday} · ${nextClassDay.courseCount} 节课程
          </div>
          ${nextClassDay.firstCourse ? `
          <div class="next-day-first">
            <span class="next-day-first-time mono">${nextClassDay.firstCourse.startTime}</span>
            <span class="next-day-first-name">${nextClassDay.firstCourse.courseName}</span>
          </div>` : ''}
        </div>` : ''}
        <div class="today-semester">
          <div class="section-label">学期</div>
          <div class="semester-week">
            <span class="mono semester-week-num">${String(semProgress.currentWeek).padStart(2, '0')}</span>
            <span class="semester-week-divider">/</span>
            <span class="mono semester-week-total">${semProgress.totalWeeks}</span>
            <span class="semester-percent mono">${semProgress.percentLabel}</span>
          </div>
          <div class="semester-bar">
            <div class="semester-bar-fill" style="width:${semProgress.progress}%"></div>
          </div>
          <div class="semester-date mono">${semProgress.weekStart} — ${semProgress.weekEnd}</div>
        </div>

        ${hasCourses && courses.length > 1 ? `
        <div class="today-freetime">
          <div class="section-label">空闲时间</div>
          <div class="freetime-row">
            <div class="freetime-item">
              <span class="freetime-label">今日空闲</span>
              <span class="freetime-value mono">${formatMinCompact(freeTimeInfo.totalMin)}</span>
            </div>
            <div class="freetime-item">
              <span class="freetime-label">最长空闲</span>
              <span class="freetime-value mono">${formatMinCompact(freeTimeInfo.longestMin)}</span>
            </div>
          </div>
        </div>` : ''}

      </div>
    </div>

    <!-- TIMELINE -->
    ${hasCourses ? `
    <div class="today-timeline-section">
      <div class="section-label-row">
        <span class="section-label">今日时间线</span>
        <span class="badge badge-muted">${courses.length} 节</span>
      </div>
      <div class="today-timeline" id="dash-timeline">
        ${renderTimeline(courses, dashState, now, state)}
      </div>
    </div>` : `
    <div class="today-empty-section">
      <div class="empty-day-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
      </div>
      <div class="empty-day-title">
        ${dashState.state === 'WEEKEND' ? '今天是周末' : '今天没有课程'}
      </div>
      <div class="empty-day-sub">
        ${dashState.state === 'WEEKEND' ? '好好休息，调整状态' : nextClassDay ? `下一节课在 ${nextClassDay.date.slice(5)} 星期${nextClassDay.weekday}` : '近期没有课程安排'}
      </div>
    </div>`}
  `;
}

// ========== Status Block ==========
function renderStatusBlock(dashState, course, stateInfo, state, freeTimeInfo) {
  const stateLabel = stateInfo.label;
  const isCurrent = dashState.state === 'IN_CLASS';

  // NO_CLASS / WEEKEND
  if (dashState.state === 'NO_CLASS' || dashState.state === 'WEEKEND') {
    return `
      <div class="status-main">
        <div class="status-tag accent-muted">${stateLabel}</div>
        <div class="status-title muted">
          ${dashState.state === 'WEEKEND' ? '今天是周末' : '今天没有课程安排'}
        </div>
        <div class="status-sub">
          ${dashState.state === 'WEEKEND' ? '好好休息，为下周做准备' : '享受空闲时光'}
        </div>
      </div>`;
  }

  // Finished states
  if (dashState.state === 'DAY_FINISHED' || dashState.state === 'EVENING_STUDY' || dashState.state === 'AFTER_CLASS') {
    return `
      <div class="status-main">
        <div class="status-tag accent-success">${stateLabel}</div>
        <div class="status-title">今日课程已结束</div>
        <div class="status-sub">完成 ${dashState.courses?.length || 0} 节课程 · ${dashState.remainingCount === 0 ? '明日继续' : `剩余 ${dashState.remainingCount} 节`}</div>
      </div>`;
  }

  if (!course) return '';

  const countdown = dashState.countdown;
  const countdownText = countdown != null ? formatCountdownHuman(countdown) : '';
  const countdownSecText = countdown != null ? formatCountdown(countdown) : '';

  return `
    <div class="status-main">
      <div class="status-tag accent-${stateInfo.accent}">
        ${stateLabel}
        ${isCurrent ? `<span class="status-dot"></span>` : ''}
      </div>
      <div class="status-title">${course.courseName}</div>
      <div class="status-meta">
        ${course.location ? `<span>${course.location}</span>` : ''}
        ${course.teacher && state.settings.showTeacher ? `<span class="dot-sep"></span><span>${course.teacher}</span>` : ''}
      </div>
      <div class="status-section mono">
        第${course.startSection}-${course.endSection}节 · ${course.startTime} — ${course.endTime}
      </div>

      ${countdown != null ? `
      <div class="status-countdown">
        <span class="countdown-text">${isCurrent ? '距离下课' : '距离开始'}</span>
        <span class="countdown-value mono" id="dash-countdown">${countdownText}</span>
        <span class="countdown-sec mono" id="dash-countdown-sec">${countdownSecText}</span>
      </div>` : ''}

      ${isCurrent && dashState.currentCourse ? `
      <div class="status-progress-mini">
        <div class="status-progress-mini-fill" id="dash-progress" style="width:${getProgressPercent(dashState.currentCourse, new Date())}%"></div>
      </div>` : ''}

      ${freeTimeInfo && freeTimeInfo.isInFreeTime && !isCurrent ? `
      <div class="status-freetime-now">
        <span class="ft-now-label">当前空闲</span>
        <span class="ft-now-value mono">${formatMinCompact(freeTimeInfo.currentFreeMin)}</span>
        <span class="ft-now-sub">剩余</span>
      </div>` : ''}

      ${!isCurrent && dashState.remainingCount > 0 ? `
      <div class="status-remaining">
        今日剩余 <span class="mono">${dashState.remainingCount}</span> 节
      </div>` : ''}
    </div>

    ${dashState.nextCourse && isCurrent ? `
    <div class="status-next">
      <span class="next-prefix">下一节</span>
      <span class="next-name">${dashState.nextCourse.courseName}</span>
      <span class="next-time mono">${dashState.nextCourse.startTime}</span>
    </div>` : ''}

    ${isCurrent && freeTimeInfo.nextFreeMin > 0 ? `
    <div class="status-next-free">
      <span class="nf-label">下一段空闲</span>
      <span class="nf-value mono">${formatMinCompact(freeTimeInfo.nextFreeMin)}</span>
      <span class="nf-time mono">${dashState.nextCourse ? dashState.currentCourse.endTime : ''}</span>
    </div>` : ''}
  `;
}

// ========== Timeline ==========
function renderTimeline(courses, dashState, now, state) {
  if (courses.length === 0) {
    return `<div class="tl-empty">今日无课程安排</div>`;
  }

  const items = [];

  for (let i = 0; i < courses.length; i++) {
    const c = courses[i];
    const courseState = getCourseState(c, now);
    const next = i < courses.length - 1 ? courses[i + 1] : null;
    const nextCourse = getNextCourse(courses, now);
    const isNext = courseState === 'before' && c === nextCourse;

    let stateClass = 'tl-before';
    if (courseState === 'finished') stateClass = 'tl-finished';
    if (courseState === 'in_progress') stateClass = 'tl-in-progress';
    if (isNext) stateClass += ' tl-next';

    items.push(`
      <div class="tl-item ${stateClass}" data-course-idx="${i}">
        <div class="tl-time mono">
          <span class="tl-start">${c.startTime}</span>
          <span class="tl-end">${c.endTime}</span>
        </div>
        <div class="tl-marker ${courseState === 'in_progress' ? 'active' : ''}"></div>
        <div class="tl-content">
          <div class="tl-name">${c.courseName}</div>
          <div class="tl-meta">
            <span class="tl-section mono">第${c.startSection}-${c.endSection}节</span>
            ${c.location ? `<span class="tl-loc">${c.location}</span>` : ''}
            ${c.teacher && state.settings.showTeacher ? `<span class="tl-teacher">${c.teacher}</span>` : ''}
          </div>
        </div>
      </div>`);

    // Gap between courses
    if (next && c.endDateTime && next.startDateTime) {
      const gap = next.startDateTime - c.endDateTime;
      const gapMin = Math.round(gap / (1000 * 60));
      const isNowGap = now >= c.endDateTime && now < next.startDateTime;

      if (gapMin > 0) {
        const prevEndHour = c.endDateTime.getHours();
        const nextStartHour = next.startDateTime.getHours();
        const isLunch = prevEndHour <= 12 && nextStartHour >= 13 && gapMin > 45;

        items.push(`
          <div class="tl-gap ${isNowGap ? 'now' : ''} ${isLunch ? 'lunch' : ''}">
            <div class="tl-gap-line"></div>
            <div class="tl-gap-text mono">
              ${isNowGap ? `<span class="tl-gap-now">${isLunch ? '午休中' : '空闲中'}</span>` : ''}
              <span>${isLunch ? '午休' : formatMinCompact(gapMin) + ' 空闲'}</span>
            </div>
            <div class="tl-gap-line"></div>
          </div>`);
      }
    }
  }

  // End of day
  const lastCourse = courses[courses.length - 1];
  const allDone = lastCourse && lastCourse.endDateTime && now >= lastCourse.endDateTime;
  items.push(`
    <div class="tl-end ${allDone ? 'done' : ''}">
      <div class="tl-end-marker"></div>
      <div class="tl-end-text">
        <span>今日结束</span>
        ${lastCourse?.endTime ? `<span class="mono tl-end-time">${lastCourse.endTime}</span>` : ''}
      </div>
    </div>`);

  return items.join('');
}

// ========== Helpers ==========
function getProgressPercent(course, now) {
  if (!course.startDateTime || !course.endDateTime) return 0;
  const total = course.endDateTime - course.startDateTime;
  const elapsed = now - course.startDateTime;
  return Math.max(0, Math.min(100, (elapsed / total) * 100));
}

function formatMinCompact(min) {
  if (min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

function formatCountdownHuman(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const totalMin = Math.floor(totalSec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  if (h > 0) {
    return `${h}小时${m}分`;
  }
  if (m > 0) {
    return `${m}分钟`;
  }
  return `${totalSec}秒`;
}

function attachCourseClickHandlers(container, courses) {
  container.querySelectorAll('[data-course-idx]').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.courseIdx);
      if (courses[idx]) showCourseDetail(courses[idx]);
    });
  });
}

// ========== Tick / Real-time Update ==========
function tick(container, state, dm) {
  const now = new Date();
  const info = dm.getSemesterInfo();
  const courses = dm.getTodayCourses(state.currentClass);
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  const isWeekend = weekday >= 6;

  let newState = getTodayState(courses, now);
  if (isWeekend && courses.length === 0) {
    newState = { ...newState, state: 'WEEKEND' };
  }

  const freeTimeInfo = calculateFreeTime(courses, now);

  // Update clock
  const clockEl = document.getElementById('dash-clock');
  if (clockEl) {
    const display = formatClockDisplay(now, state.settings.timeFormat !== '12h');
    clockEl.innerHTML = `${display.main}<span class="seconds">${display.seconds}</span>${display.ampm ? ` <span style="font-size:12px;color:var(--color-text-tertiary);">${display.ampm}</span>` : ''}`;
  }

  // Check if major state changed (requires re-render of status block)
  const majorStateChanged =
    newState.state !== dashState.state ||
    newState.currentCourse?.courseName !== dashState.currentCourse?.courseName ||
    newState.nextCourse?.courseName !== dashState.nextCourse?.courseName;

  if (majorStateChanged) {
    dashState = { courses, ...newState };
    const stateInfo = STATE_LABELS[newState.state] || STATE_LABELS.NO_CLASS;
    const displayCourse = newState.currentCourse || newState.nextCourse;

    const statusEl = document.getElementById('dash-status');
    if (statusEl) {
      statusEl.className = `today-status accent-${stateInfo.accent}`;
      statusEl.style.animation = 'none';
      statusEl.offsetHeight; // trigger reflow
      statusEl.style.animation = 'statusSwap var(--duration-normal) var(--ease-out)';
      statusEl.innerHTML = renderStatusBlock(newState, displayCourse, stateInfo, state, freeTimeInfo);
      attachCourseClickHandlers(statusEl, courses);
    }

    // Re-render timeline when state changes
    const timelineEl = document.getElementById('dash-timeline');
    if (timelineEl) {
      timelineEl.innerHTML = renderTimeline(courses, newState, now, state);
      attachCourseClickHandlers(timelineEl, courses);
    }
    return;
  }

  // Minor updates only (countdown, progress)
  dashState = { courses, ...newState };

  const countdownEl = document.getElementById('dash-countdown');
  if (countdownEl && newState.countdown != null) {
    countdownEl.textContent = formatCountdownHuman(newState.countdown);
  }

  const countdownSecEl = document.getElementById('dash-countdown-sec');
  if (countdownSecEl && newState.countdown != null) {
    countdownSecEl.textContent = formatCountdown(newState.countdown);
  }

  const progressEl = document.getElementById('dash-progress');
  if (progressEl && newState.currentCourse) {
    progressEl.style.width = `${getProgressPercent(newState.currentCourse, now)}%`;
  }

  // Update timeline current state indicator without full re-render
  const timelineEl = document.getElementById('dash-timeline');
  if (timelineEl && courses.length > 0) {
    // Update "now" gap indicator
    const gapEls = timelineEl.querySelectorAll('.tl-gap');
    gapEls.forEach((gapEl, idx) => {
      const prevCourse = courses[idx];
      const nextCourse = courses[idx + 1];
      if (prevCourse?.endDateTime && nextCourse?.startDateTime) {
        const isNow = now >= prevCourse.endDateTime && now < nextCourse.startDateTime;
        gapEl.classList.toggle('now', isNow);
      }
    });

    // Update course item states
    const itemEls = timelineEl.querySelectorAll('.tl-item');
    itemEls.forEach((itemEl, idx) => {
      const c = courses[idx];
      if (!c) return;
      const courseState = getCourseState(c, now);

      itemEl.classList.remove('tl-finished', 'tl-in-progress', 'tl-before');
      if (courseState === 'finished') itemEl.classList.add('tl-finished');
      else if (courseState === 'in_progress') itemEl.classList.add('tl-in-progress');
      else itemEl.classList.add('tl-before');

      const marker = itemEl.querySelector('.tl-marker');
      if (marker) marker.classList.toggle('active', courseState === 'in_progress');
    });

    // Update end state
    const endEl = timelineEl.querySelector('.tl-end');
    if (endEl && courses.length > 0) {
      const lastCourse = courses[courses.length - 1];
      const allDone = lastCourse.endDateTime && now >= lastCourse.endDateTime;
      endEl.classList.toggle('done', allDone);
    }
  }
}
