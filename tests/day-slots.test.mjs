import assert from 'node:assert/strict';
import { getDaySlots, courseSectionRange } from '../js/day-slots.js';
import { seasonForDate } from '../js/time.js';
import { seasonForDate as noticeSeason } from '../js/notice-model.js';

process.env.TZ = 'Asia/Shanghai';
const date = '2026-10-19';
const bells = [ ['08:00','08:45'], ['08:55','09:40'], ['10:00','10:45'], ['10:55','11:40'],
  ['14:00','14:45'], ['14:55','15:40'], ['16:00','16:45'], ['16:55','17:40'], ['19:20','20:05'], ['20:15','21:00'] ];
const winter = Object.fromEntries(bells.map(([start,end],index) => [index+1,{start:`${start}:00`,end:`${end}:00`}]));
const sectionTimes = {winter,summer:{...winter,5:{start:'14:30:00',end:'15:15:00'}}};
const seasonRule = {summer:'06-01_to_09-30',winter:'10-01_to_05-31'};
const semesterInfo = {semesterStart:'2026-08-31',firstWeek:3,lastWeek:17};
const course = (start,end,name='课程') => ({date,startSection:start,endSection:end,courseName:name,season:'winter'});
const model = (courses=[],extra={}) => getDaySlots({date,courses,sectionTimes,seasonRule,semesterInfo,...extra});
const ranges = result => result.unassigned.map(row => [row.startSection,row.endSection,row.startTime,row.endTime]);

assert.equal(seasonForDate('2026-09-30',[],seasonRule),'summer');
assert.equal(seasonForDate('2026-10-01',[],seasonRule),'winter');
assert.equal(seasonForDate('2027-01-04',[],seasonRule),'winter','wrapped winter range includes January');
assert.equal(noticeSeason('2026-10-01',[],seasonRule),'winter','notice extraction preserves its date lookup after sharing the helper');
assert.equal(seasonForDate(date,[{...course(1,2),season:'summer'}],seasonRule),'summer','explicit course bell schedule takes precedence');

let result = model([course(5,6)]);
assert.deepEqual(ranges(result),[[1,4,'08:00','11:40'],[7,8,'16:00','17:40'],[9,10,'19:20','21:00']],
  'show unassigned periods before the first course and after the last; split afternoon/evening');
assert.equal(result.periods[4].state,'occupied');
assert.equal(result.periods[0].state,'unassigned');
assert.equal(result.separators.filter(row=>row.kind==='lunch').length,1);
assert.equal(result.separators.find(row=>row.kind==='lunch').startTime,'11:40');
assert.equal(result.separators.find(row=>row.kind==='lunch').endTime,'14:00');

result = model([course(1,2),course(5,8)]);
assert.deepEqual(ranges(result),[[3,4,'10:00','11:40'],[9,10,'19:20','21:00']]);
assert.ok(!result.separators.some(row=>row.startTime==='08:45'),'10 minute internal breaks never become unassigned rows');
result = model([course(1,2),course(3,4)]);
assert.deepEqual(result.separators.filter(row=>row.kind==='break').map(row=>[row.startTime,row.endTime]),[['09:40','10:00']],
  'between-course break is separate from a whole unassigned teaching period');
result = model([course(1,4),course(2,3)]);
assert.equal(result.periods.filter(row=>row.state==='occupied').length,4,'overlaps do not invent unassigned periods');
assert.equal(result.periods[1].courses.length,2);
assert.ok(!result.separators.some(row=>row.kind==='break'),'overlapping parent courses keep their breaks inside the course');
result = model([course(3,6)]);
assert.ok(!result.separators.some(row=>row.kind==='lunch'),'a course spanning lunch is not split by an external lunch row');

result = model();
assert.deepEqual(ranges(result),[[1,4,'08:00','11:40'],[5,8,'14:00','17:40'],[9,10,'19:20','21:00']],
  'an empty known day stays compact in three school blocks');
assert.equal(result.season,'winter','empty days use their date, not a summer fallback');
assert.equal(model([],{date:'2026-09-30'}).periods[4].startTime,'14:30');
assert.equal(model([],{date:'2026-10-01'}).periods[4].startTime,'14:00');

const unknown = {...course(1,1),startSectionRaw:undefined,endSectionRaw:undefined};
assert.equal(courseSectionRange(unknown),null,'normalizer fallback section 1 must not turn unknown raw sections into a class');
result = model([unknown,course(5,6)]);
assert.equal(result.unknownCourses.length,1);
assert.equal(result.periods[0].state,'unknown');
assert.equal(result.periods[4].state,'occupied','an incomplete record does not hide independently confirmed courses');
assert.equal(result.unassigned.length,0,'unknown section ranges cannot be used to promise unassigned periods');
assert.equal(courseSectionRange({...course(2,2),startSectionRaw:2,endSectionRaw:undefined}).end,2,'single-section raw records remain valid');
assert.equal(courseSectionRange(course(4,3)),null);
assert.equal(courseSectionRange(course(0,2)),null);

for (const day of ['2026-09-01','2026-12-28']) {
  result=model([],{date:day});
  assert.equal(result.coverageReason,'不在已导入的课表范围内');
  assert.ok(result.periods.every(row=>row.state==='unknown'));
  assert.equal(result.unassigned.length,0);
}
assert.equal(model([],{date:'2026-02-30'}).coverageReason,'日期待确认');
assert.equal(model([],{semesterInfo:null}).unassigned.length,0,'missing coverage is not equivalent to an empty timetable');
result=model([],{seasonRule:{}});
assert.ok(result.periods.every(row=>row.state==='unknown'));
assert.equal(result.season,null);
assert.equal(result.unassigned.length,0);
const partial={winter:{...winter}};delete partial.winter[3];
result=model([],{sectionTimes:partial});
assert.equal(result.periods[2].state,'unknown','a missing bell time remains unknown rather than disappearing');
assert.deepEqual(result.unassigned.filter(row=>row.block==='morning').map(row=>[row.startSection,row.endSection]),[[1,2],[4,4]]);
console.log('Day slots: compact unassigned blocks, internal/inter-course breaks, lunch, overlaps, season boundaries and incomplete coverage passed.');
