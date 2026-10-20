import assert from 'node:assert/strict';
import { getCourseSummary, getCourseGaps, getFreeTimeInfo, getDayWindow, getTodayState, courseKey } from '../js/day-plan.js';

function course(start, end, name = '英语', sections = [1, 2]) {
  return { date: '2026-10-19', courseName: name, location: '教室', startTime: start, endTime: end,
    startSection: sections[0], endSection: sections[1],
    startDateTime: new Date(`2026-10-19T${start}:00`), endDateTime: new Date(`2026-10-19T${end}:00`) };
}
const at = time => new Date(`2026-10-19T${time}`);
const courses = [course('08:00', '09:40'), course('10:00', '11:40', '英语', [3, 4]), course('16:00', '17:40', '数学', [7, 8])];
assert.deepEqual(getCourseSummary(courses), { sessionCount: 3, uniqueCourseCount: 2, totalSections: 6, totalHours: 4.5, endTime: '17:40' });
assert.notEqual(courseKey(courses[0]), courseKey(courses[1]), 'same name at a different time is a different session');
assert.equal(getTodayState(courses, at('01:00:00')).state, 'EARLY_MORNING');
assert.equal(getTodayState(courses, at('07:59:59')).state, 'BEFORE_FIRST_CLASS');
assert.equal(getTodayState(courses, at('08:00:00')).state, 'IN_CLASS');
assert.equal(getTodayState(courses, at('09:40:00')).state, 'BREAK');
assert.equal(getTodayState(courses, at('10:00:00')).currentCourse, courses[1]);
assert.equal(getTodayState(courses, at('11:50:00')).state, 'BEFORE_NEXT_CLASS', 'an entire afternoon gap is not a lunch break');
assert.equal(getTodayState(courses, at('12:00:00')).state, 'LUNCH');
assert.equal(getTodayState(courses, at('14:00:00')).state, 'BEFORE_NEXT_CLASS');
assert.equal(getTodayState(courses, at('17:40:00')).state, 'DAY_FINISHED');
assert.equal(getTodayState([], new Date('2026-10-18T12:00:00')).state, 'WEEKEND');
assert.equal(getTodayState([{ courseName: '未知时间' }], at('08:00:00')).state, 'TIME_UNKNOWN');
assert.equal(getFreeTimeInfo(courses, at('09:40:00')).totalMin, 280);
assert.equal(getFreeTimeInfo(courses, at('09:59:59')).currentFreeMs, 1000, 'remaining gap preserves the same boundary as countdown');
assert.equal(getFreeTimeInfo(courses, at('10:00:00')).isInFreeTime, false);
assert.equal(getDayWindow(courses, '2026-10-19').freeMin, 480);

const overlaps = [course('08:00', '11:00'), course('09:00', '10:00'), course('12:00', '13:00')];
const gaps = getCourseGaps(overlaps);
assert.equal(gaps.length, 1);
assert.equal(gaps[0].durationMin, 60, 'nested classes must not invent a free hour');
assert.equal(gaps[0].previousCourse, overlaps[0]);
assert.equal(getDayWindow(overlaps, '2026-10-19').freeMin, 540, 'occupied overlaps count once');
const outsideWindow = [course('07:00', '08:30'), course('20:30', '22:00')];
assert.equal(getDayWindow(outsideWindow, '2026-10-19').occupiedMin, 60, 'clip occupied time to the stated window');
assert.equal(getDayWindow([], '2026-10-19').freeMin, 780);
console.log('Day-plan boundaries, counts, overlaps and time-window checks passed.');
