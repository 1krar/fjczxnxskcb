import { getCurrentWeek, getWeekDates, getSectionTime, getCourseState, getNextCourse } from './time.js';
import { showCourseDetail } from './app.js';

let tickHandler = null;
let scheduleState = { week: 1, selectedDay: 1, searchOpen: false };

// ========== Course Color Generator ==========
// Deterministic color based on course name (blue-palette hues)
function getCourseColor(courseName) {
  if (!courseName) return 0;
  let hash = 0;
  for (let i = 0; i < courseName.length; i++) {
    hash = ((hash << 5) - hash) + courseName.charCodeAt(i);
    hash |= 0;
  }
  return 200 + (Math.abs(hash) % 31);
}

// ========== Conflict Detection ==========
function detectConflicts(coursesByDay) {
  const conflicts = [];
  for (let d = 1; d <= 5; d++) {
    const courses = coursesByDay[d] || [];
    for (let i = 0; i < courses.length; i++) {
      for (let j = i + 1; j < courses.length; j++) {
        const a = courses[i];
        const b = courses[j];
        // Time overlap
        const aStart = a.startSection;
        const aEnd = a.endSection;
        const bStart = b.startSection;
        const bEnd = b.endSection;
        if (aStart <= bEnd && bStart <= aEnd) {
          conflicts.push({
            day: d,
            type: 'schedule',
            courses: [a, b],
            sections: `${Math.min(aStart, bStart)}-${Math.max(aEnd, bEnd)}`,
          });
        }
        // Room conflict (same room at same time)
        if (a.location && b.location && a.location === b.location && aStart <= bEnd && bStart <= aEnd) {
          conflicts.push({
            day: d,
            type: 'room',
            courses: [a, b],
            room: a.location,
            sections: `${Math.min(aStart, bStart)}-${Math.max(aEnd, bEnd)}`,
          });
        }
      }
    }
  }
  return conflicts;
}

// ========== Free Time Calculation ==========
function getDayFreeIntervals(courses, sectionTimes, season, dateStr) {
  if (courses.length === 0) return [];
  const intervals = [];

  // Sort by start time
  const sorted = [...courses].sort((a, b) => (a.startSection || 0) - (b.startSection || 0));

  // Gap between courses
  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const next = sorted[i + 1];
    const currEnd = getSectionTime(curr.endSection, season, sectionTimes);
    const nextStart = getSectionTime(next.startSection, season, sectionTimes);
    if (currEnd && nextStart && currEnd.end !== nextStart.start) {
      const endMin = timeToMin(currEnd.end);
      const startMin = timeToMin(nextStart.start);
      const diffMin = startMin - endMin;
      if (diffMin > 5) {
        intervals.push({
          type: 'free',
          start: currEnd.end,
          end: nextStart.start,
          durationMin: diffMin,
        });
      }
    }
  }

  return intervals;
}

function timeToMin(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// ========== Week Stats ==========
function getWeekStats(dm, className, week) {
  const courses = dm.getCoursesByWeek(className, week);
  const uniqueCourses = new Set();
  let totalPeriods = 0;
  let totalMinutes = 0; // 教学时长：每节 45 分钟
  let totalOccupiedMin = 0; // 时间占用：含课间休息（用于空闲时间估算）
  const byDay = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const dayOccupiedMin = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const MINUTES_PER_SECTION = 45;

  for (const c of courses) {
    uniqueCourses.add(c.courseName);
    const sections = c.endSection - c.startSection + 1;
    totalPeriods += sections;
    byDay[c.weekday] = (byDay[c.weekday] || 0) + sections;
    // 教学时长按每节 45 分钟计算
    totalMinutes += sections * MINUTES_PER_SECTION;
    // 时间占用（含课间）用于空闲时间估算
    if (c.startDateTime && c.endDateTime) {
      const occMin = Math.round((c.endDateTime - c.startDateTime) / 60000);
      totalOccupiedMin += occMin;
      dayOccupiedMin[c.weekday] = (dayOccupiedMin[c.weekday] || 0) + occMin;
    }
  }

  // Busiest day
  let busiestDay = 1;
  let maxPeriods = 0;
  for (let d = 1; d <= 5; d++) {
    if (byDay[d] > maxPeriods) {
      maxPeriods = byDay[d];
      busiestDay = d;
    }
  }

  // Free time per day (approximate: 8:00-21:00 minus occupied time)
  const dayFree = {};
  for (let d = 1; d <= 5; d++) {
    const occMin = dayOccupiedMin[d] || 0;
    // Approximate free time between 8:00 and 21:00 = 780 min
    const freeMin = Math.max(0, 780 - occMin);
    dayFree[d] = freeMin;
  }
  const totalFreeMin = Object.values(dayFree).reduce((a, b) => a + b, 0);

  return {
    uniqueCourseCount: uniqueCourses.size,
    totalPeriods,
    totalHours: Math.round(totalMinutes / 60 * 10) / 10,
    totalMinutes,
    byDay,
    dayOccupiedMin,
    dayFree,
    totalFreeMin,
    busiestDay,
    busiestDayName: ['一', '二', '三', '四', '五'][busiestDay - 1] || '一',
  };
}

// ========== Current Time Position ==========
function getCurrentTimePosition(sectionTimes, season, now) {
  const times = sectionTimes[season];
  if (!times) return { topPercent: 0, visible: false };

  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

  // Find total range: section 1 start to section 10 end
  const firstStart = timeToMin(times['1']?.start || '08:00');
  const lastEnd = timeToMin(times['10']?.end || '21:00');
  const totalRange = lastEnd - firstStart;

  if (nowMin < firstStart || nowMin > lastEnd) {
    return { topPercent: 0, visible: false };
  }

  const topPercent = ((nowMin - firstStart) / totalRange) * 100;
  return { topPercent: Math.max(0, Math.min(100, topPercent)), visible: true };
}

// ========== Main Render ==========
export function renderSchedule(container, state, dm) {
  const info = dm.getSemesterInfo();
  const sectionTimes = dm.getSectionTimes();
  scheduleState.week = state.scheduleWeek || Math.max(info.firstWeek, Math.min(info.lastWeek, getCurrentWeek(info.semesterStart)));

  const currentWeek = Math.max(1, getCurrentWeek(info.semesterStart));
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayWeekday = now.getDay() === 0 ? 7 : now.getDay();

  if (scheduleState.week === currentWeek) {
    scheduleState.selectedDay = todayWeekday > 5 ? 1 : todayWeekday;
  } else {
    scheduleState.selectedDay = scheduleState.selectedDay || 1;
    if (scheduleState.selectedDay > 5) scheduleState.selectedDay = 1;
  }

  const isMobile = () => window.innerWidth <= 768;

  function buildHTML() {
    const week = scheduleState.week;
    const weekDates = getWeekDates(week, info.semesterStart);
    const isCurrentWeek = week === currentWeek;
    const mobile = isMobile();

    // Common data
    const coursesByDay = {};
    for (let d = 1; d <= 5; d++) {
      coursesByDay[d] = dm.getCoursesByWeekday(state.currentClass, week, d);
    }
    const conflicts = detectConflicts(coursesByDay);
    const weekStats = getWeekStats(dm, state.currentClass, week);

    // Determine season from first course with a season
    const season = getSeason(coursesByDay);

    if (mobile) {
      return buildMobileView({ week, weekDates, todayStr, isCurrentWeek, currentWeek, coursesByDay, conflicts, weekStats, season, sectionTimes, state, info, dm, now });
    } else {
      return buildDesktopView({ week, weekDates, todayStr, isCurrentWeek, currentWeek, coursesByDay, conflicts, weekStats, season, sectionTimes, state, info, dm, now });
    }
  }

  function getSeason(coursesByDay) {
    for (let d = 1; d <= 5; d++) {
      const c = coursesByDay[d]?.[0];
      if (c?.season) return c.season;
    }
    return 'summer';
  }

  // ========== Desktop View ==========
  function buildDesktopView({ week, weekDates, todayStr, isCurrentWeek, coursesByDay, conflicts, weekStats, season, sectionTimes, state, info, dm, now }) {
    const dayNames = ['周一', '周二', '周三', '周四', '周五'];
    const hasAnyCourse = Object.values(coursesByDay).some(arr => arr.length > 0);

    let html = `
      <div class="sch-header">
        <div class="sch-header-left">
          <div class="sch-title-label">课表</div>
          <div class="sch-class-name">${state.currentClass}</div>
        </div>
        <div class="sch-week-nav">
          <button class="sch-week-btn" id="week-prev" ${week <= info.firstWeek ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="sch-week-info">
            <div class="sch-week-main">第 ${week} 周</div>
            <div class="sch-week-sub mono">${weekDates[0].slice(5)} — ${weekDates[4].slice(5)}</div>
          </div>
          <button class="sch-week-btn" id="week-next" ${week >= info.lastWeek ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          ${!isCurrentWeek ? `<button class="sch-today-btn" id="week-today">本周</button>` : ''}
        </div>
        <div class="sch-header-right">
          <button class="sch-search-btn" id="search-toggle-btn" title="搜索">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>
        </div>
      </div>`;

    if (scheduleState.searchOpen) {
      html += `
        <div class="sch-search-bar" id="sch-search-bar">
          <svg class="sch-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" class="sch-search-input" id="schedule-search" placeholder="搜索课程、教师、教室…" />
          <button class="sch-search-close" id="search-close-btn">关闭</button>
        </div>`;
    }

    // Grid
    html += buildDesktopGrid({ week, weekDates, todayStr, isCurrentWeek, coursesByDay, conflicts, weekStats, season, sectionTimes, state, info, dm, now, dayNames, hasAnyCourse });

    // Week Summary
    html += buildWeekSummary(weekStats, conflicts, 'desktop');

    html += `<div id="search-results-container"></div>`;
    return html;
  }

  function buildDesktopGrid({ week, weekDates, todayStr, isCurrentWeek, coursesByDay, conflicts, season, sectionTimes, state, now, dayNames, hasAnyCourse }) {
    if (!hasAnyCourse) {
      return `
        <div class="sch-empty-week">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--color-text-tertiary);margin-bottom:10px;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <div class="sch-empty-title">第 ${week} 周没有课程安排</div>
          <div class="sch-empty-sub">${weekDates[0].slice(5)} — ${weekDates[4].slice(5)}</div>
        </div>`;
    }

    // Compute ONE nextCourse across all week courses (not per-day)
    const allWeekCourses = [];
    for (let d = 1; d <= 5; d++) {
      for (const c of coursesByDay[d]) {
        allWeekCourses.push(c);
      }
    }
    const nextCourse = isCurrentWeek ? getNextCourse(allWeekCourses, now) : null;

    const timePos = isCurrentWeek ? getCurrentTimePosition(sectionTimes, season, now) : { visible: false };
    const todayCol = (() => {
      if (!isCurrentWeek) return -1;
      const wd = now.getDay() === 0 ? 7 : now.getDay();
      return wd <= 5 ? wd : -1;
    })();

    let gridHTML = '';
    gridHTML += `<div class="sch-grid-corner"><span>节次</span></div>`;

    for (let d = 0; d < 5; d++) {
      const dateStr = weekDates[d];
      const isToday = dateStr === todayStr;
      gridHTML += `<div class="sch-day-header ${isToday ? 'today' : ''}" style="grid-column:${d + 2};">
        <div class="sch-day-name">${dayNames[d]}</div>
        <div class="sch-day-date mono">${dateStr.slice(5)}</div>
      </div>`;
    }

    for (let s = 1; s <= 10; s++) {
      const st = sectionTimes[season]?.[String(s)];
      const stStart = st ? st.start.slice(0, 5) : '';
      const stEnd = st ? st.end.slice(0, 5) : '';
      gridHTML += `<div class="sch-section-label" style="grid-row:${s + 1};">
        <span class="sch-section-num">${s}</span>
        ${stStart ? `<span class="sch-section-time mono">${stStart}</span>` : ''}
      </div>`;

      for (let d = 1; d <= 5; d++) {
        const course = coursesByDay[d].find(c => c.startSection === s);
        if (course) {
          const span = course.endSection - course.startSection + 1;
          const cState = getCourseState(course, now);
          const isNext = nextCourse && course === nextCourse && cState === 'before';
          const hasConflict = conflicts.some(c => c.day === d && c.courses.includes(course));
          const hue = getCourseColor(course.courseName);

          let cardClass = 'sch-course';
          if (cState === 'finished') cardClass += ' finished';
          if (cState === 'in_progress') cardClass += ' in-progress';
          if (isNext) cardClass += ' next';
          if (hasConflict) cardClass += ' conflict';

          gridHTML += `<div class="${cardClass}" style="grid-row:${s + 1} / span ${span};grid-column:${d + 1};--course-hue:${hue}deg;" data-course-id="${d}-${s}">
            <div class="sch-course-bar"></div>
            <div class="sch-course-body">
              <div class="sch-course-name">${course.courseName}</div>
              ${course.location ? `<div class="sch-course-loc">${course.location}</div>` : ''}
              ${state.settings.showTeacher && course.teacher ? `<div class="sch-course-teacher">${course.teacher}</div>` : ''}
              <div class="sch-course-sec mono">第${course.startSection}-${course.endSection}节</div>
              ${hasConflict ? `<div class="sch-conflict-tag">冲突</div>` : ''}
            </div>
          </div>`;
        } else {
          const isOccupied = coursesByDay[d].some(c => s > c.startSection && s <= c.endSection);
          if (!isOccupied) {
            gridHTML += `<div class="sch-cell" style="grid-row:${s + 1};grid-column:${d + 1};"></div>`;
          }
        }
      }
    }

    // Current time line overlay
    let timeLineHTML = '';
    if (timePos.visible && todayCol > 0) {
      timeLineHTML = `
        <div class="sch-now-line" id="sch-now-line" style="grid-column:${todayCol + 1};top:${timePos.topPercent}%;">
          <div class="sch-now-dot"></div>
          <div class="sch-now-label mono">${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}</div>
        </div>`;
    }

    return `
      <div class="sch-grid-wrapper">
        <div class="sch-grid" style="grid-template-rows: 40px repeat(10, minmax(44px, 1fr));">
          ${gridHTML}
          ${timeLineHTML}
        </div>
      </div>`;
  }

  // ========== Mobile View ==========
  function buildMobileView({ week, weekDates, todayStr, isCurrentWeek, coursesByDay, conflicts, weekStats, season, sectionTimes, state, info, dm, now }) {
    const dayNames = ['一', '二', '三', '四', '五'];
    const selectedDay = scheduleState.selectedDay;
    const dayCourses = coursesByDay[selectedDay] || [];
    const dayDateStr = weekDates[selectedDay - 1];
    const isDayToday = dayDateStr === todayStr;
    const freeIntervals = getDayFreeIntervals(dayCourses, sectionTimes, season, dayDateStr);

    // Compute ONE nextCourse across all week courses (not per-day)
    const allWeekCourses = [];
    for (let d = 1; d <= 5; d++) {
      for (const c of coursesByDay[d]) {
        allWeekCourses.push(c);
      }
    }
    const nextCourse = isCurrentWeek ? getNextCourse(allWeekCourses, now) : null;

    let html = `
      <div class="m-sch-header">
        <div class="m-sch-week-row">
          <button class="m-sch-week-btn" id="week-prev" ${week <= info.firstWeek ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="m-sch-week-info">
            <span class="m-sch-week-main">第 ${week} 周</span>
            <span class="m-sch-week-sub mono">${weekDates[0].slice(5)} — ${weekDates[4].slice(5)}</span>
          </div>
          <button class="m-sch-week-btn" id="week-next" ${week >= info.lastWeek ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          <button class="m-sch-search-btn" id="search-toggle-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>
        </div>`;

    if (scheduleState.searchOpen) {
      html += `
        <div class="m-sch-search-bar">
          <input type="text" class="m-sch-search-input" id="schedule-search" placeholder="搜索课程、教师、教室…" />
          <button class="m-sch-search-close" id="search-close-btn">取消</button>
        </div>`;
    }

    html += `</div>`; // close m-sch-header

    // Day picker (horizontal scroll)
    html += `<div class="m-day-picker" id="mobile-day-picker">`;
    for (let d = 0; d < 5; d++) {
      const dateStr = weekDates[d];
      const isDayToday = dateStr === todayStr;
      const isActive = (d + 1) === selectedDay;
      const dayNum = dateStr.slice(8);
      html += `
        <button class="m-day-chip ${isDayToday ? 'today' : ''} ${isActive ? 'active' : ''}" data-day="${d + 1}">
          <span class="m-day-chip-name">周${dayNames[d]}</span>
          <span class="m-day-chip-date mono">${parseInt(dayNum)}</span>
        </button>`;
    }
    html += `</div>`;

    // Day title
    const fullDayNames = ['周一', '周二', '周三', '周四', '周五'];
    html += `
      <div class="m-day-title-row">
        <span class="m-day-title">${fullDayNames[selectedDay - 1]}</span>
        <span class="m-day-title-date mono">${dayDateStr.slice(5)}</span>
        ${isDayToday ? '<span class="m-day-today-badge">今天</span>' : ''}
      </div>`;

    // Agenda
    html += `<div class="m-agenda" id="m-agenda">`;

    if (dayCourses.length === 0) {
      html += `
        <div class="m-agenda-empty">
          <div class="m-agenda-empty-title">今日无课</div>
          <div class="m-agenda-empty-sub">空闲日</div>
          <div class="m-agenda-empty-stats">
            <div class="m-empty-stat">
              <span class="m-empty-stat-num mono">00</span>
              <span class="m-empty-stat-label">课程</span>
            </div>
            <div class="m-empty-stat">
              <span class="m-empty-stat-num mono">00</span>
              <span class="m-empty-stat-label">节次</span>
            </div>
          </div>
        </div>`;
    } else {
      for (let i = 0; i < dayCourses.length; i++) {
        const c = dayCourses[i];
        const cState = getCourseState(c, now);
        const isNext = nextCourse && c === nextCourse && cState === 'before';
        const hue = getCourseColor(c.courseName);

        let itemClass = 'm-agenda-item';
        if (cState === 'finished') itemClass += ' finished';
        if (cState === 'in_progress') itemClass += ' in-progress';
        if (isNext) itemClass += ' next';

        html += `
          <div class="${itemClass}" data-course-idx="${i}" style="--course-hue:${hue}deg;">
            <div class="m-ag-time">
              <span class="m-ag-start mono">${c.startTime || ''}</span>
              <span class="m-ag-end mono">${c.endTime || ''}</span>
            </div>
            <div class="m-ag-bar"></div>
            <div class="m-ag-body">
              ${cState === 'in_progress' ? '<div class="m-ag-now-tag">正在上课</div>' : ''}
              ${isNext && cState === 'before' ? '<div class="m-ag-next-tag">下一节</div>' : ''}
              <div class="m-ag-name">${c.courseName}</div>
              <div class="m-ag-meta">
                ${c.location ? `<span class="m-ag-loc">${c.location}</span>` : ''}
                ${state.settings.showTeacher && c.teacher ? `<span class="m-ag-teacher">${c.teacher}</span>` : ''}
              </div>
              <div class="m-ag-sec mono">第${c.startSection}-${c.endSection}节</div>
            </div>
          </div>`;

        // Free interval after this course
        const nextCourseItem = i < dayCourses.length - 1 ? dayCourses[i + 1] : null;
        const freeInterval = freeIntervals.find(f => {
          if (!c.endTime || !nextCourseItem?.startTime) return false;
          return f.start === c.endTime && f.end === nextCourseItem.startTime;
        });
        if (freeInterval) {
          const isNowInFree = now >= new Date(c.date + 'T' + freeInterval.start + ':00') &&
                             now < new Date(c.date + 'T' + freeInterval.end + ':00');
          html += `
            <div class="m-ag-free ${isNowInFree ? 'now' : ''}">
              <div class="m-ag-free-line"></div>
              <div class="m-ag-free-text mono">
                ${isNowInFree ? '<span class="m-ag-free-now">空闲中</span>' : ''}
                <span>空闲 · ${formatMinCompact(freeInterval.durationMin)}</span>
              </div>
              <div class="m-ag-free-line"></div>
            </div>`;
        }
      }
    }

    html += `</div>`; // close m-agenda

    // Week Summary (mobile)
    html += buildWeekSummary(weekStats, conflicts, 'mobile');

    html += `<div id="search-results-container"></div>`;
    return html;
  }

  // ========== Week Summary ==========
  function buildWeekSummary(stats, conflicts, mode) {
    const maxPeriods = Math.max(...Object.values(stats.byDay));
    const dayNames = ['一', '二', '三', '四', '五'];

    return `
      <div class="sch-week-summary">
        <div class="sch-summary-label">本周概览</div>
        <div class="sch-summary-stats">
          <div class="sch-stat-item">
            <span class="sch-stat-num mono">${String(stats.uniqueCourseCount).padStart(2, '0')}</span>
            <span class="sch-stat-label">课程 / 门</span>
          </div>
          <div class="sch-stat-item">
            <span class="sch-stat-num mono">${String(stats.totalPeriods).padStart(2, '0')}</span>
            <span class="sch-stat-label">节次 / 节</span>
          </div>
          <div class="sch-stat-item">
            <span class="sch-stat-num mono">${stats.totalHours}</span>
            <span class="sch-stat-label">课时 / 小时</span>
          </div>
          <div class="sch-stat-item">
            <span class="sch-stat-num">周${stats.busiestDayName}</span>
            <span class="sch-stat-label">最忙</span>
          </div>
          <div class="sch-stat-item">
            <span class="sch-stat-num mono">${formatMinCompact(Math.round(stats.totalFreeMin / 5))}</span>
            <span class="sch-stat-label">日均空闲</span>
          </div>
        </div>

        <div class="sch-load">
          <div class="sch-load-label">本周课程负荷</div>
          <div class="sch-load-bars">
            ${[1,2,3,4,5].map(d => {
              const periods = stats.byDay[d] || 0;
              const height = maxPeriods > 0 ? (periods / maxPeriods) * 100 : 0;
              const isBusiest = d === stats.busiestDay;
              return `
                <div class="sch-load-col ${isBusiest ? 'busiest' : ''}">
                  <div class="sch-load-bar" style="height:${height}%;"></div>
                  <div class="sch-load-day">周${dayNames[d-1]}</div>
                </div>`;
            }).join('')}
          </div>
        </div>

        ${conflicts.length > 0 ? `
          <div class="sch-conflicts">
            <div class="sch-conflict-label">⚠ 检测到 ${conflicts.length} 个课程冲突</div>
            ${conflicts.slice(0, 3).map(c => `
              <div class="sch-conflict-item">
                <span>周${['一','二','三','四','五'][c.day-1]} 第${c.sections}节</span>
                <span>${c.type === 'room' ? `教室冲突：${c.room}` : '时间冲突'}</span>
              </div>`).join('')}
          </div>` : ''}
      </div>`;
  }

  // ========== Helpers ==========
  function formatMinCompact(min) {
    if (min <= 0) return '0m';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h${m}m`;
  }

  // ========== Render + Events ==========
  container.innerHTML = buildHTML();
  attachEvents();

  // Tick (real-time updates)
  let lastTickMinute = -1;
  tickHandler = () => {
    const now = new Date();
    if (scheduleState.week !== Math.max(1, getCurrentWeek(info.semesterStart))) return;

    // Update every minute for state changes, every second for time line
    const currentMin = now.getMinutes();
    const season = (() => {
      for (let d = 1; d <= 5; d++) {
        const c = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, d)[0];
        if (c?.season) return c.season;
      }
      return 'summer';
    })();

    // Update time line position (desktop)
    const timeLine = document.getElementById('sch-now-line');
    if (timeLine) {
      const timePos = getCurrentTimePosition(sectionTimes, season, now);
      if (timePos.visible) {
        timeLine.style.top = `${timePos.topPercent}%`;
        timeLine.style.display = '';
        const label = timeLine.querySelector('.sch-now-label');
        if (label) {
          label.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        }
      } else {
        timeLine.style.display = 'none';
      }
    }

    // Update course states only when minute changes
    if (currentMin !== lastTickMinute) {
      lastTickMinute = currentMin;
      updateCourseStates(now, dm, state, season);
    }
  };
  document.addEventListener('app:tick', tickHandler);

  function updateCourseStates(now, dm, state, season) {
    // Collect ALL week courses to compute ONE nextCourse
    const allWeekCourses = [];
    for (let d = 1; d <= 5; d++) {
      const dayCs = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, d);
      for (const c of dayCs) allWeekCourses.push(c);
    }
    const nextCourse = getNextCourse(allWeekCourses, now);

    // Desktop course cards
    container.querySelectorAll('.sch-course').forEach(card => {
      if (!card.dataset.courseId) return;
      const [day, section] = card.dataset.courseId.split('-').map(Number);
      const courses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, day);
      const c = courses.find(course => course.startSection === section);
      if (!c) return;

      const cState = getCourseState(c, now);
      const isNext = nextCourse && c === nextCourse && cState === 'before';

      card.classList.remove('finished', 'in-progress', 'next');
      if (cState === 'finished') card.classList.add('finished');
      if (cState === 'in_progress') card.classList.add('in-progress');
      if (isNext) card.classList.add('next');
    });

    // Mobile agenda items
    container.querySelectorAll('.m-agenda-item').forEach(item => {
      if (item.dataset.courseIdx == null) return;
      const idx = parseInt(item.dataset.courseIdx);
      const dayCourses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, scheduleState.selectedDay);
      const c = dayCourses[idx];
      if (!c) return;

      const cState = getCourseState(c, now);
      const isNext = nextCourse && c === nextCourse && cState === 'before';

      item.classList.remove('finished', 'in-progress', 'next');
      if (cState === 'finished') item.classList.add('finished');
      if (cState === 'in_progress') item.classList.add('in-progress');
      if (isNext) item.classList.add('next');

      // Update NOW/NEXT tags
      const nowTag = item.querySelector('.m-ag-now-tag');
      const nextTag = item.querySelector('.m-ag-next-tag');
      if (cState === 'in_progress' && !nowTag) {
        const body = item.querySelector('.m-ag-body');
        if (body) body.insertAdjacentHTML('afterbegin', '<div class="m-ag-now-tag">正在上课</div>');
      } else if (cState !== 'in_progress' && nowTag) {
        nowTag.remove();
      }
      if (isNext && !nextTag) {
        const body = item.querySelector('.m-ag-body');
        if (body) body.insertAdjacentHTML('afterbegin', '<div class="m-ag-next-tag">下一节</div>');
      } else if (!isNext && nextTag) {
        nextTag.remove();
      }
    });

    // Dev safeguard: warn if multiple NEXT elements exist
    if (typeof console !== 'undefined' && console.warn) {
      const nextCount = container.querySelectorAll('.sch-course.next, .m-agenda-item.next').length;
      if (nextCount > 1) {
        console.warn('NEXT 状态异常：存在多个下一节课程', nextCount);
      }
    }
  }

  function attachEvents() {
    // Week nav
    const prevBtn = document.getElementById('week-prev');
    const nextBtn = document.getElementById('week-next');
    const todayBtn = document.getElementById('week-today');

    if (prevBtn) prevBtn.addEventListener('click', () => {
      if (scheduleState.week > info.firstWeek) {
        scheduleState.week--;
        state.scheduleWeek = scheduleState.week;
        rerender();
      }
    });

    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (scheduleState.week < info.lastWeek) {
        scheduleState.week++;
        state.scheduleWeek = scheduleState.week;
        rerender();
      }
    });

    if (todayBtn) todayBtn.addEventListener('click', () => {
      scheduleState.week = Math.max(info.firstWeek, Math.min(info.lastWeek, getCurrentWeek(info.semesterStart)));
      state.scheduleWeek = scheduleState.week;
      const now = new Date();
      const wd = now.getDay() === 0 ? 7 : now.getDay();
      scheduleState.selectedDay = wd > 5 ? 1 : wd;
      rerender();
    });

    // Search toggle
    const searchToggleBtn = document.getElementById('search-toggle-btn');
    if (searchToggleBtn) {
      searchToggleBtn.addEventListener('click', () => {
        scheduleState.searchOpen = !scheduleState.searchOpen;
        rerender();
        if (scheduleState.searchOpen) {
          setTimeout(() => {
            const input = document.getElementById('schedule-search');
            if (input) input.focus();
          }, 100);
        }
      });
    }

    const searchCloseBtn = document.getElementById('search-close-btn');
    if (searchCloseBtn) {
      searchCloseBtn.addEventListener('click', () => {
        scheduleState.searchOpen = false;
        rerender();
      });
    }

    // Mobile day picker
    const dayPicker = document.getElementById('mobile-day-picker');
    if (dayPicker) {
      dayPicker.querySelectorAll('.m-day-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          scheduleState.selectedDay = parseInt(chip.dataset.day);
          rerender();
        });
      });
    }

    // Course clicks - desktop
    container.querySelectorAll('.sch-course').forEach(card => {
      card.addEventListener('click', () => {
        const [day, section] = card.dataset.courseId.split('-').map(Number);
        const courses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, day);
        const course = courses.find(c => c.startSection === section);
        if (course) showCourseDetail(course);
      });
    });

    // Course clicks - mobile
    const agenda = document.getElementById('m-agenda');
    if (agenda) {
      agenda.querySelectorAll('.m-agenda-item').forEach(item => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.courseIdx);
          const dayCourses = dm.getCoursesByWeekday(state.currentClass, scheduleState.week, scheduleState.selectedDay);
          if (dayCourses[idx]) showCourseDetail(dayCourses[idx]);
        });
      });
    }

    // Search input
    const searchInput = document.getElementById('schedule-search');
    if (searchInput) {
      let searchTimer;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        const query = e.target.value;
        searchTimer = setTimeout(() => {
          const resultsContainer = document.getElementById('search-results-container');
          if (!resultsContainer) return;
          if (!query.trim()) {
            resultsContainer.innerHTML = '';
            return;
          }
          const results = dm.searchAll(query);
          resultsContainer.innerHTML = renderSearchResults(results);
          resultsContainer.querySelectorAll('[data-result-idx]').forEach(item => {
            item.addEventListener('click', () => {
              const idx = parseInt(item.dataset.resultIdx);
              const r = results[idx];
              scheduleState.week = r.week;
              state.scheduleWeek = scheduleState.week;
              scheduleState.selectedDay = r.weekday || 1;
              scheduleState.searchOpen = false;
              rerender();
            });
          });
        }, 250);
      });
    }
  }

  function renderSearchResults(results) {
    if (results.length === 0) {
      return `<div class="sch-search-empty">未找到相关课程</div>`;
    }
    return `<div class="sch-search-results">
      <div class="sch-search-count">共找到 ${results.length} 条结果</div>
      ${results.slice(0, 30).map((r, i) => `
        <div class="sch-search-item" data-result-idx="${i}">
          <div class="sch-search-name">${r.courseName}</div>
          <div class="sch-search-meta mono">
            第${r.week}周 · 周${['日','一','二','三','四','五','六'][new Date(r.date+'T00:00:00').getDay()]} · 第${r.startSection}-${r.endSection}节
          </div>
          <div class="sch-search-sub">
            ${r.location ? `教室：${r.location}` : ''}
            ${r.teacher ? ` · 教师：${r.teacher}` : ''}
            ${r.className ? ` · 班级：${r.className}` : ''}
          </div>
        </div>`).join('')}
    </div>`;
  }

  function rerender() {
    container.innerHTML = buildHTML();
    attachEvents();
  }

  return function cleanup() {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  };
}

export function cleanupSchedule() {
  if (tickHandler) {
    document.removeEventListener('app:tick', tickHandler);
    tickHandler = null;
  }
}
