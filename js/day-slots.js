import { getSectionTime, seasonForDate } from './time.js?v=20261029-5';

export const SCHOOL_BLOCKS = [
  { id: 'morning', label: '上午', first: 1, last: 4 },
  { id: 'afternoon', label: '下午', first: 5, last: 8 },
  { id: 'evening', label: '晚间', first: 9, last: 10 },
];

// Raw section fields take precedence over the normalizer's fallback to section 1.
export function courseSectionRange(course) {
  const hasRaw = Object.hasOwn(course, 'startSectionRaw');
  const start = Number(hasRaw ? course.startSectionRaw : course.startSection ?? course.start_section);
  const rawEnd = hasRaw ? course.endSectionRaw : course.endSection ?? course.end_section;
  const end = rawEnd == null || rawEnd === '' ? start : Number(rawEnd);
  return Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end <= 10 && end >= start
    ? { start, end } : null;
}

function coverageForDate(date, semesterInfo) {
  const day = new Date(`${date}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+day)
      || day.getFullYear() !== Number(date.slice(0, 4)) || day.getMonth() + 1 !== Number(date.slice(5, 7))
      || day.getDate() !== Number(date.slice(8))) return '日期待确认';
  if (!semesterInfo?.semesterStart) return '课表范围待确认';
  const first = new Date(`${semesterInfo.semesterStart}T00:00:00`);
  if (!Number.isFinite(+first) || !Number.isInteger(semesterInfo.firstWeek)
      || !Number.isInteger(semesterInfo.lastWeek) || semesterInfo.firstWeek < 1
      || semesterInfo.lastWeek < semesterInfo.firstWeek) return '课表范围待确认';
  const last = new Date(first);
  first.setDate(first.getDate() + (semesterInfo.firstWeek - 1) * 7);
  last.setDate(last.getDate() + semesterInfo.lastWeek * 7);
  return day < first || day >= last ? '不在已导入的课表范围内' : '';
}

/** School periods are timetable coverage, not a promise of personal availability. */
export function getDaySlots({ date, courses = [], sectionTimes = {}, seasonRule = {}, semesterInfo } = {}) {
  const rows = courses.filter(course => !course.date || course.date === date);
  const season = seasonForDate(date, rows, seasonRule);
  const coverageReason = coverageForDate(String(date || ''), semesterInfo);
  const unknownCourses = rows.filter(course => !courseSectionRange(course));
  const periods = Array.from({ length: 10 }, (_, index) => {
    const section = index + 1, block = SCHOOL_BLOCKS.find(group => section >= group.first && section <= group.last);
    const time = season && getSectionTime(section, season, sectionTimes);
    const start = time?.start ? new Date(`${date}T${time.start}:00`) : null;
    const end = time?.end ? new Date(`${date}T${time.end}:00`) : null;
    const timeKnown = Boolean(start && end && Number.isFinite(+start) && Number.isFinite(+end) && end > start);
    const matched = rows.filter(course => {
      const range = courseSectionRange(course);
      return range && section >= range.start && section <= range.end;
    });
    const reason = coverageReason || (!timeKnown ? '该日期作息待确认' : !matched.length && unknownCourses.length ? '有课程节次待确认' : '');
    const realCourses=matched.filter(course=>course.source!=='evening-study'),study=matched.find(course=>course.source==='evening-study');
    const studyState=study?.studyStatus==='excused'?'excused':study?.studyStatus==='other'?'arranged':'study';
    return { section, block: block.id, start: timeKnown ? start : null, end: timeKnown ? end : null,
      startTime: timeKnown ? time.start : '', endTime: timeKnown ? time.end : '', courses: matched,
      state: reason ? 'unknown' : realCourses.length ? 'occupied' : study ? studyState : 'unassigned', reason };
  });
  const unassigned = [];
  for (const period of periods) {
    if (period.state !== 'unassigned') continue;
    const previous = unassigned.at(-1);
    if (previous && previous.block === period.block && previous.endSection + 1 === period.section) {
      previous.endSection = period.section; previous.end = period.end; previous.endTime = period.endTime;
    } else unassigned.push({ kind: 'unassigned', block: period.block, startSection: period.section,
      endSection: period.section, start: period.start, end: period.end, startTime: period.startTime, endTime: period.endTime });
  }
  const separators = [];
  for (let index = 1; index < periods.length; index++) {
    const previous = periods[index - 1], next = periods[index];
    if (!previous.end || !next.start || next.start <= previous.end || coverageReason) continue;
    const sameCourse = previous.courses.some(course => next.courses.includes(course));
    if (sameCourse) continue; // An internal break stays inside the merged course details.
    const durationMin = (next.start - previous.end) / 60000;
    const kind = previous.section === 4 ? 'lunch' : previous.section === 8 ? 'evening-break' : 'break';
    if (kind === 'lunch' || (kind === 'break' && previous.state === 'occupied' && next.state === 'occupied')) {
      separators.push({ kind, afterSection: previous.section, start: previous.end, end: next.start,
        startTime: previous.endTime, endTime: next.startTime, durationMin });
    }
  }
  return { date, season, periods, blocks: SCHOOL_BLOCKS, unassigned, separators, unknownCourses,
    coverageReason, reason: coverageReason || (periods.some(period => !period.start) ? '该日期作息待确认' : unknownCourses.length ? '有课程节次待确认' : '') };
}
