import assert from 'node:assert/strict';
import { dailyFacts, buildAdvice, shortAdvice, dailySourceId } from '../js/daily-model.js';
import { dailyIdentity } from '../js/ai-client.js';
import { adviceVisibility, changeAdviceVisibility, ADVICE_VISIBILITY_KEY } from '../js/daily-visibility.js';
import { DEFAULT_PROFILE } from '../js/daily-store.js';

const records = new Map();
let fail = false;
globalThis.localStorage = { getItem:key => records.get(key) ?? null, setItem:(key,value) => { if (fail) throw Error('full'); records.set(key,value); } };
const scope = { semester:'示例学期', className:'示例班级' };
const now = new Date('2026-10-21T15:00:00');
const item = (id, date, time, extra={}) => ({ id, text:'原始通知', title:'示例活动', dueDate:date, dueTime:time, timeRole:'start', kind:'note', completedAt:'', deletedAt:'', ...extra });
const input = { now, courses:[], tomorrowCourses:[], items:[
  item('later','2026-10-23','10:00'), item('later2','2026-10-24','10:00'), item('later3','2026-10-25','10:00'),
  item('soon','2026-10-21','15:40',{ title:'最近的活动', location:'示例教室', nextStep:'带纸笔' }),
] };
let facts = dailyFacts(input);
const soonId=dailySourceId('item','soon');
assert.match(facts.find(f=>f.id===soonId).text,/最近的活动/,'rank before taking a bounded selection');
assert.match(facts.find(f=>f.id===soonId).text,/开始：2026-10-21 15:40/);
assert.doesNotMatch(facts.find(f=>f.id===soonId).text,/截止/,'an activity start never becomes a deadline');
assert.match(facts.find(f=>f.id===soonId).text,/带纸笔/);
assert.ok(dailyFacts({...input,items:input.items.slice().reverse()}).some(f=>f.id===soonId),'source IDs survive list reordering');
assert.ok(facts.length<=12 && facts.every(f=>f.text.length<=350));
const pending = dailyFacts({...input,items:[item('pending','2026-10-21','17:00',{needsConfirmation:true,location:''})]});
assert.match(pending.find(f=>f.id.startsWith('item:')).text,/17:00.*待确认/,'retain known fields with uncertainty stated');
assert.ok(!dailyFacts({...input,items:[item('done','2026-10-21','17:00',{completedAt:now.toISOString()})]}).some(f=>f.id.startsWith('item:')));
assert.ok(!dailyFacts({...input,items:[item('undated','','15:40')]}).some(f=>f.id.startsWith('item:')),'undated general notes do not become a daily refrain');
const linked=dailyFacts({...input,items:[item('formula','','',{courseName:'数学'})],tomorrowCourses:[{courseName:'数学',startTime:'08:00',endTime:'09:40'}]});
assert.ok(linked.some(f=>f.id===dailySourceId('item','formula')),'an undated note can matter for a linked upcoming course');
assert.equal(dailyIdentity(scope,'2026-10-21',facts),dailyIdentity(scope,'2026-10-21',dailyFacts({...input,now:new Date('2026-10-21T15:01:00')})),'clock ticks do not invalidate current prose');
assert.notEqual(dailyIdentity(scope,'2026-10-21',facts),dailyIdentity(scope,'2026-10-21',dailyFacts({...input,now:new Date('2026-10-21T18:00:00')})),'phase/time-passed changes expire prose');
assert.notEqual(dailyIdentity(scope,'2026-10-21',facts),dailyIdentity(scope,'2026-10-21',dailyFacts({...input,items:input.items.filter(i=>i.id!=='soon')})),'completion/removal changes the contextual key');
const data = { profile:DEFAULT_PROFILE, garments:[], outfits:[], plans:[] };
const pool = buildAdvice({...input,data,items:[item('deadline','2026-10-21','18:00',{timeRole:'deadline',kind:'task',title:'提交课程作业'})]});
assert.ok(pool[0].lines.every(shortAdvice));
assert.match(pool[0].lines.join(''),/截止/);
assert.ok(!pool.some(row=>row.id==='afternoon'),'no carefree afternoon assertion over a recorded afternoon obligation');
assert.ok(!buildAdvice({...input,data,items:[item('past','2026-10-21','14:00')]}).some(row=>row.id.startsWith('item:')),'past start times do not become repeated overdue nags');

assert.equal(adviceVisibility(scope,'2026-10-21').hidden,false);
changeAdviceVisibility(scope,'2026-10-21','today');
assert.equal(adviceVisibility(scope,'2026-10-21').hidden,true);
assert.equal(adviceVisibility(scope,'2026-10-22').hidden,false,'tomorrow restores the daily banner');
assert.equal(adviceVisibility({...scope,className:'另一班级'},'2026-10-21').hidden,false);
changeAdviceVisibility(scope,'2026-10-21','restore');
assert.equal(adviceVisibility(scope,'2026-10-21').hidden,false);
changeAdviceVisibility(scope,'2026-10-21','off');
assert.equal(adviceVisibility(scope,'2026-10-22').hidden,true,'explicit off persists across days');
changeAdviceVisibility(scope,'2026-10-22','restore');
const before = records.get(ADVICE_VISIBILITY_KEY);
fail = true;
assert.throws(()=>changeAdviceVisibility(scope,'2026-10-22','today'),/保存失败/);
assert.equal(records.get(ADVICE_VISIBILITY_KEY),before);
fail = false;
records.set(ADVICE_VISIBILITY_KEY,'{bad');
assert.throws(()=>changeAdviceVisibility(scope,'2026-10-22','today'),/原内容已保留/);
assert.equal(records.get(ADVICE_VISIBILITY_KEY),'{bad');
console.log('Daily context: nearest records, start/deadline meaning, partial facts, stale prose, quiet fallback, daily dismissal and storage preservation passed.');
