import { getCoursePhase } from './time.js?v=20261024-2';
// Shared course counts and time calculations. All intervals are [start, end).
const MINUTE = 60000;

function timedCourses(courses) {
  return courses.filter(course => course.startDateTime instanceof Date &&
    course.endDateTime instanceof Date && Number.isFinite(+course.startDateTime) &&
    Number.isFinite(+course.endDateTime) && course.endDateTime > course.startDateTime)
    .sort((a, b) => a.startDateTime - b.startDateTime);
}

export function courseKey(course) {
  return course ? [course.date, course.startSection, course.endSection, course.courseName, course.location].join('|') : '';
}

export function getCourseSummary(courses) {
  const totalSections = courses.reduce((sum, course) => sum + Math.max(0, course.endSection - course.startSection + 1), 0);
  const timed = timedCourses(courses);
  const last = timed.reduce((latest, course) => !latest || course.endDateTime > latest.endDateTime ? course : latest, null);
  return {
    sessionCount: courses.length,
    uniqueCourseCount: new Set(courses.map(course => course.courseName)).size,
    totalSections,
    totalHours: Math.round(courses.reduce((sum, course) => sum + (course.segments?.length ? course.segments.filter(part => part.kind === 'lesson').reduce((minutes, part) => minutes + (part.end - part.start) / MINUTE, 0) : (course.endSection - course.startSection + 1) * 45), 0) / 60 * 10) / 10,
    endTime: last?.endTime || '—',
  };
}

export function getCourseGaps(courses) {
  const sorted = timedCourses(courses);
  const gaps = [];
  let previous = sorted[0];
  for (const next of sorted.slice(1)) {
    if (next.startDateTime > previous.endDateTime) {
      gaps.push({ start: previous.endDateTime, end: next.startDateTime,
        durationMin: (next.startDateTime - previous.endDateTime) / MINUTE,
        previousCourse: previous, nextCourse: next });
    }
    // Keep the end of the occupied union, including nested or overlapping classes.
    if (next.endDateTime > previous.endDateTime) previous = next;
  }
  return gaps;
}

export function getFreeTimeInfo(courses, now) {
  const gaps = getCourseGaps(courses);
  const currentGap = gaps.find(gap => now >= gap.start && now < gap.end);
  const currentCourse = timedCourses(courses).find(course => now >= course.startDateTime && now < course.endDateTime);
  const nextGap = currentCourse ? gaps.find(gap => gap.start >= currentCourse.endDateTime) : null;
  return {
    gaps,
    internalBreakMin: courses.reduce((sum, course) => sum + (course.segments || []).filter(part => part.kind === 'break').reduce((minutes, part) => minutes + (part.end - part.start) / MINUTE, 0), 0),
    totalMin: Math.round(gaps.reduce((sum, gap) => sum + gap.durationMin, 0)),
    longestMin: Math.round(Math.max(0, ...gaps.map(gap => gap.durationMin))),
    isInFreeTime: Boolean(currentGap),
    // Keep exact milliseconds for countdowns; round only at presentation time.
    currentFreeMs: currentGap ? currentGap.end - now : 0,
    currentFreeEnd: currentGap?.end || null,
    nextFreeMin: nextGap?.durationMin || 0,
    nextFreeStart: nextGap?.start || null,
  };
}

export function getDayWindow(courses, dateStr) {
  const start = new Date(`${dateStr}T08:00:00`);
  const end = new Date(`${dateStr}T21:00:00`);
  const busy = [];
  for (const course of timedCourses(courses)) {
    const courseStart = Math.max(+start, +course.startDateTime);
    const courseEnd = Math.min(+end, +course.endDateTime);
    if (courseEnd <= courseStart) continue;
    const previous = busy.at(-1);
    if (previous && courseStart <= previous.end) {
      previous.end = Math.max(previous.end, courseEnd);
      previous.courses.push(course);
    } else busy.push({ start: courseStart, end: courseEnd, courses: [course] });
  }
  const occupiedMin = busy.reduce((sum, interval) => sum + (interval.end - interval.start) / MINUTE, 0);
  return { start, end, busy, occupiedMin, freeMin: Math.max(0, 780 - occupiedMin) };
}

export function getTodayState(courses, now) {
  const sorted = timedCourses(courses);
  const current = sorted.find(course => now >= course.startDateTime && now < course.endDateTime) || null;
  const next = sorted.find(course => course.startDateTime > now) || null;
  const past = sorted.filter(course => course.endDateTime <= now);
  const previous = past.reduce((latest, course) => !latest || course.endDateTime > latest.endDateTime ? course : latest, null);
  const result = { currentCourse: current, nextCourse: next, prevCourse: previous,
    remainingCount: sorted.filter(course => course.startDateTime > now).length,
    countdown: current ? current.endDateTime - now : next ? next.startDateTime - now : null };
  if (current) {
    const phase = getCoursePhase(current, now);
    if (phase.kind === 'unknown') return { ...result, state: 'TIME_UNKNOWN', countdown: null };
    result.currentSegment = phase.segment;
    if (phase.segment) result.countdown = phase.segment.end - now;
    if (phase.kind === 'break') return { ...result, state: 'INTERNAL_BREAK' };
  }
  if (!courses.length) return { ...result, state: now.getDay() === 0 || now.getDay() === 6 ? 'WEEKEND' : 'NO_CLASS' };
  if (!sorted.length) return { ...result, state: 'TIME_UNKNOWN' };
  if (current) return { ...result, state: 'IN_CLASS' };
  if (!previous && next) return { ...result, state: now.getHours() < 6 ? 'EARLY_MORNING' : 'BEFORE_FIRST_CLASS' };
  if (previous && next) {
    const gapMin = (next.startDateTime - previous.endDateTime) / MINUTE;
    const midday = now.getHours() >= 12 && now.getHours() < 14;
    return { ...result, state: midday && gapMin > 45 ? 'LUNCH' : gapMin <= 20 ? 'BREAK' : 'BEFORE_NEXT_CLASS' };
  }
  return { ...result, state: 'DAY_FINISHED' };
}

export function formatMinutes(value) {
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}小时${remainder ? `${remainder}分` : ''}` : `${minutes}分钟`;
}

// Keep unfinished small periods, including the second half of the current course.
export function getRemainingPeriods(courses, now) {
  const lessons = [], breaks = [], unknown = [];
  for (const course of courses) {
    const segments = course.segments;
    if (segments?.length) {
      for (const part of segments) {
        if (part.end <= now) continue;
        if (part.kind === 'lesson' && part.start > now) lessons.push({ ...part, course });
        else if (part.kind === 'break') breaks.push({ ...part, course, internal:true });
      }
    } else if (segments || !(course.startDateTime instanceof Date) || !(course.endDateTime instanceof Date) || !Number.isFinite(+course.startDateTime) || !Number.isFinite(+course.endDateTime) || course.endDateTime <= course.startDateTime) unknown.push(course);
    else if (course.startDateTime > now) lessons.push({ kind:'lesson', course, start:course.startDateTime, end:course.endDateTime,
      startTime:course.startTime, endTime:course.endTime, section:course.startSection, unsplit:true });
  }
  for (const gap of getCourseGaps(courses)) if (gap.end > now) breaks.push({ ...gap, kind:'break', internal:false });
  return { lessons:lessons.sort((a,b)=>a.start-b.start), unknown,
    rows:[...lessons,...breaks].sort((a,b)=>a.start-b.start || a.end-b.end) };
}

// Group by the original course occurrence; identical names in different slots stay distinct.
// The current/next occurrence lives in the main card, including its remaining small lessons.
export function getUpcomingCourseGroups(courses, now) {
  const context = getTodayState(courses,now), remaining = getRemainingPeriods(courses,now);
  const focus = context.currentCourse || context.nextCourse || (context.state==='TIME_UNKNOWN'?courses[0]:null);
  const unknown = new Set(remaining.unknown);
  const groups = courses.filter(course => course!==focus && (unknown.has(course) || course.endDateTime>now)).map(course => ({
    course, unknown:unknown.has(course), lessons:course.segments?.filter(part=>part.kind==='lesson') || [],
  })).sort((a,b) => Number(a.unknown)-Number(b.unknown) || (a.course.startDateTime-b.course.startDateTime) || courseKey(a.course).localeCompare(courseKey(b.course)));
  const pending = focus?.segments?.filter(part=>part.kind==='lesson'&&part.start>now) || [];
  return { focus, groups, pending,
    lessonCount:groups.filter(row=>!row.unknown).reduce((sum,row)=>sum+(row.lessons.length || Math.max(1,row.course.endSection-row.course.startSection+1)),0),
    unknownCount:groups.filter(row=>row.unknown).length,
    past:courses.filter(course=>course!==focus&&!unknown.has(course)&&course.endDateTime<=now),
    gaps:getCourseGaps(courses).filter(gap=>gap.durationMin>=60&&gap.end>now&&gap.start>now),
  };
}
