import assert from 'node:assert/strict';
import { notesForCourse, notesForMoment, noteActive, noteRuleLabel, normalizeNoteRule } from '../js/persistent-model.js';
import { adviceItems, dailyFacts, dailySourceId } from '../js/daily-model.js';
import { buildReminders } from '../js/agenda-model.js';
import { renderContextNotes } from '../js/context-notes.js';
import { renderUpcomingCourses } from '../js/home-courses.js';
import { saveItem, readItems, updateItemState, validateBackup, mergeBackup, isOverdue, itemsForScope } from '../js/tasks-store.js';

const memory=new Map();let full=false;
globalThis.localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>{if(full)throw Error('quota');memory.set(key,value);}};
globalThis.window=new EventTarget();
const at=time=>new Date(`2026-10-23T${time}:00`),now=at('08:20');
const course={date:'2026-10-23',courseName:'数学',location:'南区艺新楼315',startSection:1,endSection:2,startTime:'08:00',endTime:'09:40',startDateTime:at('08:00'),endDateTime:at('09:40'),segments:[
  {kind:'lesson',section:1,start:at('08:00'),end:at('08:45'),startTime:'08:00',endTime:'08:45'},
  {kind:'break',start:at('08:45'),end:at('08:55'),startTime:'08:45',endTime:'08:55'},
  {kind:'lesson',section:2,start:at('08:55'),end:at('09:40'),startTime:'08:55',endTime:'09:40'},
]};
const fields={semester:'示例学期',className:'示例班级',courseName:'数学',text:'常记：每次带计算器 <img src=x>',kind:'bring',source:'oral',dueDate:'',dueTime:'',nextStep:'',needsConfirmation:false,reminderMode:'persistent',noteRule:{scene:'course',leadMinutes:20}};
const note=saveItem(fields);
assert.equal(JSON.parse([...memory.values()][0]).schemaVersion,2,'new fields must not be rewritten by old schema-1 tabs');
const pick=(item=note,time=now,view='focus',value=course)=>notesForCourse([item],value,{now:time,view});
assert.equal(pick(note,at('07:39')).length,0);
assert.equal(pick(note,at('07:40')).length,1,'lead window includes its start');
assert.equal(pick(note,at('08:50')).length,1,'internal break retains the course note');
assert.equal(pick(note,at('09:40')).length,0,'course end is exclusive');
assert.equal(pick(note,at('06:00'),'detail').length,1,'detail can be checked before the lead window');
assert.equal(pick({...note,courseName:''}).length,0,'empty course association never means all classes');
assert.equal(pick(note,now,'focus',{...course,courseName:'英语'}).length,0);
assert.equal(pick({...note,noteRule:{scene:'place',place:'艺 新 楼'}},now).length,1);
assert.equal(pick({...note,noteRule:{scene:'place',place:'北区'}},now).length,0);
assert.equal(pick({...note,noteRule:{scene:'course',place:'旧的未使用地点'}},now).length,1,'switching scene does not retain an invisible place constraint');
assert.equal(pick({...note,noteRule:{scene:'place',place:''}},now).length,0);
assert.equal(pick({...note,noteRule:{scene:'prepare'},courseName:''},now,'prepare').length,0);
assert.equal(pick({...note,noteRule:{scene:'prepare',place:'艺新楼'},courseName:''},now,'prepare').length,1);
assert.equal(pick({...note,dueDate:'2026-10-24'}).length,0);
assert.equal(pick({...note,noteRule:{scene:'course',weekdays:[6]}}).length,0);
assert.equal(pick({...note,noteRule:{scene:'course',weekdays:[5]}}).length,1);
assert.equal(pick({...note},now,'focus',{...course,startDateTime:null,endDateTime:null}).length,0);
assert.equal(notesForMoment([{...note,noteRule:{scene:'manual'}}],now).length,0);
assert.equal(notesForMoment([{...note,noteRule:{scene:'home'}}],now).length,1);
const overnight={...note,courseName:'',dueDate:'2026-10-23',noteRule:{scene:'time',weekdays:[5],startTime:'23:00',endTime:'01:00'}};
assert.equal(notesForMoment([overnight],new Date('2026-10-24T00:30')).length,1,'overnight weekday/date refer to Friday, not Saturday');
assert.equal(notesForMoment([overnight],new Date('2026-10-24T01:00')).length,0);
assert.equal(notesForMoment([{...overnight,courseName:'数学'}],new Date('2026-10-24T00:30'),[course]).length,1,'linked overnight note uses the start day course, including after midnight');
assert.equal(notesForMoment([overnight],at('22:59')).length,0);
assert.equal(notesForMoment([{...overnight,noteRule:{scene:'time',startTime:'23:00'}}],at('23:30')).length,0,'incomplete intervals stay quiet');
assert.equal(notesForMoment([{...overnight,noteRule:{scene:'time',startTime:'23:00',endTime:'23:00'}}],at('23:30')).length,0);
const courseDay={...note,noteRule:{scene:'time',startTime:'08:00',endTime:'10:00'}};
assert.equal(notesForMoment([courseDay],now,[]).length,0);
assert.equal(notesForMoment([courseDay],now,[course]).length,1);
assert.match(noteRuleLabel(overnight),/跨日/);
assert.throws(()=>normalizeNoteRule({scene:'course',leadMinutes:999}));
assert.throws(()=>normalizeNoteRule({scene:'time',startTime:'25:00'}));
assert.throws(()=>normalizeNoteRule({weekdays:[5,5]}));

// Lifecycle and backup safety: hiding is temporary, pause is not completion.
updateItemState(note.id,'hideToday');let saved=readItems()[0];
const hiddenDay=new Date(`${saved.noteHiddenOn}T12:00`),nextDay=new Date(hiddenDay);nextDay.setDate(nextDay.getDate()+1);
assert.equal(noteActive(saved,hiddenDay),false);assert.equal(noteActive(saved,nextDay),true);
updateItemState(note.id,'showToday');updateItemState(note.id,'pause');saved=readItems()[0];
assert.equal(noteActive(saved,nextDay),false);assert.equal(saved.completedAt,'');
saveItem({text:'改过原话'},note.id);assert.equal(readItems()[0].notePaused,true,'partial edits preserve lifecycle fields and association');
assert.equal(readItems()[0].noteRule.scene,'course');
const backup=validateBackup({schemaVersion:2,items:readItems()});assert.equal(backup.items[0].notePaused,true);
assert.equal(validateBackup({schemaVersion:1,items:[note]}).items[0].noteRule.scene,'course');
const legacy={...note};delete legacy.reminderMode;delete legacy.noteRule;delete legacy.notePaused;delete legacy.noteHiddenOn;
assert.equal(validateBackup({schemaVersion:1,items:[legacy]}).items[0].reminderMode,'task');
assert.deepEqual(mergeBackup(backup),{added:0,updated:0});
updateItemState(note.id,'resume');assert.equal(noteActive(readItems()[0],now),true);
assert.equal(itemsForScope({semester:fields.semester,className:'另一个班级'}).length,0);
updateItemState(note.id,'complete');assert.equal(noteActive(readItems()[0],now),false);
updateItemState(note.id,'reopen');assert.equal(noteActive(readItems()[0],now),true);
updateItemState(note.id,'trash');assert.equal(noteActive(readItems()[0],now),false);
updateItemState(note.id,'restore');assert.equal(noteActive(readItems()[0],now),true);
const before=[...memory.values()][0];full=true;
assert.throws(()=>updateItemState(note.id,'pause'),/保存失败/);assert.equal([...memory.values()][0],before);full=false;
updateItemState(note.id,'pause');updateItemState(note.id,'stopPersistent');assert.equal(readItems()[0].reminderMode,'task');assert.equal(readItems()[0].notePaused,false);
saveItem({reminderMode:'persistent'},note.id);assert.equal(noteActive(readItems()[0],now),true);

// Existing task reminders keep working. Persistent prose cannot become a deadline
// or feed a repeated AI sentence even if it contains a date and linked course.
const deadline={...note,id:'deadline',reminderMode:'task',dueDate:'2026-10-23',dueTime:'18:00',timeRole:'deadline'};
const datedNote={...deadline,id:'formula',reminderMode:'persistent',text:'数学公式'};
assert.equal(isOverdue(datedNote,'2026-10-24'),false);
assert.deepEqual(adviceItems([datedNote,deadline],now).map(item=>item.id),['deadline']);
const facts=dailyFacts({now,courses:[course],tomorrowCourses:[],items:[datedNote,deadline]});
assert.ok(!facts.some(f=>f.id===dailySourceId('item','formula')));
assert.ok(facts.some(f=>f.id===dailySourceId('item','deadline')));
const reminders=buildReminders({date:'2026-10-23',courses:[],activities:[],tasks:[datedNote,deadline],prefs:{enabled:true,marketEnabled:false,taskLeadHours:2}});
assert.deepEqual(reminders.map(item=>item.key),['task:deadline']);
const html=renderContextNotes([note]);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.match(html,/今天收起/);
const later={...course,startDateTime:at('10:00'),endDateTime:at('11:40'),startTime:'10:00',endTime:'11:40',startSection:3,endSection:4};
assert.match(renderUpcomingCourses([course,later],now,{settings:{}},true,new Set(),[note]),/常记1/);
console.log('Persistent notes: context/lead/break/day/overnight boundaries, scope, reversible actions, backup migration, failed-write safety and exclusion from daily AI/deadline reminders passed.');
