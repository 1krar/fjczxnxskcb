import { getCurrentWeek, getWeekDates, getSectionTime, getCourseState, getNextCourse, localDate, seasonForDate } from './time.js?v=20261029-5';
import { segmentMarkup } from './course-segments.js?v=20261029-5';
import { showCourseDetail } from './app.js?v=20261029-5';
import { formatLocation } from './location.js?v=20261029-5';
import { getDayWindow } from './day-plan.js?v=20261029-5';
import { getDaySlots, courseSectionRange } from './day-slots.js?v=20261029-5';
import { escapeText as esc } from './tasks-store.js?v=20261029-5';
import { readStudyData, STUDY_STATUS_LABELS } from './study-store.js?v=20261029-5';
import { applyEveningStudy } from './study-model.js?v=20261029-5';

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
  for (let d = 1; d <= 7; d++) {
    const courses = coursesByDay[d] || [];
    for (let i = 0; i < courses.length; i++) {
      for (let j = i + 1; j < courses.length; j++) {
        const a = courses[i];
        const b = courses[j];
        const aRange = courseSectionRange(a), bRange = courseSectionRange(b);
        if (!aRange || !bRange) continue;
        // Time overlap
        const aStart = aRange.start;
        const aEnd = aRange.end;
        const bStart = bRange.start;
        const bEnd = bRange.end;
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

function slotStrip(model, now) {
  const labels = { occupied: '有课', unassigned: '未排课', unknown: '待确认',study:'晚自习',arranged:'其他安排',excused:'晚自习已请假' };
  return `<section class="day-slots" aria-label="当天节次分布"><div class="day-slots-caption"><span>节次分布</span><span class="day-slots-legend"><i class="is-occupied" aria-hidden="true"></i>有课 <i class="is-unassigned" aria-hidden="true"></i>未排课${model.periods.some(period => period.state === 'unknown') ? ' · ? 待确认' : ''}</span></div><div class="day-slots-blocks">${model.blocks.map(block => `<div class="day-slots-block"><span class="day-slots-label">${block.label}</span><div class="day-slots-periods">${model.periods.filter(period => period.block === block.id).map(period => {
    const current = period.start && now >= period.start && now < period.end;
    const description = `第${period.section}节 ${period.startTime ? `${period.startTime}—${period.endTime} ` : ''}${labels[period.state]}${period.courses.length ? `：${period.courses.map(course => course.courseName).join('、')}` : ''}${period.reason ? `，${period.reason}` : ''}`;
    const mark={unknown:'?',study:'自',arranged:'另',excused:'假'}[period.state];
    return `<span class="day-slot is-${period.state}${current ? ' is-current' : ''}" title="${esc(description)}" aria-label="${esc(description)}"${period.start ? ` data-school-start="${+period.start}" data-school-end="${+period.end}"` : ''}${current ? ' aria-current="time"' : ''}>${period.section}${mark?`<small>${mark}</small>`:''}</span>`;
  }).join('')}</div></div>`).join('')}</div>${model.reason ? `<p class="day-slots-note">${esc(model.reason)}；待确认时段暂不判断是否未排课。</p>` : '<p class="day-slots-note">依据当前导入课表；个人活动请看日历。</p>'}</section>`;
}

function slotAgendaRow(entry, now) {
  if (entry.kind === 'unassigned') {
    const sections = entry.startSection === entry.endSection ? `第${entry.startSection}节` : `第${entry.startSection}—${entry.endSection}节`;
    const current = now >= entry.start && now < entry.end;
    return `<div class="m-unassigned${current ? ' is-current' : ''}" data-school-start="${+entry.start}" data-school-end="${+entry.end}"><span class="mono">${entry.startTime}—${entry.endTime}</span><span>${sections}未排课<small${current ? '' : ' hidden'}>当前时段</small></span></div>`;
  }
  return `<div class="m-school-break"><span>${entry.kind === 'lunch' ? '午间' : '课间'}</span><span class="mono">${entry.startTime}—${entry.endTime}</span>${entry.kind === 'break' ? `<span>${entry.durationMin}分钟</span>` : ''}</div>`;
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
  }

  // Busiest day
  let busiestDay = 1;
  let maxPeriods = 0;
  for (let d = 1; d <= 7; d++) {
    if (byDay[d] > maxPeriods) {
      maxPeriods = byDay[d];
      busiestDay = d;
    }
  }

  // Weekday window, shared with Analytics; merge overlaps and clip to 08:00—21:00.
  const dayFree = {};
  const dates = getWeekDates(week, dm.getSemesterInfo().semesterStart);
  for (let d = 1; d <= 5; d++) {
    const window = getDayWindow(courses.filter(course => course.weekday === d), dates[d - 1]);
    dayOccupiedMin[d] = window.occupiedMin;
    dayFree[d] = window.freeMin;
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
    busiestDayName: ['一', '二', '三', '四', '五', '六', '日'][busiestDay - 1] || '一',
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
  let studyData=null;try{studyData=readStudyData();}catch{/* Original course data stays readable. */}
  const studyCourseCache=new Map();
  function coursesOnDay(week,day){
    const key=`${week}:${day}`;
    if(!studyCourseCache.has(key)){
      const original=dm.getCoursesByWeekday(state.currentClass,week,day),date=getWeekDates(week,info.semesterStart)[day-1];
      studyCourseCache.set(key,studyData?applyEveningStudy(original,date,{sectionTimes,seasonRule:info.seasonRule,semesterInfo:info,studyData,className:state.currentClass}):original);
    }
    return studyCourseCache.get(key);
  }
  scheduleState.week = state.scheduleFollowToday !== false ? Math.max(info.firstWeek, Math.min(info.lastWeek, getCurrentWeek(info.semesterStart))) : state.scheduleWeek || Math.max(info.firstWeek, Math.min(info.lastWeek, getCurrentWeek(info.semesterStart)));

  const currentWeek = Math.max(1, getCurrentWeek(info.semesterStart));
  const now = new Date();
  const todayStr = localDate(now);
  const todayWeekday = now.getDay() === 0 ? 7 : now.getDay();

  if (state.scheduleFollowToday !== false && scheduleState.week === currentWeek) {
    scheduleState.selectedDay = todayWeekday;
  } else {
    scheduleState.selectedDay = scheduleState.selectedDay || 1;
    if (scheduleState.selectedDay > 7) scheduleState.selectedDay = 1;
  }

  const isMobile = () => window.innerWidth <= 768;

  function buildHTML() {
    const now = new Date();
    const todayStr = localDate(now);
    const currentWeek = Math.max(1, getCurrentWeek(info.semesterStart));
    const week = scheduleState.week;
    const weekDates = getWeekDates(week, info.semesterStart);
    const isCurrentWeek = week === currentWeek;
    const mobile = isMobile();

    // Common data
    const coursesByDay = {};
    for (let d = 1; d <= 7; d++) {
      coursesByDay[d] = coursesOnDay(week, d);
    }
    const conflicts = detectConflicts(coursesByDay);
    const weekStats = getWeekStats(dm, state.currentClass, week);

    const season = seasonForDate(isCurrentWeek ? todayStr : weekDates[0], Object.values(coursesByDay).flat(), info.seasonRule);

    if (mobile) {
      return buildMobileView({ week, weekDates, todayStr, isCurrentWeek, currentWeek, coursesByDay, conflicts, weekStats, season, sectionTimes, state, info, dm, now });
    } else {
      return buildDesktopView({ week, weekDates, todayStr, isCurrentWeek, currentWeek, coursesByDay, conflicts, weekStats, season, sectionTimes, state, info, dm, now });
    }
  }

  // ========== Desktop View ==========
  function buildDesktopView({ week, weekDates, todayStr, isCurrentWeek, coursesByDay, conflicts, weekStats, season, sectionTimes, state, info, dm, now }) {
    const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const hasAnyCourse = Object.values(coursesByDay).some(arr => arr.length > 0);

    let html = `
      <div class="sch-header">
        <div class="sch-header-left">
          <div class="sch-title-label">课表</div>
          <div class="sch-class-name">${state.currentClass}</div>
        </div>
        <div class="sch-week-nav">
          <button class="sch-week-btn" id="week-prev" aria-label="上一周" ${week <= info.firstWeek ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="sch-week-info">
            <div class="sch-week-main">第 ${week} 周</div>
            <div class="sch-week-sub mono">${weekDates[0].slice(5)} — ${weekDates[6].slice(5)}</div>
          </div>
          <button class="sch-week-btn" id="week-next" aria-label="下一周" ${week >= info.lastWeek ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          ${!isCurrentWeek ? `<button class="sch-today-btn" id="week-today">本周</button>` : ''}
        </div>
        <div class="sch-header-right">
          <button class="sch-search-btn" id="search-toggle-btn" aria-label="搜索课程" title="搜索">
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

  function buildDesktopGrid({ week, weekDates, todayStr, isCurrentWeek, coursesByDay, conflicts, season, sectionTimes, state, info, now, dayNames, hasAnyCourse }) {
    const daySlots = Object.fromEntries(weekDates.map((date, index) => [index + 1, getDaySlots({ date,
      courses: coursesByDay[index + 1], sectionTimes, seasonRule: info.seasonRule, semesterInfo: info })]));

    // Compute ONE nextCourse across all week courses (not per-day)
    const allWeekCourses = [];
    for (let d = 1; d <= 7; d++) {
      for (const c of coursesByDay[d]) {
        allWeekCourses.push(c);
      }
    }
    const nextCourse = isCurrentWeek ? getNextCourse(allWeekCourses.filter(course=>course.studyStatus!=='excused'), now) : null;

    const timePos = isCurrentWeek ? getCurrentTimePosition(sectionTimes, season, now) : { visible: false };
    const todayCol = (() => {
      if (!isCurrentWeek) return -1;
      const wd = now.getDay() === 0 ? 7 : now.getDay();
      return wd;
    })();

    let gridHTML = '';
    gridHTML += `<div class="sch-grid-corner"><span>节次</span></div>`;

    for (let d = 0; d < 7; d++) {
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

      for (let d = 1; d <= 7; d++) {
        const course = coursesByDay[d].find(c => courseSectionRange(c)?.start === s);
        if (course) {
          const range = courseSectionRange(course);
          const span = range.end - range.start + 1;
          const cState = course.studyStatus==='excused'?'excused':getCourseState(course, now);
          const isNext = nextCourse && course === nextCourse && cState === 'before';
          const hasConflict = conflicts.some(c => c.day === d && c.courses.includes(course));
          const hue = getCourseColor(course.courseName);

          let cardClass = 'sch-course';
          if(course.source==='evening-study')cardClass+=' is-study';
          if(course.studyStatus==='excused')cardClass+=' is-excused';
          if (cState === 'finished') cardClass += ' finished';
          if (cState === 'in_progress') cardClass += ' in-progress';
          if (isNext) cardClass += ' next';
          if (hasConflict) cardClass += ' conflict';

          gridHTML += `<div class="${cardClass}" style="grid-row:${s + 1} / span ${span};grid-column:${d + 1};--course-hue:${hue}deg;" data-course-id="${d}-${s}">
            <div class="sch-course-bar"></div>
            <div class="sch-course-body">
              <button type="button" class="sch-course-name" aria-label="${course.source==='evening-study'?'调整晚自习安排':'查看课程详情'}：${esc(course.courseName)}">${esc(course.courseName)}</button>
              ${course.source==='evening-study'?`<div class="study-row-status">${esc(STUDY_STATUS_LABELS[course.studyStatus]||course.studyLabel)}${course.studyArrangementTitle&&course.studyStatus!=='other'?` · ${esc(course.studyArrangementTitle)}`:''}</div>`:''}
              ${course.studyNote?`<div class="sch-course-loc">${esc(course.studyNote)}</div>`:''}
              ${course.location ? `<div class="sch-course-loc">${formatLocation(course.location, state.settings.showFullLocation)}</div>` : ''}
              ${state.settings.showTeacher && course.teacher ? `<div class="sch-course-teacher">${course.teacher}</div>` : ''}
              <div class="sch-course-sec mono">第${range.start}-${range.end}节</div>
              ${hasConflict ? `<div class="sch-conflict-tag">冲突</div>` : ''}
            </div>
          </div>`;
        } else {
          const isOccupied = coursesByDay[d].some(c => { const range = courseSectionRange(c); return range && s > range.start && s <= range.end; });
          if (!isOccupied) {
            const period = daySlots[d].periods[s - 1];
            const label = period.state === 'unknown' ? `待确认：${period.reason}` : `第${s}节未排课`;
            gridHTML += `<div class="sch-cell is-${period.state}" style="grid-row:${s + 1};grid-column:${d + 1};" title="${esc(label)}" aria-label="${esc(label)}"><span class="sch-cell-marker" aria-hidden="true">${period.state === 'unknown' ? '?' : '—'}</span></div>`;
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
      <p class="sch-slots-legend">${!hasAnyCourse ? `${esc(Object.values(daySlots).find(model => model.reason)?.reason || `第${week}周暂无课程记录`)} · ` : ''}— 未排课 · ? 待确认。个人活动请看日历。</p>
      <div class="sch-grid-wrapper">
        <div class="sch-grid" style="--schedule-days:7;grid-template-rows: 40px repeat(10, minmax(44px, 1fr));">
          ${gridHTML}
          ${timeLineHTML}
        </div>
      </div>${Object.entries(daySlots).some(([, model]) => model.unknownCourses.length) ? `<div class="sch-unknown-courses"><span>节次待确认</span>${Object.entries(daySlots).map(([day, model]) => model.unknownCourses.map(course => `<button type="button" class="daily-text-button" data-unknown-course="${day}-${coursesByDay[day].indexOf(course)}">周${dayNames[Number(day) - 1].slice(-1)} · ${esc(course.courseName)}</button>`).join('')).join('')}</div>` : ''}`;
  }

  // ========== Mobile View ==========
  function buildMobileView({ week, weekDates, todayStr, isCurrentWeek, coursesByDay, conflicts, weekStats, season, sectionTimes, state, info, dm, now }) {
    const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
    const selectedDay = scheduleState.selectedDay;
    const dayCourses = coursesByDay[selectedDay] || [];
    const dayDateStr = weekDates[selectedDay - 1];
    const isDayToday = dayDateStr === todayStr;
    const daySlots = getDaySlots({ date: dayDateStr, courses: dayCourses, sectionTimes, seasonRule: info.seasonRule, semesterInfo: info });

    // Compute ONE nextCourse across all week courses (not per-day)
    const allWeekCourses = [];
    for (let d = 1; d <= 7; d++) {
      for (const c of coursesByDay[d]) {
        allWeekCourses.push(c);
      }
    }
    const nextCourse = isCurrentWeek ? getNextCourse(allWeekCourses.filter(course=>course.studyStatus!=='excused'), now) : null;

    let html = `
      <div class="m-sch-header">
        <div class="m-sch-week-row">
          <button class="m-sch-week-btn" id="week-prev" aria-label="上一周" ${week <= info.firstWeek ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div class="m-sch-week-info">
            <span class="m-sch-week-main">第 ${week} 周</span>
            <span class="m-sch-week-sub mono">${weekDates[0].slice(5)} — ${weekDates[6].slice(5)}</span>
          </div>
          <button class="m-sch-week-btn" id="week-next" aria-label="下一周" ${week >= info.lastWeek ? 'disabled' : ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          <button class="m-sch-search-btn" id="search-toggle-btn" aria-label="搜索课程">
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
    for (let d = 0; d < 7; d++) {
      const dateStr = weekDates[d];
      const isDayToday = dateStr === todayStr;
      const isActive = (d + 1) === selectedDay;
      const dayNum = dateStr.slice(8);
      html += `
        <button class="m-day-chip ${isDayToday ? 'today' : ''} ${isActive ? 'active' : ''}" data-day="${d + 1}" aria-pressed="${isActive}"${isDayToday ? ' aria-current="date"' : ''}>
          <span class="m-day-chip-name">周${dayNames[d]}</span>
          <span class="m-day-chip-date mono">${parseInt(dayNum)}</span>
        </button>`;
    }
    html += `</div>`;

    // Day title
    const fullDayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    html += `
      <div class="m-day-title-row">
        <span class="m-day-title">${fullDayNames[selectedDay - 1]}</span>
        <span class="m-day-title-date mono">${dayDateStr.slice(5)}</span>
        ${isDayToday ? '<span class="m-day-today-badge">今天</span>' : '<button type="button" class="daily-text-button" id="week-today">回到今天</button>'}
        <a class="study-day-edit" href="#/study?date=${esc(dayDateStr)}">晚自习安排</a>
      </div>`;

    html += slotStrip(daySlots, now);

    // Agenda
    html += `<div class="m-agenda" id="m-agenda">`;

    if (dayCourses.length === 0) {
      html += `<p class="m-slots-empty">${daySlots.reason ? esc(daySlots.reason) : `${isDayToday ? '今天' : '这天'}课表未排课程`}</p>`;
    }
    const dayEntries = [...dayCourses.map((course, index) => ({ kind: 'course', course, index, order: courseSectionRange(course)?.start || 11 })),
      ...daySlots.unassigned.map(entry => ({ ...entry, order: entry.startSection })),
      ...daySlots.separators.map(entry => ({ ...entry, order: entry.afterSection + 0.5 }))].sort((a, b) => a.order - b.order);
    for (const entry of dayEntries) {
      if (entry.kind !== 'course') { html += slotAgendaRow(entry, now); continue; }
        const i = entry.index;
        const c = dayCourses[i];
        const sectionRange = courseSectionRange(c);
        const cState = c.studyStatus==='excused'?'excused':sectionRange ? getCourseState(c, now) : 'unknown';
        const isNext = nextCourse && c === nextCourse && cState === 'before';
        const hue = getCourseColor(c.courseName);

        let itemClass = 'm-agenda-item';
        if(c.source==='evening-study')itemClass+=' is-study';
        if(c.studyStatus==='excused')itemClass+=' is-excused';
        if (cState === 'finished') itemClass += ' finished';
        if (cState === 'in_progress') itemClass += ' in-progress';
        if (isNext) itemClass += ' next';

        html += `
          <div class="${itemClass}" data-course-idx="${i}" style="--course-hue:${hue}deg;">
            <div class="m-ag-time">
              <span class="m-ag-start mono">${sectionRange ? c.startTime || '待确认' : '待确认'}</span>
              <span class="m-ag-end mono">${sectionRange ? c.endTime || '' : ''}</span>
            </div>
            <div class="m-ag-bar"></div>
            <div class="m-ag-body">
              ${cState === 'in_progress' ? `<div class="m-ag-now-tag">${c.source==='evening-study'?(c.studyStatus==='other'?'晚间安排':'正在晚自习'):'正在上课'}</div>` : ''}
              ${cState === 'break' ? '<div class="m-ag-break-tag">大课内课间</div>' : ''}
              ${isNext && cState === 'before' ? `<div class="m-ag-next-tag">${c.source==='evening-study'?'下一项':'下一次课'}</div>` : ''}
              <button type="button" class="m-ag-name" aria-label="${c.source==='evening-study'?'调整晚自习安排':'查看课程详情'}：${esc(c.courseName)}">${esc(c.courseName)}</button>
              ${c.source==='evening-study'?`<p class="study-row-status">${esc(STUDY_STATUS_LABELS[c.studyStatus]||c.studyLabel)}${c.studyArrangementTitle&&c.studyStatus!=='other'?` · ${esc(c.studyArrangementTitle)}`:''}${c.studyNote?` · ${esc(c.studyNote)}`:''}</p>`:''}
              <div class="m-ag-meta">
                ${c.location ? `<span class="m-ag-loc">${formatLocation(c.location, state.settings.showFullLocation)}</span>` : ''}
                ${state.settings.showTeacher && c.teacher ? `<span class="m-ag-teacher">${c.teacher}</span>` : ''}
              </div>
              <div class="m-ag-sec mono">${sectionRange ? `第${sectionRange.start}-${sectionRange.end}节` : '原记录节次待确认'}</div>
              ${sectionRange&&c.studyStatus!=='excused' ? segmentMarkup(c) : ''}
            </div>
          </div>`;

    }

    html += `</div>`; // close m-agenda

    // Week Summary (mobile)
    html += `<details class="m-week-overview"><summary>本周概览 · ${weekStats.totalPeriods} 节 · ${weekStats.totalHours} 小时</summary>${buildWeekSummary(weekStats, conflicts, 'mobile')}</details>`;

    html += `<div id="search-results-container"></div>`;
    return html;
  }

  // ========== Week Summary ==========
  function buildWeekSummary(stats, conflicts, mode) {
    const maxPeriods = Math.max(...Object.values(stats.byDay));
    const dayNames = ['一', '二', '三', '四', '五', '六', '日'];

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
            <span class="sch-stat-label">教学时长 / 小时</span>
          </div>
          <div class="sch-stat-item">
            <span class="sch-stat-num">周${stats.busiestDayName}</span>
            <span class="sch-stat-label">最忙</span>
          </div>
          <div class="sch-stat-item">
            <span class="sch-stat-num mono">${formatMinCompact(Math.round(stats.totalFreeMin / 5))}</span>
            <span class="sch-stat-label">工作日日均无课</span>
          </div>
        </div>

        <p class="sch-window-note">课程统计不含晚自习；无课统计范围为周一至周五08:00—21:00，未扣除吃饭、通勤和个人安排。</p>
        <div class="sch-load">
          <div class="sch-load-label">本周课程负荷</div>
          <div class="sch-load-bars">
            ${[1,2,3,4,5,6,7].map(d => {
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
                <span>周${['一','二','三','四','五','六','日'][c.day-1]} 第${c.sections}节</span>
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
  container.innerHTML = `<nav class="agenda-view-switch" aria-label="课表视图"><a href="#/schedule" aria-current="page">周课表</a><a href="#/agenda">日历与日程</a><a href="#/reminders">提醒设置</a></nav>` + buildHTML();
  attachEvents();

  // Tick (real-time updates)
  let lastTickMinute = -1;
  tickHandler = () => {
    const now = new Date();
    if (scheduleState.week !== Math.max(1, getCurrentWeek(info.semesterStart))) return;

    // Update every minute for state changes, every second for time line
    const currentMin = now.getMinutes();
    const season = seasonForDate(localDate(now), dm.getCoursesByDate(state.currentClass, localDate(now)), info.seasonRule);

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
    container.querySelectorAll('[data-school-start]').forEach(element => {
      const current = +now >= Number(element.dataset.schoolStart) && +now < Number(element.dataset.schoolEnd);
      element.classList.toggle('is-current', current);
      if (element.classList.contains('day-slot')) {
        if (current) element.setAttribute('aria-current', 'time');
        else element.removeAttribute('aria-current');
      } else {
        const label = element.querySelector('small');
        if (label) label.hidden = !current;
      }
    });
    // Collect ALL week courses to compute ONE nextCourse
    const allWeekCourses = [];
    for (let d = 1; d <= 7; d++) {
      const dayCs = coursesOnDay(scheduleState.week, d);
      for (const c of dayCs) allWeekCourses.push(c);
    }
    const nextCourse = getNextCourse(allWeekCourses.filter(course=>course.studyStatus!=='excused'), now);

    // Desktop course cards
    container.querySelectorAll('.sch-course').forEach(card => {
      if (!card.dataset.courseId) return;
      const [day, section] = card.dataset.courseId.split('-').map(Number);
      const courses = coursesOnDay(scheduleState.week, day);
      const c = courses.find(course => courseSectionRange(course)?.start === section);
      if (!c) return;

      const cState = c.studyStatus==='excused'?'excused':getCourseState(c, now);
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
      const dayCourses = coursesOnDay(scheduleState.week, scheduleState.selectedDay);
      const c = dayCourses[idx];
      if (!c) return;

      const cState = c.studyStatus==='excused'?'excused':courseSectionRange(c) ? getCourseState(c, now) : 'unknown';
      const isNext = nextCourse && c === nextCourse && cState === 'before';

      item.classList.remove('finished', 'in-progress', 'next');
      if (cState === 'finished') item.classList.add('finished');
      if (cState === 'in_progress') item.classList.add('in-progress');
      if (isNext) item.classList.add('next');

      // Update NOW/NEXT tags
      const nowTag = item.querySelector('.m-ag-now-tag');
      item.querySelector('.m-ag-break-tag')?.remove();
      if (cState === 'break') item.querySelector('.m-ag-body')?.insertAdjacentHTML('afterbegin', '<div class="m-ag-break-tag">大课内课间</div>');
      const nextTag = item.querySelector('.m-ag-next-tag');
      if (cState === 'in_progress' && !nowTag) {
        const body = item.querySelector('.m-ag-body');
        if (body) body.insertAdjacentHTML('afterbegin', `<div class="m-ag-now-tag">${c.source==='evening-study'?(c.studyStatus==='other'?'晚间安排':'正在晚自习'):'正在上课'}</div>`);
      } else if (cState !== 'in_progress' && nowTag) {
        nowTag.remove();
      }
      if (isNext && !nextTag) {
        const body = item.querySelector('.m-ag-body');
        if (body) body.insertAdjacentHTML('afterbegin', `<div class="m-ag-next-tag">${c.source==='evening-study'?'下一项':'下一次课'}</div>`);
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
        scheduleState.week--; state.scheduleFollowToday=false;
        state.scheduleWeek = scheduleState.week;
        rerender();
      }
    });

    if (nextBtn) nextBtn.addEventListener('click', () => {
      if (scheduleState.week < info.lastWeek) {
        scheduleState.week++; state.scheduleFollowToday=false;
        state.scheduleWeek = scheduleState.week;
        rerender();
      }
    });

    if (todayBtn) todayBtn.addEventListener('click', () => {
      scheduleState.week = Math.max(info.firstWeek, Math.min(info.lastWeek, getCurrentWeek(info.semesterStart)));
      state.scheduleWeek = scheduleState.week;
      const now = new Date();
      const wd = now.getDay() === 0 ? 7 : now.getDay();
      scheduleState.selectedDay = wd; state.scheduleFollowToday=true;
      rerender();
    });

    container.querySelector('#schedule-empty-next')?.addEventListener('click', () => {
      scheduleState.week++; state.scheduleFollowToday=false; scheduleState.selectedDay = 1;
      state.scheduleWeek = scheduleState.week; rerender();
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
          scheduleState.selectedDay = parseInt(chip.dataset.day); state.scheduleFollowToday=getWeekDates(scheduleState.week,info.semesterStart)[scheduleState.selectedDay-1]===localDate(new Date());
          rerender();
        });
      });
      const active = dayPicker.querySelector('.m-day-chip.active');
      if (active) {
        const area=dayPicker.getBoundingClientRect(), chip=active.getBoundingClientRect();
        if (chip.right>area.right) dayPicker.scrollLeft+=chip.right-area.right;
        else if (chip.left<area.left) dayPicker.scrollLeft-=area.left-chip.left;
      }
    }

    // Course clicks - desktop
    container.querySelectorAll('[data-unknown-course]').forEach(button => {
      button.addEventListener('click', () => {
        const [day, index] = button.dataset.unknownCourse.split('-').map(Number);
        const course = coursesOnDay(scheduleState.week, day)[index];
        if (course) showCourseDetail(course);
      });
    });
    container.querySelectorAll('.sch-course').forEach(card => {
      card.addEventListener('click', () => {
        const [day, section] = card.dataset.courseId.split('-').map(Number);
        const courses = coursesOnDay(scheduleState.week, day);
        const course = courses.find(c => courseSectionRange(c)?.start === section);
        if (course) showCourseDetail(course);
      });
    });

    // Course clicks - mobile
    const agenda = document.getElementById('m-agenda');
    if (agenda) {
      agenda.querySelectorAll('.m-agenda-item').forEach(item => {
        item.addEventListener('click', event => {
          if (event.target.closest('.course-segments-details')) return;
          const idx = parseInt(item.dataset.courseIdx);
          const dayCourses = coursesOnDay(scheduleState.week, scheduleState.selectedDay);
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
              scheduleState.selectedDay = r.weekday || 1; state.scheduleFollowToday=r.date===localDate(new Date());
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
    const previous=container.contains(document.activeElement)?document.activeElement:null;
    const focusDay=previous?.dataset.day, focusId=previous?.id;
    container.innerHTML = `<nav class="agenda-view-switch" aria-label="课表视图"><a href="#/schedule" aria-current="page">周课表</a><a href="#/agenda">日历与日程</a><a href="#/reminders">提醒设置</a></nav>` + buildHTML();
    attachEvents();
    const next=focusDay?container.querySelector(`[data-day="${focusDay}"]`):focusId?container.querySelector(`#${CSS.escape(focusId)}`):null;
    if (next&&!next.disabled) next.focus({preventScroll:true});
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
