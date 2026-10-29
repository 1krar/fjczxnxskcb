import { CATEGORIES } from './daily-store.js?v=20261030-1';
import { weatherDay } from './weather-model.js?v=20261030-1';
import { wearDate, wearUsageIndex } from './wear-model.js?v=20261030-1';

// Transparent, hand-tuned ranking weights. These are not probabilities or a
// trained model, and planning never changes a garment's confirmed state.
export const OUTFIT_SCORE_WEIGHTS = Object.freeze({ weather:35, activity:20, reserve:20, rotation:15, preference:10 });
const contexts = new WeakMap();
const group = item => CATEGORIES[item.category]?.group;
const available = item => !item.deletedAt && ['ready','rewear'].includes(item.state);
const athletic = item => item.running === 'yes' || item.running === 'auto' && !!CATEGORIES[item.category]?.running;
const peCourse = course => /体育|体能训练|运动与健康/.test(course.courseName);
const shorts = item => ['shorts','sportshorts'].includes(item.category);
const warmth = item => ({light:0,medium:1,warm:2}[item.warmth] ?? 1);
const plus = (date,days) => { const value=new Date(date+'T12:00:00');value.setDate(value.getDate()+days);return wearDate(value); };
const apart = (later,earlier) => Math.round((Date.parse(later+'T12:00:00Z')-Date.parse(earlier+'T12:00:00Z'))/86400000);
const bounded = (value,max) => Math.max(0,Math.min(max,Math.round(value)));
const thermal = (weather,profile) => weather ? (weather.feelsMin ?? weather.min)+(profile.thermalPreference==='cold'?-3:profile.thermalPreference==='hot'?3:0) : null;
const shortDate = date => date.slice(5);
const dayWeather = (forecast,date,now) => weatherDay(forecast,date,{now,from:'07:00',to:'22:00'});

function confirmedRows(data,date,now) {
  const today=wearDate(now),cutoff=date<today?date:today;
  return (data.wearLogs||[]).filter(row=>!row.deletedAt&&!row.actualUndoneAt&&row.actualPieces?.length&&row.date<=cutoff&&
    (!row.actualTime || +new Date(row.date+'T'+row.actualTime+':00')<=+now));
}

export function outfitPlanning(data,date,courses=[],futureCourses=[],forecast=null,now=new Date()) {
  const specified=Number(data.profile.laundryEveryDays)>0;
  const laundryDays=specified?data.profile.laundryEveryDays:2;
  const dryDays=data.profile.dryAfterDays;
  const horizonDays=7;
  const laundryReturnDate=plus(date,laundryDays+dryDays);
  const laundryAssumption=`${specified?'按已设置的':'洗衣间隔未设置，先按你提到的'}攒${laundryDays}天一起洗、晾${dryDays}天估算，穿后约${shortDate(laundryReturnDate)}进入预计收衣日；实际仍需确认干透。`;
  const allCourses=[...courses,...futureCourses],ready=data.garments.filter(available);
  const days=Array.from({length:horizonDays+1},(_,offset)=>{
    const day=plus(date,offset),pe=allCourses.some(course=>course.date===day&&peCourse(course)),plan=data.plans.find(row=>row.date===day);
    const weather=dayWeather(forecast,day,now),run=plan?.run===true;
    return {date:day,weather,pe,run,labels:[...(pe?['体育课']:[]),...(run?['校园跑']:[])]};
  });
  const reservations=[];
  const add=(day,kind,label,items,basis)=>{
    const garmentIds=items.map(item=>item.id).sort();
    reservations.push({date:day.date,kind,label,garmentIds,text:`${shortDate(day.date)}${basis}，目前确认可穿${label}${garmentIds.length}件；结合洗晒周转预留。`});
  };
  for(const day of days.slice(1).filter(day=>day.date<=laundryReturnDate)) {
    if(day.pe||day.run) {
      const needsShorts=day.pe&&data.profile.peNeedsShorts;
      add(day,needsShorts?'pe-shorts':'sport-bottom',needsShorts?'运动短裤':'运动下装',ready.filter(item=>group(item)==='bottom'&&athletic(item)&&(!needsShorts||shorts(item))),day.pe?'有体育课':'已安排校园跑');
    }
    const feels=thermal(day.weather,data.profile);
    if(feels!==null&&feels<19) {
      // A saved relation is evidence of a known combination, not proof that
      // unlinked tops cannot match a jacket.
      const linkedTopIds=new Set(data.outfits.filter(outfit=>!outfit.deletedAt&&outfit.garmentIds.some(id=>ready.some(item=>item.id===id&&group(item)==='layer')))
        .flatMap(outfit=>outfit.garmentIds.filter(id=>ready.some(item=>item.id===id&&group(item)==='top'))));
      if(linkedTopIds.size) {
        const linked=ready.filter(item=>linkedTopIds.has(item.id)),warmLinked=linked.filter(item=>warmth(item)===2);
        add(day,'layer-top','已存外套搭配中的上衣',feels<13&&warmLinked.length?warmLinked:linked,`预报体感最低约${Math.round(day.weather.feelsMin??day.weather.min)}°C`);
      } else if(feels<13) {
        const warmTops=ready.filter(item=>group(item)==='top'&&warmth(item)===2);
        if(warmTops.length)add(day,'warm-top','偏厚上衣',warmTops,`预报体感偏冷`);
      }
    }
  }
  const today=wearDate(now),compareDate=date===today?plus(today,1):date;
  const from=dayWeather(forecast,today,now),to=dayWeather(forecast,compareDate,now);
  const deltaMin=from&&to?Math.round(to.min-from.min):null,deltaMax=from&&to?Math.round(to.max-from.max):null;
  const deltaText=(value,label)=>value===0?`${label}接近今天`:`${label}比今天${value>0?'高':'低'}${Math.abs(value)}°C`;
  const weatherComparison=from&&to&&compareDate!==today?{fromDate:today,toDate:compareDate,fromMin:from.min,fromMax:from.max,toMin:to.min,toMax:to.max,deltaMin,deltaMax,
    text:`${compareDate===plus(today,1)?'明天':shortDate(compareDate)}${deltaText(deltaMin,'最低温')}，${deltaText(deltaMax,'最高温')}；比较相同的07:00—22:00预报区间。`}:null;
  const missingRuns=days.filter(day=>!data.plans.some(plan=>plan.date===day.date)).map(day=>day.date);
  const planning={horizonDays,laundryReturnDate,laundryAssumption,days,weatherComparison,reservations,
    runCheck:{dates:missingRuns,text:missingRuns.length?'这些日期还没记录校园跑；如果已有计划，可为对应日期选择安排。未记录不会自动当作要跑。':'近日校园跑安排已记录，明确不跑的日期不会重复询问。'}};
  const cutoff=new Date(Math.min(+now,+new Date(date+'T23:59:59')));
  const rows=confirmedRows(data,date,now).filter(row=>apart(date,row.date)<=30);
  const demands=reservations.filter(row=>row.garmentIds.length).sort((a,b)=>a.date.localeCompare(b.date)||a.kind.localeCompare(b.kind));
  contexts.set(planning,{date,profile:data.profile,usage:wearUsageIndex(data,cutoff),rows,demands,baseline:allocateDemand(demands,new Set())});
  return planning;
}

// Match each chronological use to one physical garment. Augmenting paths can
// move a flexible early run onto trousers, preserving the only shorts for PE.
// Merely counting each pool independently would double-book shared garments.
function allocateDemand(demands,excluded) {
  const occupied=new Map();
  function assign(index,seen) {
    for(const id of demands[index].garmentIds) {
      if(excluded.has(id)||seen.has(id))continue;
      seen.add(id);
      if(!occupied.has(id)||assign(occupied.get(id),seen)) {occupied.set(id,index);return true;}
    }
    return false;
  }
  for(let index=0;index<demands.length;index++)assign(index,new Set());
  const matched=new Set(occupied.values());
  return {count:matched.size,unmatched:demands.filter((_,index)=>!matched.has(index))};
}

export function scoreOutfit(set,{data,date,weather=null,pe=false,run=false,requireShorts=false,planning,preferred=false,now=new Date()}) {
  if(!planning||!contexts.has(planning))planning=outfitPlanning(data,date,[],[],null,now);
  const context=contexts.get(planning),pieces=set.pieces,body=pieces.filter(item=>['top','bottom'].includes(group(item)));
  const top=body.find(item=>group(item)==='top'),bottom=body.find(item=>group(item)==='bottom'),layer=pieces.find(item=>group(item)==='layer'),shoe=pieces.find(item=>group(item)==='shoes');
  const active=pe||run,feels=thermal(weather,data.profile),wet=weather?.rainProbability!==null&&weather?.rainProbability>=40;
  let weatherScore=24,weatherReason='该日期暂无可用预报，冷暖未纳入判断。';
  if(feels!==null) {
    const desired=feels<13?2:feels<23?1:0;
    // Two warmth steps on an essential piece must outweigh saving it for a
    // later day: the outfit still has to suit the day being prepared.
    weatherScore=35-body.reduce((sum,item)=>sum+Math.abs(warmth(item)-desired)*26,0)/Math.max(1,body.length);
    if(feels<19&&!layer)weatherScore-=9;
    if(wet&&shoe?.wetWeather==='no')weatherScore-=10;
    weatherReason=`参考${weather.date.slice(5)} ${weather.from}—${weather.to}预报${Math.round(weather.min)}—${Math.round(weather.max)}°C${layer?'，带可脱穿外层':''}${weather.status==='stale'?'（旧预报）':''}。`;
  }
  let activityScore=20;
  if(active&&!athletic(top))activityScore-=5;
  if(active&&!shoe)activityScore-=3;
  const activityReason=requireShorts?'已满足体育课短裤和运动下装要求。':active?`按${run?'已记录校园跑':'体育课'}筛选运动下装${shoe?'与鞋子':'；运动鞋尚未记录'}。`:'没有已记录的运动要求，按日常穿着准备。';
  const wornIds=new Set(body.map(item=>item.id));
  const after=allocateDemand(context.demands,wornIds),lost=context.baseline.count-after.count;
  const reservePenalty=20*lost/Math.max(1,context.baseline.count);
  const affected=after.unmatched.find(row=>!context.baseline.unmatched.includes(row));
  const warning=lost>0&&affected?`穿这套后，${shortDate(affected.date)}所需${affected.label}可能赶不上洗晒周转`:'';
  const firstDemand=context.demands[0];
  const preserved=!lost&&firstDemand?context.baseline.unmatched.length?'未进一步占用近日已知安排的用衣余量':`为${shortDate(firstDemand.date)}起的已知安排预留用衣轮换余量`:'';
  const reserveReason=warning||preserved||'未发现这套与预计洗晒周转前的已知用衣需求冲突。';
  const recent=body.map(item=>context.usage.get(item.id));
  const rotationPenalty=recent.reduce((sum,row)=>{
    if(!row?.lastWorn)return sum;
    const days=apart(date,row.lastWorn),recency=days<=1?5:days===2?3:days===3?1:0;
    return sum+Math.min(8,row.times7*1.5)+recency;
  },0)/Math.max(1,body.length);
  const rotationReason=body.map(item=>`${group(item)==='top'?'上衣':'下装'}近7天${context.usage.get(item.id)?.times7||0}次`).join('，')+'；只计已确认实穿。';
  const preferenceBase=6+(preferred?2:0)+body.reduce((sum,item)=>sum+(item.preference==='like'?2:item.preference==='avoid'?-4:0),0)/Math.max(1,body.length);
  let feedbackTotal=0,feedbackWeight=0;
  for(const row of context.rows) {
    const overlap=body.filter(item=>row.actualPieces.some(piece=>piece.id===item.id)).length/body.length;
    if(!overlap)continue;
    let value=row.rating===null?0:(row.rating-3)*0.6;
    if(row.feedback.includes('comfortable'))value+=0.4;
    if(row.feedback.includes('looks'))value+=0.4;
    if(active&&row.feedback.includes('restrictive'))value-=1.5;
    if(wet&&row.feedback.includes('wet'))value-=1.5;
    if(feels!==null&&feels<19&&row.feedback.includes('cold'))value-=1;
    if(feels!==null&&feels>=23&&row.feedback.includes('hot'))value-=1;
    feedbackTotal+=value*overlap;feedbackWeight+=overlap;
  }
  const preferenceReason=`${preferred?'参考已保存常用搭配；':''}${feedbackWeight?'参考相关实穿评分和体感反馈；':''}同时考虑你标记的喜欢或少穿偏好。`;
  const scoreBreakdown=[
    {key:'weather',label:'天气适配',score:bounded(weatherScore,35),max:35,reason:weatherReason},
    {key:'activity',label:'活动安排',score:bounded(activityScore,20),max:20,reason:activityReason},
    {key:'reserve',label:'洗晒预留',score:bounded(20-reservePenalty,20),max:20,reason:reserveReason},
    {key:'rotation',label:'近期轮换',score:bounded(15-rotationPenalty,15),max:15,reason:rotationReason},
    {key:'preference',label:'个人偏好',score:bounded(preferenceBase+(feedbackWeight?feedbackTotal/feedbackWeight:0),10),max:10,reason:preferenceReason},
  ];
  const scoreReasons=[warning||preserved,weather?weatherReason:null,rotationReason,preferred?'参考你的常用搭配':null].filter(Boolean).slice(0,3);
  return {...set,score:scoreBreakdown.reduce((sum,row)=>sum+row.score,0),scoreBreakdown,scoreReasons};
}
