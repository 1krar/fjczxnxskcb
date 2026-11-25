import { CATEGORIES, outfitSignature } from './daily-store.js?v=20261030-1';
import { getTodayState } from './day-plan.js?v=20261030-1';
import { weatherDay, weatherFacts, weatherIntervals } from './weather-model.js?v=20261030-1';
import { outfitPlanning, scoreOutfit } from './outfit-planning.js?v=20261030-1';

export const shortAdvice = value => typeof value === 'string' && [...value.trim()].length >= 5 && [...value.trim()].length <= 48 && !/[\r\n]/.test(value.trim());
const shortLabel = (value, length = 10) => {
  const chars = [...String(value || '').replace(/\s+/g, ' ').trim()];
  return chars.slice(0, length).join('') + (chars.length > length ? '…' : '');
};
const itemAt = item => item.dueDate ? +new Date(`${item.dueDate}T${item.dueTime || '23:59'}:00`) : Infinity;

// Select by relevance before bounding the context; manual homepage order is unrelated.
export function adviceItems(items, now) {
  return items.filter(item => item.reminderMode !== 'persistent' && !item.completedAt && !item.deletedAt &&
    (!item.dueDate || itemAt(item) >= +now - 86400000 && itemAt(item) <= +now + 7 * 86400000))
    .sort((a, b) => {
      const rank = item => !item.dueDate ? 4 : item.needsConfirmation ? 3 : itemAt(item) < +now ? 2 : 0;
      return rank(a) - rank(b) || itemAt(a) - itemAt(b) || String(a.id).localeCompare(String(b.id));
    });
}

export function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function nextDate(date, days = 1) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}
export const isPE = course => /体育|体能训练|运动与健康/.test(course.courseName);
export const isShorts = item => ['sportshorts', 'shorts'].includes(item.category);
export const isAvailable = item => !item.deletedAt && ['ready','rewear'].includes(item.state);
export function runningSuitable(item) {
  return item.running === 'yes' || item.running === 'auto' && Boolean(CATEGORIES[item.category]?.running);
}

export function plannedOutfit(data,row,fit) {
  const pieces=row&&!row.planCancelledAt?row.selectedPieces.map(piece=>data.garments.find(item=>item.id===piece.id)):[];
  const bottom=pieces.find(item=>item&&CATEGORIES[item.category].group==='bottom');
  const usable=!!pieces.length&&pieces.every(item=>item&&isAvailable(item))&&!!bottom&&
    (!fit.requireShorts||isShorts(bottom))&&(!(fit.pe||fit.run)||pieces.filter(item=>['bottom','shoes'].includes(CATEGORIES[item.category].group)).every(runningSuitable))&&
    (bottom.needsBelt!=='yes'||pieces.some(item=>item.category==='belt'));
  return {pieces,usable};
}

export function outfitRecommendation(data, date, courses = [], futureCourses = [], options = {}) {
  const planning=options.planning||outfitPlanning(data,date,courses,futureCourses,null,options.now||new Date());
  const pe = courses.some(isPE);
  const run = data.plans.some(plan => plan.date === date && plan.run);
  const active = pe || run;
  const requireShorts = pe && data.profile.peNeedsShorts;
  const available = data.garments.filter(item => isAvailable(item) || options.allowExpected && !item.deletedAt && item.state === 'drying' && item.expectedDate && item.expectedDate <= date);
  const allTops = available.filter(item => CATEGORIES[item.category].group === 'top').sort((a,b)=>a.id.localeCompare(b.id));
  const sportsTops=active?allTops.filter(runningSuitable):[];
  const tops=active&&sportsTops.length?sportsTops:allTops;
  const allBottoms = available.filter(item => CATEGORIES[item.category].group === 'bottom').sort((a,b)=>a.id.localeCompare(b.id));
  const belts = available.filter(item => item.category === 'belt');
  const bottoms = allBottoms.filter(item => (!requireShorts || isShorts(item)) && (!active || runningSuitable(item)) && (item.needsBelt !== 'yes' || belts.length));
  const weather = options.weather || null;
  const feels = weather ? (weather.feelsMin ?? weather.min) + (data.profile.thermalPreference === 'cold' ? -3 : data.profile.thermalPreference === 'hot' ? 3 : 0) : null;
  const desired = feels === null ? null : feels < 13 ? 2 : feels < 23 ? 1 : 0;
  const needLayer = feels !== null && feels < 19;
  const wet = weather?.rainProbability !== null && weather?.rainProbability >= 40;
  const preference = item => item.preference === 'like' ? 15 : item.preference === 'avoid' ? -35 : 0;
  const warmthScore = item => desired === null ? 0 : -Math.abs(({light:0,medium:1,warm:2}[item.warmth] ?? 1)-desired)*45;
  const shoeScore = item => preference(item) + (wet ? item.wetWeather === 'yes' ? 25 : item.wetWeather === 'no' ? -50 : 0 : 0);
  const shoes = available.filter(item => CATEGORIES[item.category].group === 'shoes' && (!active || runningSuitable(item))).sort((a,b)=>shoeScore(b)-shoeScore(a)||a.id.localeCompare(b.id));
  const layers = available.filter(item => CATEGORIES[item.category].group === 'layer').sort((a,b)=>warmthScore(b)+preference(b)-warmthScore(a)-preference(a)||a.id.localeCompare(b.id));
  const futureShortDays = new Set(futureCourses.filter(course => isPE(course) && course.date > date && course.date <= nextDate(date, planning.horizonDays)).map(course => course.date)).size;
  const readyShorts = available.filter(item => isShorts(item) && runningSuitable(item)).length;
  const preserveShorts = data.profile.peNeedsShorts && planning.reservations.some(row=>row.kind==='pe-shorts') && readyShorts <= futureShortDays;
  const missing = [];
  if (!tops.length) missing.push('还没有确认可穿的上衣，可以先录入或检查洗晒状态。');
  if (!bottoms.length) {
    const candidates = allBottoms.filter(item => (!requireShorts || isShorts(item)) && (!active || runningSuitable(item)));
    missing.push(candidates.some(item => item.needsBelt === 'yes') && !belts.length ? '合适的裤子需要腰带，目前没有确认可用的腰带。可以准备腰带或换条裤子。' :
      requireShorts ? '这天有体育课，按你的设置需要短裤；目前没有确认可穿且适合运动的短裤。先看看待洗和晾晒中的备用。' : active ? '目前没有确认可穿且适合运动的裤子，可以检查库存或为合适的单品调整运动适配。' : '还没有确认可穿的下装，可以先录入或检查洗晒状态。');
  }
  const month=Number(date.slice(5,7));
  const season=month>=3&&month<=5?'spring':month>=6&&month<=8?'summer':month>=9&&month<=11?'autumn':'winter';
  const shortSleeve=item=>/短袖|半袖/.test(item.name)||item.category==='tshirt'&&!/长袖/.test(item.name);
  const cold=feels!==null&&feels<19;
  const seasonFallback=feels===null&&[11,12,1,2].includes(month);
  const warmthRisk=set=>{
    const top=set.pieces[0],bottom=set.pieces[1],layer=set.pieces.find(item=>item.category==='jacket');
    if(!(cold||seasonFallback))return 0;
    const sleeveRisk=shortSleeve(top)?(layer?1:3):0;
    const shortsRisk=!requireShorts&&isShorts(bottom)?2:0;
    return sleeveRisk+shortsRisk+(feels!==null&&feels<13&&!layer&&top.warmth!=='warm'?1:0);
  };
  const availableById=new Map(available.map(item=>[item.id,item]));
  const topIds=new Set(tops.map(item=>item.id)),bottomIds=new Set(bottoms.map(item=>item.id));
  const excludedKeys=new Set((data.outfitExclusions||[]).filter(row=>row.excluded).map(row=>outfitSignature(row.garmentIds)));
  const savedByKey=new Map(data.outfits.filter(row=>!row.deletedAt).map(row=>[outfitSignature(row.garmentIds),row]));
  const pairMap=new Map();
  function evaluatePieces(pieces,saved) {
    const [top,bottom]=pieces;
    const shoe=pieces.find(item=>CATEGORIES[item.category].group==='shoes');
    const layer=pieces.find(item=>CATEGORIES[item.category].group==='layer');
    const ids=pieces.map(item=>item.id),key=outfitSignature(ids);
    if(excludedKeys.has(key))return null;
    saved??=savedByKey.get(key);
    const id=JSON.stringify(ids);
    const seasonMatch=saved?.seasons?.length?saved.seasons.includes(season)?1:-1:0;
    const reasons = [saved ? `常用搭配「${saved.name}」` : '按可穿单品组合'];
    if(seasonMatch===1)reasons.push('符合这套搭配的季节标签');
    if (requireShorts) reasons.push('符合你设置的体育课短裤要求');
    else if (run) reasons.push('为校园跑优先选了适合运动的下装');
    if (preserveShorts && bottom.category === 'joggers') reasons.push('后面还有体育课，可为短裤轮换留余地');
    if (bottom.needsBelt === 'yes') reasons.push('已搭上可用腰带');
    if (active && !runningSuitable(top)) reasons.push('这件上衣的运动适配待核对，跑前可换成方便活动的上衣');
    if (weather) reasons.push(`参考${weather.from}—${weather.to}预报${Math.round(weather.min)}—${Math.round(weather.max)}°C${layer?'，加入可脱穿外层':''}`);
    if (wet && shoe?.wetWeather === 'yes') reasons.push('按你标记的雨天适配选择鞋子');
    const conditionalIds = pieces.filter(item=>!isAvailable(item)).map(item=>item.id);
    if (conditionalIds.length) reasons.push('包含预计收衣的单品，需确认干透后使用');
    const set={id,pieces,reasons,conditionalIds,savedName:saved?.name||'',savedSeasons:saved?.seasons||[]};
    return scoreOutfit(set,{data,date,weather,pe,run,requireShorts,planning,preferred:!!saved,seasonMatch,mode:options.mode,now:options.now||new Date()});
  }
  function addPair(top,bottom,shoe,layer,belt,saved=null) {
    const pieces=[top,bottom,belt,layer,shoe].filter(Boolean),id=JSON.stringify(pieces.map(item=>item.id));
    if(pairMap.has(id)&&!saved)return true;
    const scored=evaluatePieces(pieces,saved);
    if(!scored)return false;
    if(!pairMap.has(id)||scored.score>pairMap.get(id).score||!pairMap.get(id).savedName)pairMap.set(id,scored);
    return true;
  }
  const groupOf=item=>CATEGORIES[item.category].group;
  const pools={top:tops,bottom:bottoms,shoes,layer:layers,accessory:belts};
  function recheckSet(set) {
    const pieces=set.pieces.map(item=>availableById.get(item.id));
    if(pieces.some(item=>!item))return null;
    const [top,bottom]=pieces,shoe=pieces.find(item=>groupOf(item)==='shoes');
    if(!topIds.has(top.id)||!bottomIds.has(bottom.id)||(active&&shoe&&!runningSuitable(shoe))||
      (bottom.needsBelt==='yes'&&!pieces.some(item=>item.category==='belt')))return null;
    return evaluatePieces(pieces);
  }
  function replacePiece(set,id) {
    const index=set.pieces.findIndex(item=>item.id===id);
    if(index<0)return null;
    const sourceRisk=warmthRisk(set);
    let best=null,bestRisk=Infinity;
    for(const item of pools[groupOf(set.pieces[index])]) {
      if(item.id===id)continue;
      const pieces=[...set.pieces];
      pieces[index]=item;
      const candidate=recheckSet({pieces});
      if(!candidate)continue;
      const risk=warmthRisk(candidate);
      if(risk>sourceRisk||risk>bestRisk)continue;
      if(!best||risk<bestRisk||candidate.score>best.score){best=candidate;bestRisk=risk;}
    }
    return best;
  }
  // Saved combinations are considered even when their items are outside the general search limit.
  for(const saved of data.outfits) {
    if(saved.deletedAt)continue;
    const items=saved.garmentIds.map(id=>availableById.get(id));
    if(items.some(item=>!item))continue;
    const byGroup=Object.fromEntries(items.map(item=>[CATEGORIES[item.category].group,item]));
    const {top,bottom,shoes:shoe,layer,accessory}=byGroup;
    if(!topIds.has(top.id)||!bottomIds.has(bottom.id)||active&&shoe&&!runningSuitable(shoe))continue;
    const belt=accessory||(bottom.needsBelt==='yes'?belts[0]:null);
    addPair(top,bottom,shoe,layer,belt,saved);
    const adjustedShoe=shoe||shoes[0],adjustedLayer=layer||((needLayer||seasonFallback)?layers[0]:null);
    if((adjustedShoe&&adjustedShoe!==shoe)||(adjustedLayer&&adjustedLayer!==layer))addPair(top,bottom,adjustedShoe,adjustedLayer,belt,saved);
  }
  const chosenLayer=needLayer||seasonFallback?layers[0]:null;
  const rankTop=(a,b)=>Number((cold||seasonFallback)&&shortSleeve(a))-Number((cold||seasonFallback)&&shortSleeve(b))||warmthScore(b)-warmthScore(a)||a.id.localeCompare(b.id);
  const rankBottom=(a,b)=>Number((cold||seasonFallback)&&isShorts(a))-Number((cold||seasonFallback)&&isShorts(b))||warmthScore(b)-warmthScore(a)||a.id.localeCompare(b.id);
  for(const top of [...tops].sort(rankTop).slice(0,24))for(const bottom of [...bottoms].sort(rankBottom).slice(0,24)) {
    const belt=bottom.needsBelt==='yes'?belts[0]:null;
    for(const shoe of shoes.length?shoes.slice(0,3):[null]){
      if(addPair(top,bottom,shoe,chosenLayer,belt))continue;
      for(const layer of chosenLayer?layers.slice(1,4):[])addPair(top,bottom,shoe,layer,belt);
      for(const otherShoe of shoes.slice(3,6))addPair(top,bottom,otherShoe,chosenLayer,belt);
      for(const otherBelt of belt?belts.slice(1,4):[])addPair(top,bottom,shoe,chosenLayer,otherBelt);
    }
  }
  const eligible=[...pairMap.values()].map(set=>({set,risk:warmthRisk(set)}));
  const lowestRisk=Math.min(...eligible.map(row=>row.risk));
  const pairs=eligible.filter(row=>row.risk===lowestRisk).map(row=>row.set).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const first = pairs[0];
  // Keep the AI pool varied: otherwise the first eight can differ only by shoes.
  const candidates=first?[first]:[];
  for(const group of ['top','bottom','shoes']) {
    const seen=new Set(candidates.map(set=>set.pieces.find(item=>CATEGORIES[item.category].group===group)?.id));
    let added=0;
    for(const set of pairs) {
      const id=set.pieces.find(item=>CATEGORIES[item.category].group===group)?.id;
      if(id&&!seen.has(id)&&added<2&&candidates.length<8){candidates.push(set);seen.add(id);added++;}
    }
  }
  for(const set of pairs)if(candidates.length<8&&!candidates.some(row=>row.id===set.id))candidates.push(set);
  const alternate = first ? pairs.find(pair => pair.id !== first.id && pair.pieces.find(item => CATEGORIES[item.category].group === 'bottom')?.id !== first.pieces.find(item => CATEGORIES[item.category].group === 'bottom')?.id) || pairs.find(pair => pair.id !== first.id) : null;
  const notes = weather ? [weather.status==='stale'?'使用旧预报，仅作参考。':'按区域逐小时预报提供搭配参考，实际冷暖以你的感受为准。'] : ['天气未更新，当前仅按活动、偏好与可穿状态搭配。'];
  if(seasonFallback)notes.push('暂无预报，优先推荐保暖穿搭。');
  if(first&&warmthRisk(first)>0&&cold)notes.push('可穿衣物的保暖选择有限，出门前可加一件保暖衣物。');
  if (needLayer && !layers.length) notes.push('该时段体感偏凉，已录衣橱中没有确认可用的外套。');
  if (wet) notes.push('部分时段有降雨可能，可考虑带伞；衣物未标注雨天适配时不假定防水。');
  if (active && !shoes.length) notes.push('尚无确认可用的运动鞋记录，运动前记得核对鞋子。');
  return { date, pe, run, requireShorts, readyShorts, futureShortDays, weather, weatherNote:options.weatherNote||'', sets: [first, alternate].filter(Boolean), candidates, missing, notes, planning, replacePiece, recheckSet };
}

export function planOutfits(data,date,courses=[],futureCourses=[],forecast=null,now=new Date(),{mode='standard'}={}) {
  const planning=outfitPlanning(data,date,courses,futureCourses,forecast,now);
  const weather = weatherDay(forecast,date,{now,from:'07:00',to:'22:00'});
  const weatherNote='日常按所选日期07:00—22:00预报参考。';
  const peCourses=courses.filter(isPE),run=data.plans.some(plan=>plan.date===date&&plan.run);
  const sportNeeded = peCourses.length>0 || run;
  const separate = sportNeeded && data.profile.changeMode !== 'allDay';
  const intervals=peCourses.map(course=>({from:course.startTime,to:course.endTime}));
  const timedPE=intervals.length>0&&intervals.every(row=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.from)&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.to)&&row.from<row.to);
  const sportWeather = !sportNeeded?null:!run&&timedPE?weatherIntervals(forecast,date,intervals,{now}):weather;
  const sportWeatherNote = !sportNeeded?'':run?'校园跑时段未设置，按07:00—22:00全天预报参考。':timedPE?`体育课${intervals.map(row=>`${row.from}—${row.to}`).join('、')}，按与上课区间相交的小时预报参考。`:'体育课时段不可用，按07:00—22:00全天预报参考。';
  const dailyData = separate ? {...data,plans:data.plans.filter(plan=>plan.date!==date)} : data;
  const scoring={planning,now,mode};
  const daily = outfitRecommendation(dailyData,date,separate?[]:courses,futureCourses,{...scoring,weather,weatherNote});
  const sport = separate ? outfitRecommendation(data,date,courses,futureCourses,{...scoring,weather:sportWeather,weatherNote:sportWeatherNote}) : null;
  const expectedDaily = outfitRecommendation(dailyData,date,separate?[]:courses,futureCourses,{...scoring,weather,weatherNote,allowExpected:true});
  const expectedSport = separate ? outfitRecommendation(data,date,courses,futureCourses,{...scoring,weather:sportWeather,weatherNote:sportWeatherNote,allowExpected:true}) : null;
  const conditional = [...new Map([...expectedDaily.sets.map(set=>({...set,purpose:'日常'})),...(expectedSport?.sets||[]).map(set=>({...set,purpose:'运动'}))].filter(set=>set.conditionalIds.length).map(set=>[set.purpose+set.id,set])).values()].slice(0,2);
  return { mode, daily, sport, conditional, weather, weatherNote, sportWeather, sportWeatherNote, separate, sportNeeded, planning,
    changeNote:separate ? data.profile.changeMode==='change'?'日常与运动分开准备。':'换装条件未设置，分别给出日常和运动候选；可在偏好里改为全天兼顾。' : '' };
}

export function departurePlan(course, profile, previous = null) {
  if (!course?.startDateTime || !profile.destinationKeyword || !profile.baseArea || !profile.travelMinutes || !course.location?.includes(profile.destinationKeyword)) return null;
  const alreadyThere = previous && (previous.location?.includes(profile.destinationKeyword) || profile.destinationArea && previous.location?.includes(profile.destinationArea));
  if (alreadyThere) return null;
  const morningFirst = !previous && course.startDateTime.getHours() < 11;
  const breakfast = morningFirst && ['onway', 'sit'].includes(profile.breakfastMode);
  const breakfastMinutes = breakfast ? profile.breakfastBuyMinutes + (profile.breakfastMode === 'sit' ? profile.breakfastEatMinutes : 0) : 0;
  const departure = new Date(+course.startDateTime - (profile.travelMinutes + breakfastMinutes) * 60000);
  const clock = `${String(departure.getHours()).padStart(2, '0')}:${String(departure.getMinutes()).padStart(2, '0')}`;
  const dayPrefix = localDate(departure) === course.date ? '' : `${localDate(departure)} `;
  const breakfastNote = !morningFirst ? '' : profile.breakfastMode === 'prepared' ? '早餐已备好时，可省去购餐等待。' : profile.breakfastMode === 'onway' ? '路上吃的时间与通勤重合，买早餐和排队仍要留时间。' : profile.breakfastMode === 'sit' ? '坐下吃早餐时，另外留出用餐时间。' : '早上也记得安排早餐。';
  return { departure, clock: dayPrefix + clock, text: `${previous ? '如果' : '按常用出发地安排，'}从${profile.baseArea}出发，先按约${profile.travelMinutes}分钟路程预算，${dayPrefix}${clock}左右出门${breakfastMinutes ? '（含已设置的早餐额外时间）' : ''}。${breakfastNote}`,
    basis: '出发时刻来自你的时间预算，未核验实时位置和路况；未设置的排队时间需另留。' };
}

export function buildAdvice({ now, courses, tomorrowCourses, items, data, futureCourses = [], activities = [], weather = null, studyCourses = [], tomorrowStudyCourses = [] }) {
  const eveningStudy=rows=>rows.filter(course=>course.source==='evening-study'&&course.studyAttendance!==false&&['normal','pending'].includes(course.studyStatus));
  studyCourses=eveningStudy([...studyCourses,...courses]);
  tomorrowStudyCourses=eveningStudy([...tomorrowStudyCourses,...tomorrowCourses]);
  courses=courses.filter(course=>course.source!=='evening-study');
  tomorrowCourses=tomorrowCourses.filter(course=>course.source!=='evening-study');
  const today = localDate(now);
  const tomorrow = nextDate(today);
  const pool = [];
  const add = (id, priority, lines, basis, href) => pool.push({ id, priority, lines, basis, href });
  const nearStudy=studyCourses.find(course=>course.endDateTime>now&&+course.startDateTime-+now<=2*3600000);
  if(nearStudy)add(`study:${nearStudy.date}`,nearStudy.startDateTime>now?75:35,
    nearStudy.studyStatus==='pending'?['晚自习请假还待确认，先按参加留出时间。']:nearStudy.startDateTime>now?['今晚还有晚自习，出门前把要用的东西带好。']:['晚自习这段时间，可以先做一件最想完成的小事。'],
    `来自你设置的晚自习个人规则：${nearStudy.date} ${nearStudy.startTime}—${nearStudy.endTime}；${nearStudy.studyStatus==='pending'?'记录为请假待确认，暂按参加准备。':'记录为正常参加。'}`,'#/study?date='+nearStudy.date);
  const weatherDate=now.getHours()>=18?tomorrow:today;
  const forecast=weatherDay(weather,weatherDate,{now,from:now.getHours()>=18?'07:00':`${String(now.getHours()).padStart(2,'0')}:00`,to:'23:00'});
  if(forecast?.status==='fresh'&&forecast.rainProbability>=40)add('weather:rain',60,[`${weatherDate===today?'接下来':'明天'}部分时段有降雨可能，带把伞更从容。`],`${forecast.location}区域预报，${forecast.from}—${forecast.to}降雨概率最高${forecast.rainProbability}%；不代表必然下雨。`,'#/wardrobe');
  const confirmed = adviceItems(items, now).filter(item => !item.needsConfirmation && item.dueDate);
  for (const item of confirmed) {
    const due = item.dueTime ? new Date(`${item.dueDate}T${item.dueTime}:00`) : new Date(`${nextDate(item.dueDate)}T00:00:00`);
    const hours = (due - now) / 3600000;
    if (hours > 48 && item.kind !== 'exam' && !item.nextStep || hours < 0) continue;
    const when = item.dueDate === today ? '今天' : item.dueDate === tomorrow ? '明天' : item.dueDate;
    const title = shortLabel(item.title || item.text, 9);
    const time = `${when}${item.dueTime || ''}`;
    const role = item.timeRole === 'start' ? '开始' : item.timeRole === 'deadline' ? '截止' : '有记录';
    const fact = `${title}，${time}${item.dueTime ? role : '记着这件事'}`;
    add(`item:${item.id}:future`, hours < 24 ? 100 : hours <= 48 ? 85 : 65,
      [`${fact}，提前留点时间。`, `${time}${item.dueTime ? role : ''}：${title}，从一小步开始也好。`],
      `来自你记录并确认的事项；${item.dueDate}${item.dueTime ? ' ' + item.dueTime : '，未设具体时刻'}。`, '#/tasks');
  }
  for (const [date, dayCourses, label, priority] of [[today, courses.filter(course => course.endDateTime > now), '今天接下来的', 98], [tomorrow, tomorrowCourses, '明天', 95]]) {
    const fit = outfitRecommendation(data, date, dayCourses, futureCourses);
    if (data.garments.some(item => !item.deletedAt && isShorts(item)) && fit.requireShorts && !fit.readyShorts) add(`shortage:${date}`, priority,
      [`${label}有体育课，给短裤洗晒留点时间。`, '体育课要用的短裤，洗晒轮换可以先安排。'],
      '依据课表、你设置的短裤要求与当前衣物状态；晾晒中的衣服未自动算作可穿。', '#/wardrobe');
  }
  const upcoming = courses.filter(course => course.startDateTime > now);
  const tomorrowFocus = now.getHours() >= 18 || !upcoming.length && !courses.some(course => course.startDateTime <= now && course.endDateTime > now);
  const focusCourses = tomorrowFocus ? tomorrowCourses : courses;
  const focusCourse = tomorrowFocus ? tomorrowCourses[0] : upcoming[0];
  if (focusCourse) {
    const index = focusCourses.indexOf(focusCourse);
    const previous = index > 0 ? focusCourses[index - 1] : null;
    const departure = departurePlan(focusCourse, data.profile, previous);
    if (departure) {
      add(`route:${focusCourse.date}:${focusCourse.startTime}`, tomorrowFocus ? 80 : 90,
        [`${tomorrowFocus ? '明天' : '今天'}跨区上课，按常用路线约${departure.clock}出发。`, `去${shortLabel(focusCourse.location, 8)}，约${departure.clock}出发更从容。`],
        `${departure.text} ${departure.basis}`, '#/schedule');
    }
    else if (tomorrowFocus && focusCourse.startDateTime?.getHours() < 10) add('early:tomorrow', 65,
      [`明早${focusCourse.startTime}有课，今晚可以先收好随身物品。`, `明早首课${focusCourse.startTime}，给早餐留点时间。`], '来自明日首课，未推算你的起床或入睡时刻。', '#/schedule');
  }
  const dirty = data.garments.filter(item => !item.deletedAt && item.state === 'dirty');
  if (dirty.length) {
    const elapsedDays = data.lastLaundryAt ? (new Date(today) - new Date(localDate(new Date(data.lastLaundryAt)))) / 86400000 : null;
    const due = data.profile.laundryEveryDays > 0 && elapsedDays !== null && elapsedDays >= data.profile.laundryEveryDays;
    add('laundry', due ? 70 : 45, [`有${dirty.length}件衣物记在待洗区，方便时一起洗吧。`, '洗衣可以攒一批，给运动衣物留点轮换时间。'], '来自你标记的衣物状态，洗衣间隔仅作提示。', '#/wardrobe');
  }
  const drying = data.garments.filter(item => !item.deletedAt && item.state === 'drying' && item.expectedDate && item.expectedDate <= today);
  if (drying.length) add('drying', 50, ['晾着的衣服到了预计收衣日，干了就可以收好。', '方便时看看衣服干了没有，再收进衣橱。'], '预计收衣日期来自你的记录，不代表实际已干。', '#/wardrobe');
  const hasAfternoon = courses.some(course => course.startDateTime && course.endDateTime && course.startDateTime.getHours() < 18 && (course.endDateTime.getHours() > 12 || course.endDateTime.getHours() === 12 && course.endDateTime.getMinutes() > 0));
  const confirmedActivities = activities.filter(item => item.status === 'confirmed');
  const afternoonActivity = confirmedActivities.some(item => item.date <= today && (item.endDate || item.date) >= today && (item.date < today || item.startTime < '18:00') && ((item.endDate || item.date) > today || item.endTime > '12:00'));
  const afternoonItem = items.some(item => item.reminderMode !== 'persistent' && !item.completedAt && !item.deletedAt && item.dueDate === today && (item.timeRole === 'deadline' || item.kind === 'task' || !item.dueTime || item.dueTime >= '12:00' && item.dueTime <= '18:00'));
  if (!hasAfternoon && !afternoonActivity && !afternoonItem && now.getHours() < 18) add('afternoon', 30, ['下午课表留白，若无别的安排，可以出去走走。', '下午课表无课，也可以留一点时间给自己。'], '当前课表下午无课，且未记录下午事项；其他私人安排未知。', '#/agenda');
  const activity = confirmedActivities.find(item => item.date === today || item.date === tomorrow);
  if (activity) add(`activity:${activity.id}`, 40, [`${activity.date === today ? '今天' : '明天'}还有${shortLabel(activity.title)}，留点准备时间。`, `给${shortLabel(activity.title)}留点余地，路上不用太赶。`], `来自已确认活动：${activity.date} ${activity.startTime}—${activity.endTime}。`, '#/agenda');
  add('gentle', 10, ['空下来的片刻，可以听首喜欢的歌，让今天慢一点。', '休息也可以成为今天安排里很舒服的一部分。', '一天不用塞得满满的，给喜欢的小事留点位置。', '想做点什么时，可以从最轻松的一小步开始。'], '一般性的轻量建议，不推断你的情绪或未记录的安排。', '#/agenda');
  return pool.map(item => ({ ...item, lines:item.lines.filter(shortAdvice) })).filter(item => item.lines.length).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

const CHOICE_KEY = 'course-dashboard-daily-choice-v1';
function readChoices() {
  try {
    const value = JSON.parse(localStorage.getItem(CHOICE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
export function chooseAdvice(pool, scope, now, limit, refresh = false) {
  const eligible = pool;
  if (!eligible.length) return null;
  const variants = eligible.flatMap(item => item.lines.map(line => ({ ...item, line })));
  const fingerprint = JSON.stringify(eligible.map(item => [item.id, item.lines, item.basis]));
  const date = localDate(now);
  const cache = readChoices();
  const old = cache.scope === scope && cache.date === date && cache.fingerprint === fingerprint ? cache : {};
  const calls = Array.isArray(cache.calls) ? cache.calls.filter(time => Number.isFinite(time) && time > +now - 60000 && time <= +now) : [];
  const seed = [...date].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  let index = Number.isInteger(old.index) && old.index >= 0 ? old.index % variants.length : eligible[0].priority >= 80 ? 0 : seed % variants.length;
  if (refresh) {
    if (calls.length >= limit) return { ...variants[index], limited: true, retrySeconds: Math.max(1, Math.ceil((calls[0] + 60000 - now) / 1000)) };
    // Change the subject before repeating another wording of the same reminder.
    const previous = index;
    const next = variants.findIndex((row, at) => at > index && row.id !== variants[index].id);
    index = next >= 0 ? next : variants.findIndex(row => row.id !== variants[index].id);
    if (index < 0) index = (previous + 1) % variants.length;
    calls.push(+now);
  }
  const result = { scope, date, fingerprint, index, calls };
  if (JSON.stringify(result) !== JSON.stringify(cache)) {
    try { localStorage.setItem(CHOICE_KEY, JSON.stringify(result)); }
    catch { return { ...variants[index], storageWarning: '换句状态未能保存，建议内容仍可查看。' }; }
  }
  return variants[index];
}

// Stable across sorting and completion of other items; safe as a bounded schema identifier.
export function dailySourceId(kind, value) {
  let a=2166136261, b=5381;
  for (const char of String(value)) { a=Math.imul(a^char.codePointAt(0),16777619); b=Math.imul(b,33)^char.codePointAt(0); }
  return `${kind}:${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}`;
}

// Only this bounded summary is sent for daily prose, never the complete stores.
export function dailyFacts({ now, courses, tomorrowCourses, items, activities = [], weather = null, studyCourses = [], tomorrowStudyCourses = [], studyNotice = '' }) {
  const today = localDate(now), tomorrow = nextDate(today);
  const eveningStudy=rows=>rows.filter(course=>course.source==='evening-study'&&course.studyAttendance!==false&&['normal','pending'].includes(course.studyStatus));
  studyCourses=eveningStudy([...studyCourses,...courses]);
  tomorrowStudyCourses=eveningStudy([...tomorrowStudyCourses,...tomorrowCourses]);
  courses=courses.filter(course=>course.source!=='evening-study');
  tomorrowCourses=tomorrowCourses.filter(course=>course.source!=='evening-study');
  const phase = getTodayState([...courses,...studyCourses].sort((a,b)=>(a.startDateTime||0)-(b.startDateTime||0)), now);
  const period = now.getHours() < 6 ? '夜间' : now.getHours() < 12 ? '上午' : now.getHours() < 18 ? '下午' : '晚上';
  const focus = phase.currentCourse || phase.nextCourse;
  const segment = phase.currentSegment;
  const facts = [{ id:'date', text:`今天是${today}；明天是${tomorrow}。` },
    { id:'clock', text:`请求时刻${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}；仅用于理解上下文，不在评论中复述当前时刻或倒计时。` },
    { id:'context:v2', text:`${studyNotice?`${studyNotice} `:''}现在是${period}，${studyNotice?'已知课程':'课程与晚间安排'}状态${phase.state}。${focus ? `当前或下一项${focus.source==='evening-study'?'晚自习个人安排':'课程'}：${focus.courseName}，${focus.startTime}—${focus.endTime || ''}，${focus.location || '地点未记录'}。` : ''}${segment ? segment.kind === 'break' ? `目前在课间，${segment.endTime}继续第${segment.nextSection}小节。` : `当前第${segment.section}小节${segment.startTime}—${segment.endTime}。` : ''}`.slice(0,350) }];
  for (const [id, label, rows] of [['today','今天',courses],['tomorrow','明天',tomorrowCourses]]) {
    facts.push({ id:`courses:${id}`, text:`${label}课表有${rows.length}大节课。${rows.length ? `首课${rows[0].startTime}「${rows[0].courseName}」${rows[0].location || ''}。` : '未排课程，不代表没有私人安排。'}`.slice(0,350) });
    if (!rows.some(course => course.startTime < '18:00' && course.endTime > '12:00')) facts.push({ id:`afternoon:${id}`, text:`${label}下午课表无课；仍需考虑要记得、已确认活动和准备事项，未记录的安排未知。` });
  }
  // Reserve the remaining budget for the most relevant personal records before generic context.
  const relevant = adviceItems(items, now).filter(item => item.dueDate && itemAt(item) >= +now && itemAt(item) <= +now+2*86400000 ||
    !item.dueDate && item.courseName && [courses,tomorrowCourses].flat().some(course => course.courseName === item.courseName));
  const remembered = relevant.slice(0,3).map(item => ({ id:dailySourceId('item', item.id), text:`要记得：${(item.title || item.text).slice(0,80)}。${item.timeRole === 'start' ? '开始' : item.timeRole === 'deadline' ? '截止' : '所设时间（含义未指定）'}：${item.dueDate || '日期未定'} ${item.dueTime || '时刻未定'}。${item.location ? `地点${item.location.slice(0,40)}；` : ''}${item.nextStep ? `用户准备动作${item.nextStep.slice(0,60)}；` : ''}${item.timeContext ? `相关区间${item.timeContext.slice(0,40)}；` : ''}${item.needsConfirmation ? '此记录标为待确认，不能把时间地点当成已核实；' : ''}仅知道尚未标记完成，不知道实际进度。`.slice(0,350) }));
  const activityFacts=activities.filter(item=>item.status==='confirmed'&&[today,tomorrow].includes(item.date)&&new Date(`${item.endDate||item.date}T${item.endTime||'23:59'}`)>now)
    .map(item=>({at:+new Date(`${item.date}T${item.startTime||'00:00'}`),id:dailySourceId('activity',item.id),text:`已确认参加：${item.title.slice(0,100)}，${item.date} ${item.startTime}—${item.endTime}，${item.location||'未设地点'}。`.slice(0,350)}));
  const nearestStudy=[...studyCourses,...tomorrowStudyCourses].filter(course=>course.endDateTime>now).sort((a,b)=>a.startDateTime-b.startDateTime)[0];
  if(nearestStudy)activityFacts.push({at:+nearestStudy.startDateTime,id:dailySourceId('activity',`evening-study:${nearestStudy.date}:${nearestStudy.studyStatus}`),text:`晚自习个人安排：${nearestStudy.date===today?'今天':'明天'}${nearestStudy.date} ${nearestStudy.startTime}—${nearestStudy.endTime}，第${nearestStudy.startSection}—${nearestStudy.endSection}节，${nearestStudy.location||'未设地点'}。${nearestStudy.studyStatus==='pending'?'请假待确认，仍按参加准备。':'按个人设置正常参加。'}晚自习不计入学术课程数。${nearestStudy.studyNote?`备注${nearestStudy.studyNote.slice(0,80)}。`:''}`.slice(0,350)});
  const confirmed=activityFacts.sort((a,b)=>a.at-b.at).slice(0,2).map(({id,text})=>({id,text}));
  facts.splice(3,0,...remembered,...confirmed,...weatherFacts(weather,now));
  return facts.slice(0,12);
}
