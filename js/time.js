const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

export function getCurrentWeek(semesterStart) {
  const start = new Date(semesterStart + 'T00:00:00');
  const now = new Date();
  const diff = now - start;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  return Math.floor(days / 7) + 1;
}

export function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWeekday(date) {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  return d.getDay() === 0 ? 7 : d.getDay();
}

export function getDayName(date) {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  return DAY_NAMES[d.getDay()];
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
}

export function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function formatClock(now) {
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return { h, m, s };
}

export function formatClockDisplay(now, format24 = true) {
  const { h, m, s } = formatClock(now);
  if (format24) {
    return { main: `${h}:${m}`, seconds: `:${s}` };
  }
  const hour = now.getHours();
  const ampm = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 || 12;
  return { main: `${String(h12).padStart(2, '0')}:${m}`, seconds: `:${s}`, ampm };
}

export function formatCountdown(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / (1000 * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分`;
}

function stripSeconds(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return timeStr;
}

export function getSectionTime(section, season, sectionTimes) {
  const seasonData = sectionTimes[season];
  if (!seasonData) return null;
  const raw = seasonData[String(section)] || null;
  if (!raw) return null;
  return { start: stripSeconds(raw.start), end: stripSeconds(raw.end) };
}

export function getCourseStartEnd(course, sectionTimes) {
  const startSection = course.startSection || course.start_section;
  const endSection = course.endSection || course.end_section;
  const season = course.season;
  const startInfo = getSectionTime(startSection, season, sectionTimes);
  const endInfo = getSectionTime(endSection, season, sectionTimes);
  if (!startInfo || !endInfo) return null;
  const startDate = new Date(course.date + 'T' + startInfo.start + ':00');
  const endDate = new Date(course.date + 'T' + endInfo.end + ':00');
  return { startDate, endDate, startTime: startInfo.start, endTime: endInfo.end };
}

export function getWeekDates(week, semesterStart) {
  const start = new Date(semesterStart + 'T00:00:00');
  const weekStart = new Date(start);
  weekStart.setDate(start.getDate() + (week - 1) * 7);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

export function formatTimeRange(startTime, endTime) {
  return `${startTime} — ${endTime}`;
}

export function isSameDay(dateStr1, dateStr2) {
  return dateStr1 === dateStr2;
}

export function clampWeek(week, firstWeek, lastWeek) {
  return Math.max(firstWeek, Math.min(lastWeek, week));
}

// ========== Course State (shared between TODAY and SCHEDULE) ==========
// Unified course state logic: before / in_progress / finished
// Plus: getNextCourse — find the first upcoming course after now

export function getCourseState(course, now) {
  if (!course || !course.startDateTime || !course.endDateTime) return 'before';
  if (now >= course.endDateTime) return 'finished';
  if (now >= course.startDateTime && now < course.endDateTime) return 'in_progress';
  return 'before';
}

export function getNextCourse(courses, now) {
  if (!courses || courses.length === 0) return null;
  const upcoming = courses.filter(c => {
    if (!c.startDateTime) return false;
    return c.startDateTime > now;
  });
  if (upcoming.length === 0) return null;
  return upcoming.reduce((earliest, c) =>
    !earliest || c.startDateTime < earliest.startDateTime ? c : earliest
  , null);
}

export function getCurrentCourse(courses, now) {
  if (!courses || courses.length === 0) return null;
  return courses.find(c => {
    if (!c.startDateTime || !c.endDateTime) return false;
    return now >= c.startDateTime && now < c.endDateTime;
  }) || null;
}
