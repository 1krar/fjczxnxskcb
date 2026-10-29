import { reconcileRows } from './ui-list.js?v=20261030-1';
import { markFormSaved } from './refresh-guard.js?v=20261030-1';
import { reducedMotion } from './motion.js?v=20261030-1';
import { mountWearLog } from './wear-log.js?v=20261030-1';
import { visibleWearCandidates, wearUsageIndex } from './wear-model.js?v=20261030-1';
import { saveWearSelection, selectedWear } from './wear-store.js?v=20261030-1';
import { CATEGORIES, COLORS, CLOTHING_STATES, DEFAULT_PROFILE, DAILY_KEY, readDailyData, rawDailyData, emptyDailyData,
  validateDailyData, addGarments, editGarment, changeGarmentState, changeOutfitState, setArchived, saveOutfit, saveRunPlan, saveDailyProfile, mergeDailyBackup } from './daily-store.js?v=20261030-1';
import { localDate, nextDate, planOutfits, isAvailable, runningSuitable } from './daily-model.js?v=20261030-1';
import { cachedWeather, refreshWeather } from './weather-client.js?v=20261030-1';
import { weatherSummary } from './weather-model.js?v=20261030-1';
import { wardrobeDate, setWardrobeDate, wardrobeDateLabel } from './wardrobe-view.js?v=20261030-1';
import { aiEnabled, callAI } from './ai-client.js?v=20261030-1';
import { outfitAIInput, applyOutfitChoice } from './outfit-ai.js?v=20261030-1';
import { escapeText as esc, validDate } from './tasks-store.js?v=20261030-1';

const optionHTML = (values, selected) => Object.entries(values).map(([value, label]) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
const numberField = (label, name, value, max = 180) => `<label>${label}<input name="${name}" type="number" min="0" max="${max}" value="${value}"></label>`;
const textField = (label, name, value, placeholder = '') => `<label>${label}<input name="${name}" maxlength="100" value="${esc(value)}" placeholder="${placeholder}"></label>`;
function download(contents, name) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function profileForm(profile) {
  return `<form id="daily-profile-form"><div class="daily-check-row"><label><input name="enabled" type="checkbox"${profile.enabled ? ' checked' : ''}> 显示“今日一句”</label></div>
    <div class="wardrobe-fields">${numberField('每分钟最多换几句（1—10）', 'refreshPerMinute', profile.refreshPerMinute, 10)}${textField('天气地区', 'city', profile.city, '留空使用福州仓山附近')}</div>
    <div class="wardrobe-fields"><label>冷暖感受<select name="thermalPreference">${optionHTML({ unknown:'暂未设置', neutral:'一般', cold:'比较怕冷', hot:'比较怕热' },profile.thermalPreference)}</select></label><label>体育课／跑步换装<select name="changeMode">${optionHTML({ unknown:'暂未设置，分别给出候选', change:'可以换装，分开准备', allDay:'希望一套兼顾全天' },profile.changeMode)}</select></label></div>
    <details><summary>出行与早餐</summary><p class="daily-muted">填写常用路线后，遇到对应教室会提示准备出发；预算可以随时调整。</p>
      <div class="wardrobe-fields">${textField('常用出发区域', 'baseArea', profile.baseArea)}${textField('需要提前去的教学楼关键词', 'destinationKeyword', profile.destinationKeyword)}${textField('该教学楼所在区域', 'destinationArea', profile.destinationArea)}${numberField('跨区到课预留（分钟，0表示未设置）', 'travelMinutes', profile.travelMinutes)}</div>
      <label>早餐安排<select name="breakfastMode">${optionHTML({ unknown: '暂未设置', onway: '买好后在路上吃', sit: '坐下吃完再走', prepared: '出门前已备好' }, profile.breakfastMode)}</select></label>
      <div class="wardrobe-fields">${numberField('买早餐与排队额外留几分钟', 'breakfastBuyMinutes', profile.breakfastBuyMinutes)}${numberField('坐下用餐时间（分钟）', 'breakfastEatMinutes', profile.breakfastEatMinutes)}</div>
      <p class="daily-small">路上吃可与通勤重合，购餐等待仍另计；0表示未计入该项，不代表不需要时间。</p></details>
    <details><summary>运动与洗晒习惯</summary><label class="daily-check-row"><input type="checkbox" name="peNeedsShorts"${profile.peNeedsShorts ? ' checked' : ''}> 我的体育课需要短裤</label>
      <div class="wardrobe-fields">${numberField('通常攒几天一起洗（0为未设置，预留按2日估算）', 'laundryEveryDays', profile.laundryEveryDays, 30)}${numberField('晾晒后预计几天收衣', 'dryAfterDays', profile.dryAfterDays, 14)}</div>
      <p class="daily-small">确认今天实穿时，上衣和下装默认加入待洗，可逐件调整。收衣日只是预计，干透后再确认可穿。</p></details>
    <button type="submit" class="btn btn-primary">保存生活偏好</button></form>`;
}

const wardrobeView={date:'',follow:'tomorrow',panel:'prepare'};

export function renderWardrobe(container, state, dm) {
  let data;
  let corrupt = false;
  let initialError = '';
  try { data = readDailyData(); } catch (error) { data = emptyDailyData(); corrupt = true; initialError = error.message; }
  let selectedDate = wardrobeDate(wardrobeView,localDate(new Date()));
  let incoming = null;
  let importNumber = 0;
  let rawDownloaded = false;
  const shownCandidates=new Map();
  let preferenceDirty=false;
  let disposed = false, latestPlan = null, aiBusy = '', aiChoices = {}, weatherSerial = 0;
  let weatherBusy=false, weatherRequestCity='', weatherMessage='', weatherPending=false, lastWeatherAttempt=0, lastMinute='', lastDay=localDate(new Date());
  let automaticDryDate=nextDate(lastDay,data.profile.dryAfterDays);

  container.innerHTML = `<div class="wardrobe-page"><header class="wardrobe-header"><div><h1>小衣橱</h1><p id="wardrobe-intro">明天穿什么，今天穿了什么。</p></div><a href="#/today" class="daily-link">回到今日 →</a></header>
    <nav class="wardrobe-tabs" aria-label="衣橱功能"><button type="button" data-wardrobe-view="prepare" aria-pressed="true">准备穿搭</button><button type="button" data-wardrobe-view="record" aria-pressed="false">穿搭记录</button><button type="button" data-wardrobe-view="closet" aria-pressed="false">衣物洗晒</button></nav>
    <p id="wardrobe-feedback" data-save-feedback class="daily-feedback" role="status">${esc(initialError)}</p>
    <div class="wardrobe-layout"><div class="wardrobe-main-column">
      <section class="wardrobe-card" id="wardrobe-plan" data-wardrobe-panel="prepare" aria-labelledby="wardrobe-plan-title">
        <form id="run-plan-form"><div class="daily-heading"><h2 id="wardrobe-plan-title">明天穿什么</h2><details id="wardrobe-date-options"><summary>改日期</summary><div class="wardrobe-plan-controls"><div class="wardrobe-date-shortcuts"><button type="button" class="btn" data-outfit-day="tomorrow">明天</button><button type="button" class="btn" data-outfit-day="today">今天</button></div><label>准备哪一天<input id="outfit-date" data-refresh-safe type="date" value="${selectedDate}" min="2000-01-01" max="2100-12-31" required></label></div></details></div><label class="daily-check-row wardrobe-run"><input id="plan-run" type="checkbox"> 这天安排校园跑</label></form>
        <div id="wardrobe-recommendation"></div></section>
      <section class="wardrobe-card" id="wardrobe-wear" data-wardrobe-panel="record" hidden></section>
      <section class="wardrobe-card" id="wardrobe-inventory" data-wardrobe-panel="closet" hidden><div class="daily-heading"><h2>我的衣物</h2><button type="button" class="daily-text-button" data-open-add>＋ 录衣物</button><select id="garment-filter" aria-label="筛选衣物状态">${optionHTML({ all: '全部状态', ...CLOTHING_STATES }, 'all')}</select></div>
        <div class="wardrobe-laundry"><label class="outfit-laundry-select">按常用搭配选择<select id="laundry-outfit"><option value="">选一套，一起更新洗晒</option></select></label><p class="daily-small" id="laundry-outfit-hint">选中后可逐件取消；鞋、外套和腰带按实际情况决定。</p><div class="daily-heading"><label class="daily-check-row"><input id="select-all-garments" type="checkbox"> 选择当前列表</label><span id="garment-selection-count" class="daily-small">未选择</span></div>
          <div id="garment-selection-actions" hidden><div class="wardrobe-bulk-actions"><button class="btn" data-bulk-state="dirty" type="button">移到待洗</button><button class="btn" data-bulk-state="washing" type="button">开始洗</button><button class="btn" data-bulk-state="drying" type="button">已经晾晒</button><button class="btn" data-bulk-state="ready" type="button">收好可穿</button></div>
          <label class="wardrobe-dry-date">预计收衣日（仅用于晾晒提示）<input id="dry-expected-date" type="date" min="2000-01-01" max="2100-12-31" value="${nextDate(localDate(new Date()), data.profile.dryAfterDays)}"></label></div></div>
        <div id="garment-list"></div></section>
      <details class="wardrobe-card" id="wardrobe-outfits" data-wardrobe-panel="closet" hidden><summary>常用搭配</summary>
        <div id="outfit-list"></div><details id="outfit-builder"><summary>连接一套常用搭配</summary><form id="outfit-form"><label>搭配名称<input name="outfitName" maxlength="120" required placeholder="给这套搭配起个名字"></label><div id="outfit-picker"></div><p class="daily-small">每套一件上衣、一件下装；外套、鞋和腰带各选至多一件。待洗衣物也能保存关系，推荐时会核对可穿状态。</p><button class="btn btn-primary" type="submit">保存这套搭配</button></form></details></details>
      <details class="wardrobe-card" id="wardrobe-archive" data-wardrobe-panel="closet" hidden><summary>已收起的衣物与搭配</summary><div id="wardrobe-archive-list"></div></details>
    </div><aside class="wardrobe-side-column">
      <details class="wardrobe-card" id="add-garments" data-wardrobe-panel="closet" hidden${!data.garments.length && !corrupt ? ' open' : ''}><summary>录衣物</summary><p class="daily-muted" id="wardrobe-onboarding">先选一件上衣和一件下装，再补颜色。以后随时可以增加。</p><form id="add-garments-form"><fieldset><legend>勾选你拥有的类别</legend><div class="wardrobe-category-choices">${Object.entries(CATEGORIES).map(([key, category]) => `<label><input type="checkbox" name="category" value="${key}"> ${category.label}</label>`).join('')}</div></fieldset><div id="add-garment-panels"></div><button type="submit" class="btn btn-primary">加入衣橱</button></form></details>
      <details class="wardrobe-card" id="daily-preferences"><summary>穿搭与生活偏好</summary>${profileForm(data.profile)}</details>
      <details class="wardrobe-card" id="daily-backup"><summary>保存与备份</summary><p class="daily-muted">资料仅保存在当前浏览器，换设备前请下载备份。</p><p class="daily-muted">备份包含本机衣物、常用搭配、跑步安排、穿搭计划与实穿评分、单品洗晒历史和生活偏好。个人事项仍使用待办页的独立备份。</p>
        <div class="wardrobe-bulk-actions"><button class="btn" id="download-daily-backup" type="button">下载备份</button><button class="btn" id="download-daily-raw" type="button">下载原始文件</button></div>
        <label>选择日常助手备份<input type="file" id="import-daily-file" accept=".json,application/json"></label><div id="daily-import-preview" data-refresh-block hidden></div></details>
    </aside></div>
    <dialog id="garment-edit-dialog" class="capture-dialog" aria-labelledby="garment-edit-title"><form id="garment-edit-form"><div class="capture-heading"><h2 id="garment-edit-title">调整这件衣服</h2><button type="button" class="capture-close" aria-label="关闭衣物编辑">×</button></div>
      <label>衣物名称<input name="name" required maxlength="120"></label><label>颜色<select name="color">${optionHTML(COLORS, 'unknown')}</select></label>
      <label>腰带要求<select name="needsBelt">${optionHTML({ unknown: '暂未确定', yes: '需要腰带', optional: '可选', no: '不需要' }, 'unknown')}</select></label>
      <label>跑步适配<select name="running">${optionHTML({ auto: '按类别提供默认建议', yes: '这件适合我跑步', no: '这件不适合跑步' }, 'auto')}</select></label>
      <label>厚薄<select name="warmth">${optionHTML({ light: '偏薄', medium: '中等', warm: '偏厚 / 加绒' }, 'medium')}</select></label>
      <label>雨天适配<select name="wetWeather">${optionHTML({ unknown:'暂未确定', yes:'我觉得这件适合雨天', no:'雨天尽量避开' },'unknown')}</select></label><label>穿着偏好<select name="preference">${optionHTML({ neutral:'一般', like:'喜欢常穿', avoid:'尽量少穿' },'neutral')}</select></label>
      <p class="daily-small">厚薄、偏好和雨天适配会参与选择。雨天标签来自你的体验，不代表已验证防水或防滑；硬挺、紧窄或影响活动的裤子可标为不适合跑步。</p><p class="daily-error" id="garment-edit-error" role="alert"></p><button class="btn btn-primary" type="submit">保存修改</button></form></dialog></div>`;

  const $ = selector => container.querySelector(selector);
  let feedbackTimer;
  const feedback = (message, persist=false) => {
    clearTimeout(feedbackTimer); $('#wardrobe-feedback').textContent = message;
    if (!persist) feedbackTimer=setTimeout(()=>{ if (!disposed) $('#wardrobe-feedback').textContent=''; },6000);
  };
  function guard() { if (corrupt) throw new Error('原资料无法读取，请先保留原始文件，再到备份与恢复中处理'); }
  function showPanel(panel) {
    wardrobeView.panel=panel;
    container.querySelectorAll('[data-wardrobe-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.wardrobeView===panel)));
    container.querySelectorAll('[data-wardrobe-panel]').forEach(node=>node.hidden=node.dataset.wardrobePanel!==panel || node.id==='wardrobe-archive'&&!data.garments.some(item=>item.deletedAt)&&!data.outfits.some(item=>item.deletedAt));
  }
  function syncDate() {
    selectedDate=wardrobeDate(wardrobeView,localDate(new Date()));
    $('#outfit-date').value=selectedDate;
    $('#wardrobe-plan-title').textContent=wardrobeDateLabel(selectedDate,localDate(new Date()));
    container.querySelectorAll('[data-outfit-day]').forEach(button=>button.setAttribute('aria-pressed',String(wardrobeView.follow===button.dataset.outfitDay)));
  }
  function canRefreshWeatherUI() {
    return localDate(new Date())===lastDay&&!aiBusy&&!container.querySelector('dialog[open]')&&!container.contains(document.activeElement?.closest('input,select,textarea'));
  }
  function weatherChanged() {
    if(disposed)return;
    if(canRefreshWeatherUI()){weatherPending=false;refreshRecommendation();}else weatherPending=true;
  }
  function selectedIds() { return [...container.querySelectorAll('[data-garment-select]:checked')].map(input => input.value); }
  function selectedCount() {
    const rows = [...container.querySelectorAll('[data-garment-select]')];
    const count = selectedIds().length;
    $('#garment-selection-count').textContent = count ? `已选 ${count} 件` : '勾选后可批量洗晒';
    $('#garment-selection-actions').hidden = count === 0;
    $('#select-all-garments').checked = Boolean(rows.length && count === rows.length);
    $('#select-all-garments').indeterminate = count > 0 && count < rows.length;
  }
  function selectLaundryOutfit(id) {
    const outfit=data.outfits.find(item=>item.id===id&&!item.deletedAt);
    if(!outfit)return;
    $('#garment-filter').value='all';
    refreshLists();showPanel('closet');
    const ids=new Set(outfit.garmentIds);
    container.querySelectorAll('[data-garment-select]').forEach(input=>input.checked=ids.has(input.value));
    $('#laundry-outfit').value=id;selectedCount();
    feedback(`已选「${outfit.name}」中的${selectedIds().length}件；确认勾选后再更新状态`);
    $('#wardrobe-inventory').scrollIntoView({block:'start',behavior:reducedMotion()?'auto':'smooth'});
    $('#laundry-outfit').focus({preventScroll:true});
  }
  function refreshRecommendation() {
    if(disposed)return;
    const openAlternates=new Set([...container.querySelectorAll('.outfit-alternates[open]')].map(node=>node.dataset.purpose));
    const methodOpen=$('.outfit-method')?.open, conditionalOpen=$('.outfit-conditional')?.open, planningOpen=$('.outfit-planning-details')?.open;
    const openScores=new Set([...container.querySelectorAll('.outfit-score-details[open]')].map(node=>node.dataset.scoreId));
    shownCandidates.clear();
    const preference = $('#outfit-ai-preference')?.value || '';
    const typing=document.activeElement?.id==='outfit-ai-preference', cursor=typing?document.activeElement.selectionStart:null;
    syncDate();
    const courses = dm.getCoursesByDate(state.currentClass, selectedDate);
    const future = dm.getCourses(state.currentClass).filter(course => course.date > selectedDate && course.date <= nextDate(selectedDate, 7));
    const plan = planOutfits(data, selectedDate, courses, future, cachedWeather(data.profile.city));
    latestPlan = plan;
    const fit = plan.sport || plan.daily;
    const candidateHTML = (recommendation,purpose,label) => {
      const signature=JSON.stringify(outfitAIInput(plan,purpose,'',data.profile));
      const ai=aiChoices[purpose]?.signature===signature?aiChoices[purpose]:null;
      const visible=visibleWearCandidates(recommendation,ai?.set);
      const byScore=(a,b)=>(b.score||0)-(a.score||0)||a.id.localeCompare(b.id);
      const sets=ai&&visible.length?[visible[0],...visible.slice(1).sort(byScore)]:visible.sort(byScore),chosen=selectedWear(data,selectedDate,purpose);
      shownCandidates.set(purpose,sets);
      const suggestion=(set,index)=>{
        const explanation=ai&&!index?ai.explanation:(set.scoreReasons||set.reasons.filter(reason=>reason!=='按可穿单品组合'&&!/^参考\d{2}:\d{2}—/.test(reason))).slice(0,2).join('；');
        const score=Number.isFinite(set.score)&&set.scoreBreakdown?.length?`<span class="outfit-score">推荐分 <strong>${Math.round(set.score)}</strong></span>`:'';
        const scoreId=purpose+':'+set.id;
        return `<article class="wardrobe-suggestion"><div class="outfit-score-heading"><h4>${index?`备选 ${index}`:ai?'AI 选择':'推荐搭配'}</h4>${score}</div>${chainHTML(set.pieces)}${explanation?`<p class="daily-muted">${esc(explanation)}</p>`:''}${set.scoreBreakdown?.length?`<details class="outfit-score-details" data-score-id="${esc(scoreId)}"${openScores.has(scoreId)?' open':''}><summary>评分依据</summary><p class="daily-small">按冷暖、活动、预留、轮换与偏好综合比较；是参考排序，不是适合概率。</p><dl>${set.scoreBreakdown.map(row=>`<div><dt>${esc(row.label)} <span>${Math.round(row.score)}/${Math.round(row.max)}</span></dt><dd>${esc(row.reason)}</dd></div>`).join('')}</dl></details>`:''}<button type="button" class="btn${index?'':' btn-primary'}" data-select-outfit="${purpose}" data-candidate-index="${index}" aria-pressed="${!!chosen&&!chosen.planCancelledAt&&chosen.candidateId===set.id}">${chosen&&!chosen.planCancelledAt&&chosen.candidateId===set.id?'已选作计划':'选这套'}</button></article>`;
      };
      return `<section class="outfit-purpose">${plan.separate?`<h3>${label}</h3>`:''}
        ${purpose==='sport'?`<p class="outfit-sport-weather">${esc(recommendation.weatherNote)} · ${esc(recommendation.weather?weatherSummary(recommendation.weather):'暂无该时段预报，未纳入天气')}</p>`:''}
        ${chosen&&!chosen.planCancelledAt?`<p class="outfit-saved-plan">已选计划：${esc(chosen.selectedPieces.map(item=>item.name).join(' ＋ '))}</p>`:''}
        ${recommendation.missing.map(message=>`<p class="wardrobe-warning">${esc(message)}</p>`).join('')}
        ${recommendation.notes.slice(1).map(note=>`<p class="outfit-context-note">${esc(note)}</p>`).join('')}
        ${sets.length?suggestion(sets[0],0):''}<div class="outfit-option-tools">${sets.length>1?`<details class="outfit-alternates" data-purpose="${purpose}"${openAlternates.has(purpose)?' open':''}><summary>另外${sets.length-1}套备选</summary>${sets.slice(1).map((set,index)=>suggestion(set,index+1)).join('')}</details>`:''}${recommendation.sets.length?`<button type="button" class="daily-text-button" data-ai-outfit="${purpose}"${aiBusy?' disabled':''}>${aiBusy===purpose?'AI 正在挑选…':'AI 挑一套'}</button>`:''}</div></section>`;
    };
    $('#plan-run').checked = data.plans.some(plan => plan.date === selectedDate && plan.run);
    const weather=plan.weather, dateLabel=wardrobeDateLabel(selectedDate,localDate(new Date()));
    const updateTime=weather?new Date(weather.fetchedAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}):'';
    $('#wardrobe-recommendation').innerHTML = `<div class="outfit-weather"><div><p class="outfit-weather-label">${esc(weather?.location||data.profile.city||'福州仓山附近')} · ${esc(dateLabel.split(' · ')[0])}预报</p><p class="outfit-weather-range">${weather?`${Math.round(weather.min)}—${Math.round(weather.max)}<span>°C</span>`:'暂无可用预报'}</p><p class="outfit-weather-detail">${esc(weather?`${weather.feelsMin===null?'':`体感 ${Math.round(weather.feelsMin)}—${Math.round(weather.feelsMax)}°C · `}${weather.rainProbability===null?'降雨概率未知':`降雨概率最高 ${Math.round(weather.rainProbability)}%`}`:'先按活动与衣物状态选，天气尚未纳入')}</p></div><button type="button" class="daily-text-button" data-outfit-weather${weatherBusy?' disabled':''}>${weatherBusy?'更新中…':'更新天气'}</button><p class="outfit-weather-meta">${esc(weather?`${weather.from}—${weather.to} · ${updateTime}获取${weather.status==='stale'?' · 旧预报':''}`:`${selectedDate}暂无可用天气，不使用其他日期替代`)}</p>${weatherMessage?`<p class="outfit-weather-message" role="status">${esc(weatherMessage)}</p>`:''}</div>
      ${plan.planning?.weatherComparison?`<p class="outfit-weather-comparison">${esc(plan.planning.weatherComparison.text)}</p>`:''}
      <p class="daily-muted">${courses.length ? `${courses.length} 次课` : '课表上无课'}${fit.pe ? ` · 体育课${fit.requireShorts ? '需短裤' : ''}` : ''}${fit.run ? ' · 已安排校园跑' : ''}</p>
      ${plan.planning?.reservations?.length?`<p class="outfit-reservation">${esc(plan.planning.reservations[0].text)}</p>`:''}
      ${data.garments.some(item=>!item.deletedAt)?candidateHTML(plan.daily,'daily',plan.separate?'日常穿搭':'这天的穿搭')+(plan.sport?candidateHTML(plan.sport,'sport','运动准备 · 可课前换上'):''):'<p class="daily-muted">先录几件常穿衣服，就能参考活动、天气与洗晒状态选搭配。</p>'}
      ${plan.conditional.length?`<details class="outfit-conditional"${conditionalOpen?' open':''}><summary>干透后可用的备选 · ${plan.conditional.length}套</summary><p class="daily-small">这些单品仍在晾晒。预计收衣日不代表已经干透，可在衣物列表确认“收好可穿”。</p>${plan.conditional.map(set=>`<article><h4>${set.purpose}备选</h4>${chainHTML(set.pieces)}<p class="daily-small">待确认：${set.pieces.filter(item=>set.conditionalIds.includes(item.id)).map(item=>esc(item.name)).join('、')}</p></article>`).join('')}</details>`:''}
      ${!data.garments.some(item => !item.deletedAt) ? '<a href="#/wardrobe" class="daily-link" data-open-add>先录几件常穿衣服 →</a>' : ''}
      ${planningHTML(plan.planning,planningOpen)}
      <details class="outfit-method"${methodOpen?' open':''}><summary>搭配提示与 AI 偏好</summary>${[...new Set([...plan.daily.notes,...(plan.sport?.notes||[])])].map(note=>`<p class="daily-small">${esc(note)}</p>`).join('')}<p class="daily-small">${esc(plan.weather?`${plan.weather.location} · ${selectedDate.slice(5)} ${plan.weather.from}—${plan.weather.to}`:'所选日期暂无可用预报')}</p>
      <label>这次想怎么穿（可选）<input id="outfit-ai-preference"${preferenceDirty?' data-preserve-draft':''} maxlength="300" value="${esc(preference)}" placeholder="例如想穿牛仔裤，配色清爽一些"></label>
      <p class="daily-small">AI 只在点击时调用，从已确认可穿的候选中选择；<a href="#/api">配置 AI</a>。${esc(plan.changeNote)}</p>
      <p class="daily-small">区域预报来自 <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>（<a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>）；冷暖与厚薄为参考，可在生活偏好调整。</p></details>`;
    wearLog.render();
    if(typing){$('#outfit-ai-preference').focus({preventScroll:true});$('#outfit-ai-preference').setSelectionRange(cursor,cursor);}
  }
  function chainHTML(pieces) {
    return `<div class="outfit-chain">${pieces.map(item => `<span class="outfit-piece"><small>${esc(CATEGORIES[item.category]?.label||'单品')}</small><strong>${esc(item.name)}</strong></span>`).join('')}</div>`;
  }
  function planningHTML(planning,open=false) {
    const days=planning?.days?.filter(day=>day.date>selectedDate)||[];
    if(!days.length)return '';
    const today=localDate(new Date());
    return `<details class="outfit-planning-details"${open?' open':''}><summary>接下来几天 · 天气与运动安排</summary><p class="daily-small">${esc(planning.laundryAssumption||'按洗晒习惯估算预留，实际干透后再确认可穿。')}</p><div class="outfit-forecast-days">${days.map(day=>`<div class="outfit-forecast-day"><div><strong>${esc(wardrobeDateLabel(day.date,today).replace('所选日期 · ',''))}</strong><span>${day.weather?`${Math.round(day.weather.min)}—${Math.round(day.weather.max)}°C${day.weather.status==='stale'?' · 旧预报':''}`:'暂无该日预报'}${day.pe?' · 体育课':''}</span></div><label class="outfit-run-check">校园跑<select data-future-run="${esc(day.date)}" aria-label="${esc(day.date)}校园跑"><option value="" disabled${!data.plans.some(row=>row.date===day.date)?' selected':''}>未核对</option><option value="run"${day.run?' selected':''}>计划跑</option><option value="no"${!day.run&&data.plans.some(row=>row.date===day.date)?' selected':''}>这天不跑</option></select></label></div>`).join('')}</div><p class="daily-small">${esc(planning.runCheck?.text||'校园跑只按你记录的日期安排；穿过运动服不会自动认定参加了跑步。')}</p>${planning.reservations?.slice(1).map(row=>`<p class="daily-small">${esc(row.text)}</p>`).join('')||''}</details>`;
  }
  function refreshLists() {
    const kept = new Set(selectedIds());
    const selectedOutfit=$('#laundry-outfit').value;
    const openGarments = new Set([...container.querySelectorAll('[data-garment-detail][open]')].map(node=>node.dataset.garmentDetail));
    const activeCount=data.garments.filter(item=>!item.deletedAt).length;
    $('.wardrobe-page').classList.toggle('is-empty-wardrobe', !activeCount && !corrupt);
    $('.wardrobe-page').classList.toggle('has-wear-history', data.wearLogs.length > 0);
    $('#wardrobe-intro').textContent=activeCount?'明天穿什么，今天穿了什么。':'先录几件常穿衣服，之后就能选搭配。';
    $('#wardrobe-onboarding').hidden=activeCount>0;
    if (!activeCount && !corrupt) $('#add-garments').open=true;
    $('#wardrobe-archive').hidden=!data.garments.some(item=>item.deletedAt)&&!data.outfits.some(item=>item.deletedAt);
    const filter = $('#garment-filter').value;
    const usage=wearUsageIndex(data);
    const garments = data.garments.filter(item => !item.deletedAt && (filter === 'all' || item.state === filter));
    const garmentMarkup = garments.length ? garments.map(item => {
      const worn=usage.get(item.id);
      const nextState={ready:'dirty',rewear:'dirty',dirty:'washing',washing:'drying',drying:'ready'}[item.state];
      const nextAction={dirty:'放入待洗',washing:'开始洗',drying:'已晾晒',ready:'收好可穿'}[nextState];
      return `<article class="garment-row" data-garment-id="${esc(item.id)}"><div class="garment-row-heading"><label class="garment-choice"><input type="checkbox" data-garment-select value="${esc(item.id)}"${kept.has(item.id) ? ' checked' : ''}><span><strong>${esc(item.name)}</strong><span class="daily-small">${CATEGORIES[item.category].label} · ${COLORS[item.color]}${worn.lastWorn?` · 近7天 ${worn.times7}次`:''}</span></span></label><span class="garment-state state-${item.state}">${CLOTHING_STATES[item.state]}</span></div>
      ${item.state==='drying'?`<p class="daily-small garment-dry-hint">${item.expectedDate?`预计 ${item.expectedDate.slice(5)} 收衣，待确认干透`:'待确认干透'}</p>`:''}
      <div class="garment-quick-action"><button type="button" class="daily-text-button" data-next-garment="${esc(item.id)}" data-next-state="${nextState}" aria-label="${esc(item.name)}：${nextAction}">${nextAction}</button><details class="garment-detail" data-garment-detail="${esc(item.id)}"${openGarments.has(item.id)?' open':''}><summary>详情与调整</summary>
        <p class="daily-small">${worn.lastWorn?`近7天 ${worn.days7}天 / ${worn.times7}次 · 30天 ${worn.days30}天 / ${worn.times30}次 · 上次 ${worn.lastWorn.slice(5)}`:'暂无确认穿过的记录'}${item.needsBelt==='yes'?' · 需腰带':''}${CATEGORIES[item.category].group==='bottom'?runningSuitable(item)?' · 可作运动候选':' · 跑步时优先换装':''}</p>
        ${worn.afterWash!==null?`<p class="daily-small">本次开始洗涤后已记 ${worn.afterWash} 次${worn.sameDayUnknown?`；另有同日 ${worn.sameDayUnknown} 次未记时间，不判定先后`:''}</p>`:''}
        <div class="garment-actions"><label>状态<select data-item-state="${esc(item.id)}">${optionHTML(CLOTHING_STATES, item.state)}</select></label><button type="button" class="daily-text-button" data-edit-garment="${esc(item.id)}">调整衣物</button><button type="button" class="daily-text-button" data-archive-garment="${esc(item.id)}">收起</button></div></details></div></article>`;
    }).join('') : '<p class="daily-muted">这个状态下没有衣物，可以换个筛选查看。</p>';
    reconcileRows($('#garment-list'),garmentMarkup,'data-garment-id');
    $('#laundry-outfit').innerHTML='<option value="">选一套，一起更新洗晒</option>'+data.outfits.filter(item=>!item.deletedAt).map(outfit=>`<option value="${esc(outfit.id)}">${esc(outfit.name)}</option>`).join('');
    $('#laundry-outfit').value=selectedOutfit;
    $('#laundry-outfit').disabled=!data.outfits.some(item=>!item.deletedAt);
    $('#laundry-outfit-hint').textContent=data.outfits.some(item=>!item.deletedAt)?'选中后可逐件取消；鞋、外套和腰带按实际情况决定。':'先在“常用搭配”连接一套，之后可一起洗晒；也可直接勾选单品。';
    selectedCount();
    const picked = new Set([...container.querySelectorAll('[name=outfitGarment]:checked')].map(input => input.value));
    const active = data.garments.filter(item => !item.deletedAt);
    const groups = { top: '上衣', bottom: '下装', layer: '外套（可选）', shoes: '鞋（可选）', accessory: '腰带（可选）' };
    $('#outfit-picker').innerHTML = Object.entries(groups).map(([group, label]) => `<fieldset><legend>${label}</legend><div class="outfit-picker-group">${active.filter(item => CATEGORIES[item.category].group === group).map(item => `<label><input type="checkbox" name="outfitGarment" data-group="${group}" value="${esc(item.id)}"${picked.has(item.id) ? ' checked' : ''}> ${esc(item.name)}<span class="daily-small">${CLOTHING_STATES[item.state]}</span></label>`).join('') || '<span class="daily-small">还没有录入</span>'}</div></fieldset>`).join('');
    $('#outfit-list').innerHTML = data.outfits.filter(item => !item.deletedAt).map(outfit => {
      const pieces = outfit.garmentIds.map(id => data.garments.find(item => item.id === id));
      const ready = pieces.every(item => isAvailable(item));
      return `<article class="saved-outfit"><div class="daily-heading"><h3>${esc(outfit.name)}</h3><button type="button" class="daily-text-button" data-archive-outfit="${esc(outfit.id)}">收起</button></div>${chainHTML(pieces)}<p class="daily-small">${ready ? '这套单品目前都已确认可穿' : '部分单品待洗、晾晒或已收起，推荐时会避开'}</p><button type="button" class="daily-text-button" data-laundry-outfit="${esc(outfit.id)}">整套选择洗晒 →</button></article>`;
    }).join('') || '<p class="daily-muted">常搭的衣服连起来，以后会优先参考。</p>';
    $('#wardrobe-archive-list').innerHTML = [
      ...data.garments.filter(item => item.deletedAt).map(item => `<div class="archive-row"><span>${esc(item.name)}</span><button class="btn" type="button" data-restore-garment="${esc(item.id)}">恢复衣物</button></div>`),
      ...data.outfits.filter(item => item.deletedAt).map(item => `<div class="archive-row"><span>${esc(item.name)}</span><button class="btn" type="button" data-restore-outfit="${esc(item.id)}">恢复搭配</button></div>`),
    ].join('') || '<p class="daily-muted">没有已收起的记录。</p>';
    refreshRecommendation();
    showPanel(wardrobeView.panel);
  }
  function reload(message = '') {
    const focused = document.activeElement;
    const focusId = focused?.dataset.itemState || focused?.dataset.editGarment;
    const quickFocus=focused?.dataset.nextGarment;
    const runFocus=focused?.dataset.futureRun;
    const oldCity=data.profile.city;
    data = readDailyData(); corrupt = false; refreshLists(); if (message) feedback(message);
    if(oldCity!==data.profile.city)updateWeather();
    if (focusId) [...container.querySelectorAll('[data-item-state]')].find(input => input.dataset.itemState === focusId)?.focus({ preventScroll: true });
    if (quickFocus) [...container.querySelectorAll('[data-next-garment]')].find(button=>button.dataset.nextGarment===quickFocus)?.focus({preventScroll:true});
    if (runFocus) [...container.querySelectorAll('[data-future-run]')].find(input=>input.dataset.futureRun===runFocus)?.focus({preventScroll:true});
  }
  function addPanel(category) {
    const group = CATEGORIES[category].group;
    return `<fieldset data-add-category="${category}"><legend>${CATEGORIES[category].label}</legend><div class="wardrobe-fields"><label>颜色<select name="${category}-color">${optionHTML(COLORS, 'unknown')}</select></label><label>数量（鞋按双）<input name="${category}-quantity" type="number" min="1" max="10" value="1" required></label><label>厚薄<select name="${category}-warmth">${optionHTML({light:"偏薄",medium:"中等",warm:"偏厚 / 加绒"},"medium")}</select></label><label>当前状态<select name="${category}-state">${optionHTML(CLOTHING_STATES, 'ready')}</select></label>${group === 'bottom' ? `<label>腰带要求<select name="${category}-belt">${optionHTML({ unknown: '暂未确定', yes: '需要腰带', optional: '可选', no: '不需要' }, 'unknown')}</select></label>` : ''}</div><label>备注名称（可选）<input name="${category}-name" maxlength="100" placeholder="留空会按类别和颜色命名"></label></fieldset>`;
  }

  const onChange = event => {
    const target = event.target;
    try {
      if (target.name === 'category') {
        const panel = container.querySelector(`[data-add-category="${target.value}"]`);
        if (target.checked && !panel) $('#add-garment-panels').insertAdjacentHTML('beforeend', addPanel(target.value));
        else if (!target.checked) panel?.remove();
      } else if (target.id === 'plan-run') {
        guard(); saveRunPlan(selectedDate,target.checked); markFormSaved($('#run-plan-form')); reload('这天的校园跑安排已保存');
      } else if (target.dataset.futureRun) {
        guard();saveRunPlan(target.dataset.futureRun,target.value==='run');reload('校园跑日期已更新，推荐会重新考虑运动衣物预留');
      } else if (target.id === 'laundry-outfit') {
        if(target.value)selectLaundryOutfit(target.value);
      } else if (target.id === 'garment-filter') {$('#laundry-outfit').value='';refreshLists();}
      else if (target.id === 'select-all-garments') {
        container.querySelectorAll('[data-garment-select]').forEach(input => input.checked = target.checked); $('#laundry-outfit').value='';selectedCount();
      } else if (target.matches('[data-garment-select]')) {$('#laundry-outfit').value='';selectedCount();}
      else if (target.name === 'outfitGarment' && target.checked) container.querySelectorAll(`[name=outfitGarment][data-group="${target.dataset.group}"]`).forEach(input => { if (input !== target) input.checked = false; });
      else if (target.id === 'outfit-date') {
        if (!validDate(target.value)) throw new Error('请选择有效日期'); selectedDate = target.value;
        setWardrobeDate(wardrobeView,selectedDate,localDate(new Date())); refreshRecommendation();
      } else if (target.matches('[data-item-state]')) {
        guard(); changeGarmentState([target.dataset.itemState], target.value, $('#dry-expected-date').value); reload('衣物状态已更新');
      }
    } catch (error) {
      if (target.dataset.itemState) target.value = data.garments.find(item => item.id === target.dataset.itemState)?.state || 'ready';
      feedback(error.message,true);
    }
  };
  async function updateWeather(manual=false) {
    const city=data.profile.city;
    if(weatherBusy&&weatherRequestCity===city)return;
    const token=++weatherSerial;
    weatherBusy=true;weatherRequestCity=city;weatherMessage='';lastWeatherAttempt=Date.now();weatherChanged();
    try{await refreshWeather(city,manual);}
    catch(error){if(!disposed&&token===weatherSerial)weatherMessage=error.message;}
    finally{if(!disposed&&token===weatherSerial){weatherBusy=false;weatherChanged();}}
  }
  const onClick = async event => {
    const button = event.target.closest('button, [data-open-add]');
    if (!button || !container.contains(button)) return;
    try {
      if(button.dataset.wardrobeView)showPanel(button.dataset.wardrobeView);
      else if(button.dataset.outfitDay){wardrobeView.follow=button.dataset.outfitDay;refreshRecommendation();}
      else if(button.id==='cancel-daily-import'){incoming=null;$('#daily-import-preview').hidden=true;feedback('已取消恢复，衣橱未改动');}
      else if(button.matches('[data-outfit-weather]')) { button.disabled=true;await updateWeather(true);if(button.isConnected)button.disabled=false; }
      else if(button.dataset.selectOutfit) {
        guard();const purpose=button.dataset.selectOutfit,sets=shownCandidates.get(purpose)||[],set=sets[Number(button.dataset.candidateIndex)],fit=purpose==='sport'?latestPlan.sport:latestPlan.daily;
        saveWearSelection(selectedDate,purpose,set,sets,{weatherText:fit.weather?`${fit.weatherNote} · ${weatherSummary(fit.weather)}`:'',preference:$('#outfit-ai-preference').value.trim(),courses:dm.getCoursesByDate(state.currentClass,selectedDate).map(course=>course.courseName).slice(0,20)});
        preferenceDirty=false;reload('已选作计划，实际穿过后再确认；选中不会增加穿着次数');
        [...container.querySelectorAll('[data-select-outfit]')].find(node=>node.dataset.selectOutfit===purpose&&node.dataset.candidateIndex===button.dataset.candidateIndex)?.focus({preventScroll:true});
      }
      else if(button.dataset.aiOutfit) {
        if(!aiEnabled('outfit'))throw Error('请到 API 设置启用 AI 穿搭并填写个人访问口令。');
        const purpose=button.dataset.aiOutfit, input=outfitAIInput(latestPlan,purpose,$('#outfit-ai-preference').value,data.profile), signature=JSON.stringify(outfitAIInput(latestPlan,purpose,'',data.profile));
        aiBusy=purpose;$('#wardrobe-plan').setAttribute('aria-busy','true');refreshRecommendation();feedback('AI 正在结合你的想法挑选…');
        try {
          const result=await callAI('outfit',input);
          if(disposed)return;
          if(purpose==='sport'&&!latestPlan.sport||signature!==JSON.stringify(outfitAIInput(latestPlan,purpose,'',data.profile))||input.preference!==$('#outfit-ai-preference').value.trim()) {feedback('日期、衣物、天气或想法已变化，请按当前候选重新挑选。');return;}
          aiChoices[purpose]={...applyOutfitChoice(input,purpose==='sport'?latestPlan.sport:latestPlan.daily,result),signature};feedback('AI 已选好；不会改变衣物的洗晒状态。');
        } finally {aiBusy='';if(!disposed){$('#wardrobe-plan').removeAttribute('aria-busy');markFormSaved($('#wardrobe-plan'));refreshRecommendation();}}
      }
      else if (button.matches('[data-open-add]')) { event.preventDefault(); showPanel('closet');$('#add-garments').open = true; $('#add-garments').scrollIntoView({ behavior: reducedMotion()?'auto':'smooth' }); }
      else if(button.dataset.nextGarment){guard();changeGarmentState([button.dataset.nextGarment],button.dataset.nextState,$('#dry-expected-date').value);reload('衣物已更新；如需改回，可在“详情与调整”选择状态');}
      else if(button.dataset.laundryOutfit)selectLaundryOutfit(button.dataset.laundryOutfit);
      else if (button.dataset.bulkState) { guard();const outfitId=$('#laundry-outfit').value;if(outfitId)changeOutfitState(outfitId,button.dataset.bulkState,$('#dry-expected-date').value,selectedIds());else changeGarmentState(selectedIds(), button.dataset.bulkState, $('#dry-expected-date').value); reload('所选衣物状态已更新'); }
      else if (button.dataset.editGarment) {
        guard(); const item = data.garments.find(item => item.id === button.dataset.editGarment);
        const form = $('#garment-edit-form'); form.dataset.id = item.id;
        for (const key of ['name', 'color', 'needsBelt', 'running', 'warmth', 'wetWeather', 'preference']) form.elements[key].value = item[key];
        $('#garment-edit-error').textContent = ''; $('#garment-edit-dialog').showModal(); form.elements.name.focus();
      } else if (button.matches('.capture-close')) $('#garment-edit-dialog').close();
      else if (button.dataset.archiveGarment || button.dataset.restoreGarment) { guard(); setArchived('garment', button.dataset.archiveGarment || button.dataset.restoreGarment, Boolean(button.dataset.archiveGarment)); reload('衣物已更新，可在收起列表恢复'); }
      else if (button.dataset.archiveOutfit || button.dataset.restoreOutfit) { guard(); setArchived('outfit', button.dataset.archiveOutfit || button.dataset.restoreOutfit, Boolean(button.dataset.archiveOutfit)); reload('搭配已更新'); }
      else if (button.id === 'download-daily-backup') { guard(); download(JSON.stringify({ ...readDailyData(), exportedAt: new Date().toISOString() }, null, 2), `日常助手-备份-${localDate(new Date())}.json`); feedback('已生成本机日常资料备份'); }
      else if (button.id === 'download-daily-raw') { download(rawDailyData(), `日常助手-原始资料-${localDate(new Date())}.json`); rawDownloaded = true; feedback('已生成原始资料文件，请妥善保存'); }
      else if (button.id === 'confirm-daily-import') {
        if (!incoming) throw new Error('请先选择并检查备份');
        if (corrupt && (!rawDownloaded || !$('#replace-unreadable-check')?.checked)) throw new Error('请先下载原始资料，并确认已保留后再替换');
        mergeDailyBackup(incoming, corrupt); incoming = null; reload('备份已恢复；相同编号按较新的修改合并');
        $('#daily-import-preview').hidden = true; $('#import-daily-file').value = '';
      }
    } catch (error) { if(!disposed)feedback(error.message,true); }
  };
  const onSubmit = event => {
    const form = event.target;
    if (!form.matches('form')) return;
    event.preventDefault();
    try {
      guard();
      if (form.id === 'add-garments-form') {
        const firstItems = !data.garments.some(item=>!item.deletedAt);
        const fields = new FormData(form);
        const groups = fields.getAll('category').map(category => ({ category, color: fields.get(`${category}-color`), quantity: Number(fields.get(`${category}-quantity`)), state: fields.get(`${category}-state`), warmth: fields.get(`${category}-warmth`), needsBelt: fields.get(`${category}-belt`) || 'no', name: fields.get(`${category}-name`) }));
        const count = addGarments(groups); form.reset(); $('#add-garment-panels').innerHTML = ''; reload(`已加入${count}件衣物，同款也分别计数`);
        if (firstItems) {
          $('#add-garments').open=false;
          showPanel('prepare');
          const heading=$('#wardrobe-plan h2'); heading.tabIndex=-1;
          $('#wardrobe-plan').scrollIntoView({block:'start',behavior:'auto'}); heading.focus({preventScroll:true});
        }
      } else if (form.id === 'outfit-form') {
        saveOutfit(form.elements.outfitName.value, new FormData(form).getAll('outfitGarment')); form.reset(); reload('常用搭配已连接好');
      } else if (form.id === 'run-plan-form') {
        saveRunPlan(selectedDate, $('#plan-run').checked); markFormSaved(form); reload('这天的跑步安排已保存');
      } else if (form.id === 'daily-profile-form') {
        const fields = new FormData(form); const values = {};
        for (const key of Object.keys(DEFAULT_PROFILE)) {
          if (key === 'updatedAt') continue;
          values[key] = typeof DEFAULT_PROFILE[key] === 'boolean' ? fields.has(key) : typeof DEFAULT_PROFILE[key] === 'number' ? Number(fields.get(key)) : fields.get(key);
        }
        saveDailyProfile(values); markFormSaved(form); reload('生活偏好已保存在本浏览器'); updateWeather();
        $('#dry-expected-date').value = nextDate(localDate(new Date()), data.profile.dryAfterDays);
        automaticDryDate=$('#dry-expected-date').value;
      } else if (form.id === 'garment-edit-form') {
        editGarment(form.dataset.id, Object.fromEntries(new FormData(form))); $('#garment-edit-dialog').close(); reload('这件衣物已更新');
      }
    } catch (error) {
      if (form.id === 'garment-edit-form') $('#garment-edit-error').textContent = error.message;
      else feedback(error.message,true);
    }
  };
  const importFile = async event => {
    const file = event.target.files[0]; const token = ++importNumber;
    incoming = null; $('#daily-import-preview').hidden = true;
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('备份超过8MB，请检查文件');
      const parsed = validateDailyData(JSON.parse(await file.text()));
      if (token !== importNumber) return;
      incoming = parsed;
      $('#daily-import-preview').innerHTML = `<p>已检查：${parsed.garments.length}件衣物、${parsed.outfits.length}套搭配、${parsed.plans.length}条跑步安排、${parsed.wearLogs.length}条穿搭记录和${parsed.garmentEvents.length}条洗晒历史。${corrupt ? '本机资料损坏，确认后将用此备份替换。' : '确认后合并，旧备份不会覆盖较新的修改。'}</p>${corrupt ? '<label class="daily-check-row"><input id="replace-unreadable-check" type="checkbox"> 我已下载并保留原始资料，确认替换无法读取的内容</label>' : ''}<button class="btn btn-primary" id="confirm-daily-import" type="button">确认恢复</button><button class="btn" id="cancel-daily-import" type="button">取消</button>`;
      $('#daily-import-preview').hidden = false;
    } catch (error) { if (token === importNumber) feedback(`备份未导入：${error.message}`,true); }
  };
  const storageChanged = event => { if (event.key === DAILY_KEY || event.key === null) { try { reload('另一页面的衣橱资料已更新，未提交的表单内容仍保留'); } catch (error) { corrupt = true; feedback(error.message,true); } } };
  container.addEventListener('change', onChange); container.addEventListener('click', onClick); container.addEventListener('submit', onSubmit);
  $('#import-daily-file').addEventListener('change', importFile); window.addEventListener('storage', storageChanged);
  const wearLog=mountWearLog($('#wardrobe-wear'),{getData:()=>data,getDate:()=>localDate(new Date()),onSaved:reload,guard});
  const onInput=event=>{if(event.target.id==='outfit-ai-preference'){preferenceDirty=true;event.target.setAttribute('data-preserve-draft','');}};
  container.addEventListener('input',onInput);
  const routineRefresh=()=>{
    lastDay=localDate(new Date());
    const nextDryDate=nextDate(lastDay,data.profile.dryAfterDays);
    if($('#dry-expected-date').value===automaticDryDate)$('#dry-expected-date').value=nextDryDate;
    automaticDryDate=nextDryDate;
    syncDate();refreshLists();updateWeather();
  };
  document.addEventListener('app:refresh-wardrobe',routineRefresh);
  const tick=()=>{
    if(document.visibilityState==='hidden'||disposed)return;
    const day=localDate(new Date()),minute=Math.floor(Date.now()/60000);
    // The app's editor gate applies the midnight refresh after drafts are settled.
    if(day!==lastDay)return;
    if(minute!==lastMinute){lastMinute=minute;weatherChanged();}
    if(Date.now()-lastWeatherAttempt>=(weatherMessage?60000:30*60000))updateWeather();
  };
  const focusOut=()=>queueMicrotask(()=>{if(weatherPending&&canRefreshWeatherUI())weatherChanged();});
  container.addEventListener('focusout',focusOut);
  document.addEventListener('app:tick',tick);
  window.addEventListener('weather:changed',weatherChanged);
  if(!data.garments.some(item=>!item.deletedAt)&&!corrupt)wardrobeView.panel='closet';
  refreshLists(); updateWeather();
  return () => { disposed=true;document.removeEventListener('app:tick',tick);container.removeEventListener('focusout',focusOut);document.removeEventListener('app:refresh-wardrobe',routineRefresh);container.removeEventListener('input',onInput);clearTimeout(feedbackTimer);wearLog.cleanup();weatherSerial++;window.removeEventListener('weather:changed',weatherChanged);importNumber++; $('#garment-edit-dialog')?.close(); container.removeEventListener('change', onChange); container.removeEventListener('click', onClick); container.removeEventListener('submit', onSubmit); $('#import-daily-file')?.removeEventListener('change', importFile); window.removeEventListener('storage', storageChanged); };
}
