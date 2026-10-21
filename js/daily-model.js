import { CATEGORIES } from './daily-store.js?v=20261021-5';

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
export const isAvailable = item => !item.deletedAt && item.state === 'ready';
export function runningSuitable(item) {
  return item.running === 'yes' || item.running === 'auto' && Boolean(CATEGORIES[item.category]?.running);
}

export function outfitRecommendation(data, date, courses = [], futureCourses = []) {
  const pe = courses.some(isPE);
  const run = data.plans.some(plan => plan.date === date && plan.run);
  const active = pe || run;
  const requireShorts = pe && data.profile.peNeedsShorts;
  const available = data.garments.filter(isAvailable);
  const tops = available.filter(item => CATEGORIES[item.category].group === 'top');
  const allBottoms = available.filter(item => CATEGORIES[item.category].group === 'bottom');
  const belts = available.filter(item => item.category === 'belt');
  const bottoms = allBottoms.filter(item => (!requireShorts || isShorts(item)) && (!active || runningSuitable(item)) && (item.needsBelt !== 'yes' || belts.length));
  const shoes = available.filter(item => CATEGORIES[item.category].group === 'shoes' && (!active || runningSuitable(item)));
  const futureShortDays = new Set(futureCourses.filter(course => isPE(course) && course.date > date && course.date <= nextDate(date, 2)).map(course => course.date)).size;
  const readyShorts = available.filter(item => isShorts(item) && runningSuitable(item)).length;
  const preserveShorts = data.profile.peNeedsShorts && futureShortDays > 0 && readyShorts <= futureShortDays;
  const missing = [];
  if (!tops.length) missing.push('还没有确认可穿的上衣，可以先录入或检查洗晒状态。');
  if (!bottoms.length) {
    const candidates = allBottoms.filter(item => (!requireShorts || isShorts(item)) && (!active || runningSuitable(item)));
    missing.push(candidates.some(item => item.needsBelt === 'yes') && !belts.length ? '合适的裤子需要腰带，目前没有确认可用的腰带。可以准备腰带或换条裤子。' :
      requireShorts ? '这天有体育课，按你的设置需要短裤；目前没有确认可穿且适合运动的短裤。先看看待洗和晾晒中的备用。' : active ? '目前没有确认可穿且适合运动的裤子，可以检查库存或为合适的单品调整运动适配。' : '还没有确认可穿的下装，可以先录入或检查洗晒状态。');
  }
  const pairs = [];
  // Bound combinations to keep a large imported wardrobe inexpensive on a phone.
  for (const top of tops.slice(0, 40)) for (const bottom of bottoms.slice(0, 40)) {
    const preferred = data.outfits.find(outfit => !outfit.deletedAt && outfit.garmentIds.includes(top.id) && outfit.garmentIds.includes(bottom.id) && outfit.garmentIds.every(id => available.some(item => item.id === id && (!active || !['bottom', 'shoes'].includes(CATEGORIES[item.category].group) || runningSuitable(item)))));
    let score = preferred ? 100 : 0;
    if (active && runningSuitable(top)) score += 20;
    if (preserveShorts && bottom.category === 'joggers') score += 150;
    const neutral = color => ['black', 'white', 'grey', 'navy', 'beige'].includes(color);
    if (neutral(top.color) || neutral(bottom.color)) score += 5;
    const ids = new Set(preferred?.garmentIds || [top.id, bottom.id]);
    if (bottom.needsBelt === 'yes' && ![...ids].some(id => available.find(item => item.id === id).category === 'belt')) ids.add(belts[0].id);
    if (shoes[0] && ![...ids].some(id => CATEGORIES[available.find(item => item.id === id).category].group === 'shoes')) ids.add(shoes[0].id);
    const pieces = [...ids].map(id => available.find(item => item.id === id));
    const reasons = [preferred ? `来自常用搭配「${preferred.name}」` : '按可穿单品组合'];
    if (requireShorts) reasons.push('符合你设置的体育课短裤要求');
    else if (run) reasons.push('为校园跑优先选了适合运动的下装');
    if (preserveShorts && bottom.category === 'joggers') reasons.push('后面还有体育课，可为短裤轮换留余地');
    if (bottom.needsBelt === 'yes') reasons.push('已搭上可用腰带');
    if (active && !runningSuitable(top)) reasons.push('这件上衣的运动适配待核对，跑前可换成方便活动的上衣');
    pairs.push({ id: `${top.id}|${bottom.id}`, pieces, reasons, score });
  }
  pairs.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const first = pairs[0];
  const alternate = first ? pairs.find(pair => pair.id !== first.id && pair.pieces.find(item => CATEGORIES[item.category].group === 'bottom')?.id !== first.pieces.find(item => CATEGORIES[item.category].group === 'bottom')?.id) || pairs.find(pair => pair.id !== first.id) : null;
  const notes = ['当前搭配未使用天气预报，出门前请结合温度与降雨调整外层。'];
  if (active && !shoes.length) notes.push('尚无确认可用的运动鞋记录，运动前记得核对鞋子。');
  return { date, pe, run, requireShorts, readyShorts, futureShortDays, sets: [first, alternate].filter(Boolean), missing, notes };
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

export function buildAdvice({ now, courses, tomorrowCourses, items, data, futureCourses = [], activities = [] }) {
  const today = localDate(now);
  const tomorrow = nextDate(today);
  const pool = [];
  const add = (id, priority, lines, basis, href) => pool.push({ id, priority, lines, basis, href });
  const confirmed = items.filter(item => !item.completedAt && !item.deletedAt && !item.needsConfirmation && item.dueDate && ['task', 'exam', 'bring', 'change'].includes(item.kind));
  for (const item of confirmed) {
    const due = item.dueTime ? new Date(`${item.dueDate}T${item.dueTime}:00`) : new Date(`${nextDate(item.dueDate)}T00:00:00`);
    const hours = (due - now) / 3600000;
    if (hours > 48 || hours < -24) continue;
    const when = item.dueDate === today ? '今天' : item.dueDate === tomorrow ? '明天' : item.dueDate;
    const shortText = item.text.length > 50 ? item.text.slice(0, 50) + '…' : item.text;
    const fact = `「${shortText}」${hours < 0 ? '所设时间已过' : `记在${when}${item.dueTime || ''}`}`;
    add(`item:${item.id}:${hours < 0 ? 'past' : 'future'}`, hours < 24 ? 100 : 85,
      hours < 0 ? [`${fact}，可以先核对一下是否还需要处理。`, `${fact}。已经完成的话，顺手标记一下就好。`] :
        [`${fact}。${item.nextStep ? `可以先${item.nextStep}。` : '先看看要求，挑一个容易开始的小步骤就好。'}`, `${fact}，给它留一点准备时间，之后会从容一些。`],
      `来自你记录并确认的事项；${item.dueDate}${item.dueTime ? ' ' + item.dueTime : '，未设具体时刻'}。`, '#/tasks');
  }
  for (const [date, dayCourses, label, priority] of [[today, courses.filter(course => course.endDateTime > now), '今天接下来的', 98], [tomorrow, tomorrowCourses, '明天', 95]]) {
    const fit = outfitRecommendation(data, date, dayCourses, futureCourses);
    if (data.garments.some(item => !item.deletedAt && isShorts(item)) && fit.requireShorts && !fit.readyShorts) add(`shortage:${date}`, priority,
      [`${label}有体育课，已录入的短裤目前都不在可穿状态。可以为洗晒留一点时间。`, `${label}体育课会用到短裤，按已录入的洗晒状态，提前准备会从容一点。`],
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
      const breakfastHint = !previous && focusCourse.startDateTime.getHours() < 11 && data.profile.breakfastMode !== 'prepared' && !data.profile.breakfastBuyMinutes ? '买早餐和排队记得再留一点时间。' : '';
      add(`route:${focusCourse.date}:${focusCourse.startTime}`, tomorrowFocus ? 80 : 90,
        [`${tomorrowFocus ? '明天' : '今天'}${focusCourse.startTime}要去${focusCourse.location}；从${data.profile.baseArea}出发的话，先按${departure.clock}左右安排出门。${breakfastHint}`, `去${focusCourse.location}记得多留一点路上的时间。从${data.profile.baseArea}出发，暂按${departure.clock}左右准备好。${breakfastHint}`],
        `${departure.text} ${departure.basis}`, '#/schedule');
    }
    else if (tomorrowFocus && focusCourse.startDateTime?.getHours() < 10) add('early:tomorrow', 65,
      [`明天${focusCourse.startTime}有${focusCourse.courseName}，今晚先收好要带的东西，明早会从容一点。`, `明早首课是${focusCourse.courseName}，${focusCourse.startTime}开始。睡前可以顺手核对一下课程和物品。`], '来自明日首课，未推算你的起床或入睡时刻。', '#/schedule');
  }
  const dirty = data.garments.filter(item => !item.deletedAt && item.state === 'dirty');
  if (dirty.length) {
    const elapsedDays = data.lastLaundryAt ? (new Date(today) - new Date(localDate(new Date(data.lastLaundryAt)))) / 86400000 : null;
    const due = data.profile.laundryEveryDays > 0 && elapsedDays !== null && elapsedDays >= data.profile.laundryEveryDays;
    add('laundry', due ? 70 : 45, [`衣橱里有${dirty.length}件待洗。${due ? '按你设置的间隔，可以考虑安排这一批洗衣了。' : '方便的时候可以攒一批洗，运动要用的衣服先留意一下。'}`, `有${dirty.length}件衣物在待洗区，找个方便的时间一起处理吧。`], '来自你标记的衣物状态，洗衣间隔仅作提示。', '#/wardrobe');
  }
  const drying = data.garments.filter(item => !item.deletedAt && item.state === 'drying' && item.expectedDate && item.expectedDate <= today);
  if (drying.length) add('drying', 50, [`有${drying.length}件衣服到了预计收衣日，方便时看看干了没有，再一起收好。`, '可以顺手检查一下晾着的衣服，确认干了再标记为可穿就好。'], '预计收衣日期来自你的记录，不代表实际已干。', '#/wardrobe');
  const hasAfternoon = courses.some(course => course.startDateTime && course.endDateTime && course.startDateTime.getHours() < 18 && (course.endDateTime.getHours() > 12 || course.endDateTime.getHours() === 12 && course.endDateTime.getMinutes() > 0));
  const confirmedActivities = activities.filter(item => item.status === 'confirmed');
  const afternoonActivity = confirmedActivities.some(item => item.date <= today && (item.endDate || item.date) >= today && (item.date < today || item.startTime < '18:00') && ((item.endDate || item.date) > today || item.endTime > '12:00'));
  if (!hasAfternoon && !afternoonActivity && now.getHours() < 18) add('afternoon', 30, ['课表上今天下午没有课程。若没别的安排，可以约朋友走走，也可以安心休息。', '今天下午课表留了白，想出去玩一会儿或留给自己都可以。'], '当前课表下午无课，且未记录已确认的下午活动；不代表没有其他私人安排。', '#/agenda');
  const activity = confirmedActivities.find(item => item.date === today || item.date === tomorrow);
  if (activity) add(`activity:${activity.id}`, 40, [`${activity.date === today ? '今天' : '明天'}还安排了「${activity.title}」，课程之外也有自己的小期待。`, `给「${activity.title}」留一点从容的时间，路上也不用太赶。`], `来自已确认活动：${activity.date} ${activity.startTime}—${activity.endTime}。`, '#/agenda');
  add('gentle', 10, ['空下来的片刻，可以听首喜欢的歌，让今天慢一点。', '休息也可以成为今天安排里很舒服的一部分。', '一天不用塞得满满的，给喜欢的小事留点位置。', '想做点什么时，可以从最轻松的一小步开始。'], '一般性的轻量建议，不推断你的情绪或未记录的安排。', '#/agenda');
  return pool.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

const CHOICE_KEY = 'course-dashboard-daily-choice-v1';
function readChoices() {
  try {
    const value = JSON.parse(localStorage.getItem(CHOICE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
export function chooseAdvice(pool, scope, now, limit, refresh = false) {
  const eligible = pool[0]?.priority >= 80 ? pool.filter(item => item.priority === pool[0].priority) : pool;
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
    index = (index + 1) % variants.length;
    calls.push(+now);
  }
  const result = { scope, date, fingerprint, index, calls };
  if (JSON.stringify(result) !== JSON.stringify(cache)) {
    try { localStorage.setItem(CHOICE_KEY, JSON.stringify(result)); }
    catch { return { ...variants[index], storageWarning: '换句状态未能保存，建议内容仍可查看。' }; }
  }
  return variants[index];
}

// Only this bounded summary is sent for daily prose, never the complete stores.
export function dailyFacts({ now, courses, tomorrowCourses, items, activities = [] }) {
  const today = localDate(now), tomorrow = nextDate(today);
  const facts = [{ id:'date', text:`今天是${today}；明天是${tomorrow}。` }];
  for (const [id, label, rows] of [['today','今天',courses],['tomorrow','明天',tomorrowCourses]]) {
    facts.push({ id:`courses:${id}`, text:`${label}课表有${rows.length}大节课。${rows.length ? `首课${rows[0].startTime}「${rows[0].courseName}」${rows[0].location || ''}。` : '未排课程，不代表没有私人安排。'}`.slice(0,350) });
    if (!rows.some(course => course.startTime < '18:00' && course.endTime > '12:00')) facts.push({ id:`afternoon:${id}`, text:`${label}下午课表无课；个人活动另见已确认活动，未记录的安排未知。` });
  }
  items.filter(item => !item.completedAt && !item.deletedAt && !item.needsConfirmation && [today,tomorrow].includes(item.dueDate)).slice(0,3).forEach((item,index) => facts.push({ id:`item:${index}`, text:`用户记录事项：${item.text.slice(0,180)}。所设日期${item.dueDate}${item.dueTime ? ' '+item.dueTime : '，未设具体时刻'}；只知道尚未标记完成。` }));
  activities.filter(item => item.status === 'confirmed' && [today,tomorrow].includes(item.date)).slice(0,3).forEach((item,index) => facts.push({ id:`activity:${index}`, text:`已确认参加：${item.title.slice(0,150)}，${item.date} ${item.startTime}—${item.endTime}，${item.location || '未设地点'}。` }));
  return facts.slice(0,12);
}
