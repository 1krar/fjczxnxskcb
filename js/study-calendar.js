import { applyEveningStudy } from './study-model.js?v=20261029-5';
import { readStudyData } from './study-store.js?v=20261029-5';
import { validDate } from './tasks-store.js?v=20261029-5';

// Bound recurrence to the imported semester, so day/month views and reminder
// checks see the same personal evening arrangement without editing source data.
export function studyCalendarContext(dm,className,studyData=readStudyData()) {
  const original=dm.getCourses(className).filter(course=>!(course.source==='evening-study'&&course.className===className));
  const info=dm.getSemesterInfo();
  const result={courses:[...original],studyNotice:'',studyData};
  if(!info||!validDate(info.semesterStart)||!Number.isInteger(info.firstWeek)||!Number.isInteger(info.lastWeek)
    ||info.firstWeek<1||info.lastWeek<info.firstWeek||(info.lastWeek-info.firstWeek+1)*7>370) {
    return {...result,studyNotice:'晚自习的学期范围待确认，当前仅显示已导入课程，未自动补晚自习。'};
  }
  const first=Date.parse(`${info.semesterStart}T00:00:00Z`)+(info.firstWeek-1)*7*86400000;
  const count=(info.lastWeek-info.firstWeek+1)*7;
  const byDate=new Map();
  for(const row of original){if(!byDate.has(row.date))byDate.set(row.date,[]);byDate.get(row.date).push(row);}
  const generated=[];
  const options={className,studyData,semesterInfo:info,sectionTimes:dm.getSectionTimes(),seasonRule:info.seasonRule||{}};
  for(let offset=0;offset<count;offset++) {
    const date=new Date(first+offset*86400000).toISOString().slice(0,10);
    generated.push(...applyEveningStudy(byDate.get(date)||[],date,options).filter(row=>row.source==='evening-study'));
  }
  result.courses.push(...generated);
  result.courses.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||(a.startSection||11)-(b.startSection||11));
  return result;
}
export function withEveningStudyForSemester(dm,className,studyData) {return studyCalendarContext(dm,className,studyData).courses;}
