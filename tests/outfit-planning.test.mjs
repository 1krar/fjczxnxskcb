import assert from 'node:assert/strict';
import { emptyDailyData } from '../js/daily-store.js';
import { planOutfits, nextDate } from '../js/daily-model.js';
import { outfitPlanning, OUTFIT_SCORE_WEIGHTS } from '../js/outfit-planning.js';
import { normalizeWeather, DEFAULT_WEATHER_LOCATION } from '../js/weather-model.js';
import { rawForecast } from './weather-fixture.mjs';

process.env.TZ='Asia/Shanghai';
const date='2026-10-29',now=new Date(date+'T08:00:00+08:00'),stamp=now.toISOString();
const item=(id,category,more={})=>({id,name:id,category,color:'black',warmth:'medium',needsBelt:'no',running:'auto',state:'ready',stateAt:stamp,expectedDate:'',preference:'neutral',wetWeather:'unknown',createdAt:stamp,updatedAt:stamp,deletedAt:'',...more});
const saved=(id,ids)=>({id,name:id,garmentIds:ids,createdAt:stamp,updatedAt:stamp,deletedAt:''});
const course=day=>({date:day,courseName:'体育',startTime:'14:00',endTime:'15:40'});
const actual=(day,ids,more={})=>({date:day,actualPieces:ids.map(id=>({id})),actualTime:'',deletedAt:'',actualUndoneAt:'',rating:null,feedback:[],...more});
function weather(temperatures) {
  const raw=rawForecast(date);
  raw.hourly.temperature_2m=raw.hourly.time.map(time=>temperatures[time.slice(0,10)]??22);
  raw.hourly.apparent_temperature=[...raw.hourly.temperature_2m];
  raw.hourly.precipitation_probability.fill(0);
  return normalizeWeather(raw,DEFAULT_WEATHER_LOCATION,now);
}
const data=emptyDailyData();
data.profile.changeMode='allDay';data.profile.peNeedsShorts=true;
data.garments=[item('a-layer-top','tshirt'),item('b-other-top','tshirt'),item('jeans','jeans'),item('joggers','joggers'),item('shorts','sportshorts'),item('jacket','jacket'),item('trainers','trainers')];
data.outfits=[saved('已存外套搭配',['a-layer-top','jeans','jacket'])];
const cool=weather({[date]:22,[nextDate(date)]:10,[nextDate(date,2)]:22});
let plan=planOutfits(data,date,[],[],cool,now);
assert.equal(plan.planning.laundryReturnDate,nextDate(date,3),'unset interval uses the user-provided two-day wash plus one-day drying estimate');
assert.match(plan.planning.laundryAssumption,/未设置.*攒2天.*晾1天/);
assert.equal(plan.planning.weatherComparison.deltaMin,-12);
assert.equal(plan.planning.weatherComparison.toDate,nextDate(date));
assert.ok(plan.planning.reservations.some(row=>row.kind==='layer-top'&&row.garmentIds.join()==='a-layer-top'));
assert.ok(plan.daily.sets[0].pieces.some(piece=>piece.id==='b-other-top'),'reserve the saved jacket combination top for the known cold day');
const linked=plan.daily.candidates.find(set=>set.pieces.some(piece=>piece.id==='a-layer-top'));
assert.ok(linked.scoreBreakdown.find(row=>row.key==='reserve').score<plan.daily.sets[0].scoreBreakdown.find(row=>row.key==='reserve').score);
assert.ok(plan.daily.sets[0].scoreReasons.some(reason=>reason.includes('预留')));
assert.equal(Object.values(OUTFIT_SCORE_WEIGHTS).reduce((a,b)=>a+b,0),100);
for(const set of plan.daily.candidates) {
  assert.equal(set.score,set.scoreBreakdown.reduce((sum,row)=>sum+row.score,0));
  assert.ok(Number.isInteger(set.score)&&set.score>=0&&set.score<=100);
  assert.ok(set.scoreBreakdown.every(row=>row.score>=0&&row.score<=row.max&&row.reason));
}
assert.equal(planOutfits({...data,garments:[...data.garments].reverse()},date,[],[],cool,now).daily.sets[0].id,plan.daily.sets[0].id,'ranking is stable when imported garment order changes');
const noRelations={...data,outfits:[]};
assert.ok(!planOutfits(noRelations,date,[],[],cool,now).planning.reservations.some(row=>row.kind==='layer-top'),'unknown jacket compatibility cannot be invented');
const noWeather=planOutfits(data,date,[],[],null,now);
assert.equal(noWeather.planning.weatherComparison,null);
assert.equal(noWeather.planning.reservations.length,0,'missing forecast cannot invent cold-day reservation');
assert.match(noWeather.daily.sets[0].scoreBreakdown.find(row=>row.key==='weather').reason,/暂无可用预报/);
assert.equal(plan.planning.days.find(day=>day.date===nextDate(date,3)).weather,null,'a date beyond the returned forecast is never filled with a neighboring day');

const sport=structuredClone(data);sport.outfits=[saved('常穿短裤',['a-layer-top','shorts','trainers'])];sport.plans=[{date,run:true}];
const future=[course(nextDate(date)),course(nextDate(date,2))];
plan=planOutfits(sport,date,[],future,weather({}),now);
assert.ok(plan.daily.sets[0].pieces.some(piece=>piece.id==='joggers'),'preserve scarce shorts for future compulsory PE instead of using them on today’s optional run');
assert.equal(plan.planning.reservations.filter(row=>row.kind==='pe-shorts').length,2);
plan=planOutfits(sport,date,[course(date)],future,weather({}),now);
assert.ok(plan.daily.sets[0].pieces.some(piece=>piece.id==='shorts'),'future reserve never bypasses today’s mandatory shorts constraint');
const cannotReturn=structuredClone(sport);cannotReturn.profile.laundryEveryDays=1;cannotReturn.profile.dryAfterDays=0;
const early=planOutfits(cannotReturn,date,[],future,weather({}),now);
assert.ok(early.planning.reservations.every(row=>row.date===nextDate(date)),'return day is still reserved because morning readiness is not confirmed; later dates are not reserved');
assert.equal(cannotReturn.garments.find(piece=>piece.id==='shorts').state,'ready','look-ahead has no state side effects');

const shared=structuredClone(data);shared.outfits=[saved('常穿运动长裤',['a-layer-top','joggers'])];shared.plans=[{date:nextDate(date),run:true}];
const across=planOutfits(shared,date,[],[course(nextDate(date,2))],weather({}),now);
const regular=across.daily.candidates.find(set=>set.pieces.some(piece=>piece.id==='jeans'));
const usedJoggers=across.daily.candidates.find(set=>set.pieces.some(piece=>piece.id==='joggers'));
assert.ok(regular.scoreBreakdown.find(row=>row.key==='reserve').score>usedJoggers.scoreBreakdown.find(row=>row.key==='reserve').score,'run and PE pools share physical garments; independent pool counts must not double-book the shorts');
assert.ok(across.daily.sets[0].pieces.some(piece=>piece.id==='jeans'));
const unique=structuredClone(data);unique.profile.peNeedsShorts=false;unique.garments=unique.garments.filter(piece=>piece.id!=='shorts');unique.plans=[{date,run:true}];
const uniquePlan=planOutfits(unique,date,[],[course(nextDate(date))],weather({}),now);
assert.ok(uniquePlan.daily.sets[0].scoreReasons.some(reason=>reason.includes('可能赶不上洗晒')),'wearing the sole running trousers today exposes tomorrow’s PE shortage instead of promising reuse');
const sporty=structuredClone(data);sporty.garments.push(item('fav-shirt','shirt',{preference:'like'}));sporty.outfits=[saved('常穿衬衫',['fav-shirt','shorts','trainers'])];
const sportsFit=planOutfits(sporty,date,[course(date)],[],weather({}),now).daily;
assert.ok(sportsFit.candidates.every(set=>!set.pieces.some(piece=>piece.id==='fav-shirt')),'available athletic tops take priority over a favorite nonathletic shirt for sport');
assert.equal(plan.planning.horizonDays,7);
assert.equal(plan.planning.days.length,8,'selected date plus seven following dates are available for plan checks');

const rotation=structuredClone(noRelations);rotation.wearLogs=[actual(nextDate(date,-1),['a-layer-top'],{rating:1,feedback:['restrictive']})];
let rotated=planOutfits(rotation,date,[],[],null,now);
assert.ok(rotated.daily.sets[0].pieces.some(piece=>piece.id==='b-other-top'),'recent real use influences which top gets its turn');
const aSet=rotated.daily.candidates.find(set=>set.pieces.some(piece=>piece.id==='a-layer-top'));
const bSet=rotated.daily.candidates.find(set=>set.pieces.some(piece=>piece.id==='b-other-top'));
assert.ok(aSet.scoreBreakdown.find(row=>row.key==='rotation').score<bSet.scoreBreakdown.find(row=>row.key==='rotation').score);
assert.ok(aSet.scoreBreakdown.find(row=>row.key==='preference').score<bSet.scoreBreakdown.find(row=>row.key==='preference').score,'reported ratings softly influence personal preference points');
for(const excluded of [
  actual(nextDate(date),['a-layer-top'],{rating:1}),
  actual(nextDate(date,-1),['a-layer-top'],{rating:1,actualUndoneAt:stamp}),
  actual(nextDate(date,-1),['a-layer-top'],{rating:1,deletedAt:stamp}),
  {date,actualPieces:[],selectedPieces:[{id:'a-layer-top'}],deletedAt:'',actualUndoneAt:'',rating:null,feedback:[]},
]) {
  const planning=outfitPlanning({...noRelations,wearLogs:[excluded]},date,[],[],null,now);
  const fit=planOutfits({...noRelations,wearLogs:[excluded]},date,[],[],null,now).daily;
  assert.ok(fit.candidates.every(set=>set.scoreBreakdown.find(row=>row.key==='rotation').score===15),'future, undone, deleted and selected-only rows are not actual wear');
  assert.equal(planning.days[0].date,date);
}
const running=outfitPlanning({...data,plans:[{date,run:false}]},date,[],[],null,now);
assert.ok(!running.runCheck.dates.includes(date),'explicit no-run is not treated as missing information');
assert.ok(running.runCheck.dates.includes(nextDate(date)));
const drying=structuredClone(data);drying.garments.find(piece=>piece.id==='b-other-top').state='drying';drying.garments.find(piece=>piece.id==='b-other-top').expectedDate=date;
const wetPlan=planOutfits(drying,date,[],[],cool,now);
assert.ok(wetPlan.daily.candidates.every(set=>!set.pieces.some(piece=>piece.id==='b-other-top')),'estimated dry dates never enter the ready scored pool');
assert.ok(wetPlan.conditional.every(set=>set.conditionalIds.length),'drying options stay explicitly conditional');

console.log('Outfit planning: grounded multi-day forecasts, explicit laundry fallback, linked jacket reserves, compulsory PE priority, turnaround, actual-use rotation/feedback and explainable stable ranking passed.');
