import { CATEGORIES, COLORS, CLOTHING_STATES, DEFAULT_PROFILE, DAILY_KEY, readDailyData, rawDailyData, emptyDailyData,
  validateDailyData, addGarments, editGarment, changeGarmentState, setArchived, saveOutfit, saveRunPlan, saveDailyProfile, mergeDailyBackup } from './daily-store.js?v=20261021-1';
import { localDate, nextDate, outfitRecommendation, runningSuitable } from './daily-model.js?v=20261021-1';
import { escapeText as esc, validDate } from './tasks-store.js?v=20261021-1';

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
    <div class="wardrobe-fields">${numberField('每分钟最多换几句（1—10）', 'refreshPerMinute', profile.refreshPerMinute, 10)}${textField('天气地区（先记录偏好）', 'city', profile.city, '城市或区县')}</div>
    <details><summary>出行与早餐</summary><p class="daily-muted">填写常用路线后，遇到对应教室会提示准备出发；预算可以随时调整。</p>
      <div class="wardrobe-fields">${textField('常用出发区域', 'baseArea', profile.baseArea)}${textField('需要提前去的教学楼关键词', 'destinationKeyword', profile.destinationKeyword)}${textField('该教学楼所在区域', 'destinationArea', profile.destinationArea)}${numberField('跨区到课预留（分钟，0表示未设置）', 'travelMinutes', profile.travelMinutes)}</div>
      <label>早餐安排<select name="breakfastMode">${optionHTML({ unknown: '暂未设置', onway: '买好后在路上吃', sit: '坐下吃完再走', prepared: '出门前已备好' }, profile.breakfastMode)}</select></label>
      <div class="wardrobe-fields">${numberField('买早餐与排队额外留几分钟', 'breakfastBuyMinutes', profile.breakfastBuyMinutes)}${numberField('坐下用餐时间（分钟）', 'breakfastEatMinutes', profile.breakfastEatMinutes)}</div>
      <p class="daily-small">路上吃可与通勤重合，购餐等待仍另计；0表示未计入该项，不代表不需要时间。</p></details>
    <details><summary>运动与洗晒习惯</summary><label class="daily-check-row"><input type="checkbox" name="peNeedsShorts"${profile.peNeedsShorts ? ' checked' : ''}> 我的体育课需要短裤</label>
      <div class="wardrobe-fields">${numberField('通常攒几天一起洗（0表示不提示间隔）', 'laundryEveryDays', profile.laundryEveryDays, 30)}${numberField('晾晒后预计几天收衣', 'dryAfterDays', profile.dryAfterDays, 14)}</div>
      <p class="daily-small">收衣日只是预计，不会自动把晾晒中的衣服标为可穿。衣物是否继续穿，由你调整。</p></details>
    <button type="submit" class="btn btn-primary">保存生活偏好</button></form>`;
}

export function renderWardrobe(container, state, dm) {
  let data;
  let corrupt = false;
  let initialError = '';
  try { data = readDailyData(); } catch (error) { data = emptyDailyData(); corrupt = true; initialError = error.message; }
  let selectedDate = nextDate(localDate(new Date()));
  let incoming = null;
  let importNumber = 0;
  let rawDownloaded = false;

  container.innerHTML = `<div class="wardrobe-page"><header class="wardrobe-header"><div><h1>小衣橱与明日准备</h1><p>记几件常穿衣服，少一点临时纠结。</p></div><a href="#/today" class="daily-link">回到今日 →</a></header>
    <p class="daily-local-note">衣物、搭配和生活偏好仅保存在本浏览器。换设备前可在下方下载备份。</p>
    <p id="wardrobe-feedback" class="daily-feedback" role="status">${esc(initialError)}</p>
    <div class="wardrobe-layout"><div class="wardrobe-main-column">
      <section class="wardrobe-card" id="wardrobe-plan"><div class="daily-heading"><h2>这天怎么穿</h2><span class="daily-tag">按活动与可穿状态</span></div>
        <form id="run-plan-form"><div class="wardrobe-plan-controls"><label>查看日期<input id="outfit-date" type="date" value="${selectedDate}" min="2000-01-01" max="2100-12-31" required></label><label class="daily-check-row"><input id="plan-run" type="checkbox"> 这天打算校园跑</label><button class="btn" type="submit">保存跑步安排</button></div></form>
        <div id="wardrobe-recommendation"></div></section>
      <section class="wardrobe-card"><div class="daily-heading"><h2>我的衣物</h2><select id="garment-filter" aria-label="筛选衣物状态">${optionHTML({ all: '全部状态', ...CLOTHING_STATES }, 'all')}</select></div>
        <div class="wardrobe-laundry"><div class="daily-heading"><label class="daily-check-row"><input id="select-all-garments" type="checkbox"> 选择当前列表</label><span id="garment-selection-count" class="daily-small">未选择</span></div>
          <div class="wardrobe-bulk-actions"><button class="btn" data-bulk-state="dirty" type="button">移到待洗</button><button class="btn" data-bulk-state="washing" type="button">开始洗</button><button class="btn" data-bulk-state="drying" type="button">已经晾晒</button><button class="btn" data-bulk-state="ready" type="button">收好可穿</button></div>
          <label class="wardrobe-dry-date">预计收衣日（仅用于晾晒提示）<input id="dry-expected-date" type="date" min="2000-01-01" max="2100-12-31" value="${nextDate(localDate(new Date()), data.profile.dryAfterDays)}"></label></div>
        <div id="garment-list"></div></section>
      <section class="wardrobe-card"><h2>常用搭配</h2><p class="daily-muted">点选上衣和下装，再加外套、鞋或腰带，就能连成一套。</p>
        <div id="outfit-list"></div><details id="outfit-builder"><summary>连接一套常用搭配</summary><form id="outfit-form"><label>搭配名称<input name="outfitName" maxlength="120" required placeholder="给这套搭配起个名字"></label><div id="outfit-picker"></div><p class="daily-small">每套一件上衣、一件下装；外套、鞋和腰带各选至多一件。待洗衣物也能保存关系，推荐时会核对可穿状态。</p><button class="btn btn-primary" type="submit">保存这套搭配</button></form></details></section>
      <details class="wardrobe-card" id="wardrobe-archive"><summary>已收起的衣物与搭配</summary><div id="wardrobe-archive-list"></div></details>
    </div><aside class="wardrobe-side-column">
      <details class="wardrobe-card" id="add-garments"${!data.garments.length && !corrupt ? ' open' : ''}><summary>录几件常穿衣服</summary><form id="add-garments-form"><fieldset><legend>勾选你拥有的类别</legend><div class="wardrobe-category-choices">${Object.entries(CATEGORIES).map(([key, category]) => `<label><input type="checkbox" name="category" value="${key}"> ${category.label}</label>`).join('')}</div></fieldset><div id="add-garment-panels"></div><button type="submit" class="btn btn-primary">加入衣橱</button></form></details>
      <details class="wardrobe-card" id="daily-preferences"><summary>生活偏好与换句设置</summary>${profileForm(data.profile)}</details>
      <details class="wardrobe-card" id="daily-backup"><summary>备份与恢复</summary><p class="daily-muted">备份包含本机衣物、常用搭配、跑步安排和生活偏好。个人事项仍使用待办页的独立备份。</p>
        <div class="wardrobe-bulk-actions"><button class="btn" id="download-daily-backup" type="button">下载备份</button><button class="btn" id="download-daily-raw" type="button">下载原始文件</button></div>
        <label>选择日常助手备份<input type="file" id="import-daily-file" accept=".json,application/json"></label><div id="daily-import-preview" hidden></div></details>
    </aside></div>
    <dialog id="garment-edit-dialog" class="capture-dialog" aria-labelledby="garment-edit-title"><form id="garment-edit-form"><div class="capture-heading"><h2 id="garment-edit-title">调整这件衣服</h2><button type="button" class="capture-close" aria-label="关闭衣物编辑">×</button></div>
      <label>衣物名称<input name="name" required maxlength="120"></label><label>颜色<select name="color">${optionHTML(COLORS, 'unknown')}</select></label>
      <label>腰带要求<select name="needsBelt">${optionHTML({ unknown: '暂未确定', yes: '需要腰带', optional: '可选', no: '不需要' }, 'unknown')}</select></label>
      <label>跑步适配<select name="running">${optionHTML({ auto: '按类别提供默认建议', yes: '这件适合我跑步', no: '这件不适合跑步' }, 'auto')}</select></label>
      <label>厚薄<select name="warmth">${optionHTML({ light: '偏薄', medium: '中等', warm: '偏厚 / 加绒' }, 'medium')}</select></label>
      <p class="daily-small">默认优先运动裤；硬挺、紧窄或影响活动的裤子可换装。厚薄先保留为标签，当前搭配未接入天气。</p><p class="daily-error" id="garment-edit-error" role="alert"></p><button class="btn btn-primary" type="submit">保存修改</button></form></dialog></div>`;

  const $ = selector => container.querySelector(selector);
  const feedback = message => { $('#wardrobe-feedback').textContent = message; };
  function guard() { if (corrupt) throw new Error('原资料无法读取，请先保留原始文件，再到备份与恢复中处理'); }
  function selectedIds() { return [...container.querySelectorAll('[data-garment-select]:checked')].map(input => input.value); }
  function selectedCount() {
    const rows = [...container.querySelectorAll('[data-garment-select]')];
    const count = selectedIds().length;
    $('#garment-selection-count').textContent = count ? `已选 ${count} 件` : '未选择';
    $('#select-all-garments').checked = Boolean(rows.length && count === rows.length);
    $('#select-all-garments').indeterminate = count > 0 && count < rows.length;
  }
  function refreshRecommendation() {
    const courses = dm.getCoursesByDate(state.currentClass, selectedDate);
    const future = dm.getCourses(state.currentClass).filter(course => course.date > selectedDate && course.date <= nextDate(selectedDate, 2));
    const fit = outfitRecommendation(data, selectedDate, courses, future);
    $('#plan-run').checked = data.plans.some(plan => plan.date === selectedDate && plan.run);
    $('#wardrobe-recommendation').innerHTML = `<p class="daily-muted">${courses.length ? `${courses.length} 次课` : '课表上无课'}${fit.pe ? ` · 体育课${fit.requireShorts ? '需短裤' : ''}` : ''}${fit.run ? ' · 已安排校园跑' : ''}</p>
      ${data.garments.some(item => !item.deletedAt) ? fit.missing.map(message => `<p class="wardrobe-warning">${esc(message)}</p>`).join('') : '<p class="daily-muted">先录入几件上衣和裤子，就能参考你的活动与洗晒状态选搭配。</p>'}
      ${fit.sets.map((set, index) => `<article class="wardrobe-suggestion"><h3>${index ? '另一套选择' : '可以考虑这套'}</h3>${chainHTML(set.pieces)}<ul>${set.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul></article>`).join('')}
      ${!data.garments.some(item => !item.deletedAt) ? '<a href="#/wardrobe" class="daily-link" data-open-add>先录几件常穿衣服 →</a>' : ''}
      ${fit.futureShortDays && data.profile.peNeedsShorts ? `<p class="daily-small">随后两天有${fit.futureShortDays}天体育课，目前确认可穿且适合运动的短裤${fit.readyShorts}条，记得结合洗晒安排轮换。</p>` : ''}
      <p class="daily-small">${fit.notes.map(esc).join(' ')}</p>`;
  }
  function chainHTML(pieces) {
    return `<div class="outfit-chain">${pieces.map((item, index) => `${index ? '<span class="outfit-chain-link" aria-hidden="true"></span>' : ''}<span class="outfit-piece">${esc(item.name)}</span>`).join('')}</div>`;
  }
  function refreshLists() {
    const kept = new Set(selectedIds());
    const filter = $('#garment-filter').value;
    const garments = data.garments.filter(item => !item.deletedAt && (filter === 'all' || item.state === filter));
    $('#garment-list').innerHTML = garments.length ? garments.map(item => `<article class="garment-row"><label class="garment-choice"><input type="checkbox" data-garment-select value="${esc(item.id)}"${kept.has(item.id) ? ' checked' : ''}><span><strong>${esc(item.name)}</strong><span class="daily-small">${CATEGORIES[item.category].label} · ${COLORS[item.color]}</span></span></label>
      <div class="garment-details"><span class="garment-state state-${item.state}">${CLOTHING_STATES[item.state]}</span>${item.needsBelt === 'yes' ? '<span class="daily-small">需腰带</span>' : ''}${CATEGORIES[item.category].group === 'bottom' ? `<span class="daily-small">${runningSuitable(item) ? '运动候选' : '跑步时优先换装'}</span>` : ''}${item.state === 'drying' ? `<span class="daily-small">${item.expectedDate ? `预计 ${item.expectedDate.slice(5)} 收衣，待确认干透` : '未设预计收衣日，待确认干透'}</span>` : ''}</div>
      <div class="garment-actions"><label>状态<select data-item-state="${esc(item.id)}">${optionHTML(CLOTHING_STATES, item.state)}</select></label><button type="button" class="daily-text-button" data-edit-garment="${esc(item.id)}">调整</button><button type="button" class="daily-text-button" data-archive-garment="${esc(item.id)}">收起</button></div></article>`).join('') : '<p class="daily-muted">这个列表还没有衣物，可以先勾选类别录入。</p>';
    selectedCount();
    const picked = new Set([...container.querySelectorAll('[name=outfitGarment]:checked')].map(input => input.value));
    const active = data.garments.filter(item => !item.deletedAt);
    const groups = { top: '上衣', bottom: '下装', layer: '外套（可选）', shoes: '鞋（可选）', accessory: '腰带（可选）' };
    $('#outfit-picker').innerHTML = Object.entries(groups).map(([group, label]) => `<fieldset><legend>${label}</legend><div class="outfit-picker-group">${active.filter(item => CATEGORIES[item.category].group === group).map(item => `<label><input type="checkbox" name="outfitGarment" data-group="${group}" value="${esc(item.id)}"${picked.has(item.id) ? ' checked' : ''}> ${esc(item.name)}<span class="daily-small">${CLOTHING_STATES[item.state]}</span></label>`).join('') || '<span class="daily-small">还没有录入</span>'}</div></fieldset>`).join('');
    $('#outfit-list').innerHTML = data.outfits.filter(item => !item.deletedAt).map(outfit => {
      const pieces = outfit.garmentIds.map(id => data.garments.find(item => item.id === id));
      const ready = pieces.every(item => !item.deletedAt && item.state === 'ready');
      return `<article class="saved-outfit"><div class="daily-heading"><h3>${esc(outfit.name)}</h3><button type="button" class="daily-text-button" data-archive-outfit="${esc(outfit.id)}">收起</button></div>${chainHTML(pieces)}<p class="daily-small">${ready ? '这套单品目前都已确认可穿' : '部分单品待洗、晾晒或已收起，推荐时会避开'}</p></article>`;
    }).join('') || '<p class="daily-muted">常搭的衣服连起来，以后会优先参考。</p>';
    $('#wardrobe-archive-list').innerHTML = [
      ...data.garments.filter(item => item.deletedAt).map(item => `<div class="archive-row"><span>${esc(item.name)}</span><button class="btn" type="button" data-restore-garment="${esc(item.id)}">恢复衣物</button></div>`),
      ...data.outfits.filter(item => item.deletedAt).map(item => `<div class="archive-row"><span>${esc(item.name)}</span><button class="btn" type="button" data-restore-outfit="${esc(item.id)}">恢复搭配</button></div>`),
    ].join('') || '<p class="daily-muted">没有已收起的记录。</p>';
    refreshRecommendation();
  }
  function reload(message = '') {
    const focused = document.activeElement;
    const focusId = focused?.dataset.itemState || focused?.dataset.editGarment;
    data = readDailyData(); corrupt = false; refreshLists(); if (message) feedback(message);
    if (focusId) [...container.querySelectorAll('[data-item-state]')].find(input => input.dataset.itemState === focusId)?.focus({ preventScroll: true });
  }
  function addPanel(category) {
    const group = CATEGORIES[category].group;
    return `<fieldset data-add-category="${category}"><legend>${CATEGORIES[category].label}</legend><div class="wardrobe-fields"><label>颜色<select name="${category}-color">${optionHTML(COLORS, 'unknown')}</select></label><label>数量（鞋按双）<input name="${category}-quantity" type="number" min="1" max="10" value="1" required></label><label>当前状态<select name="${category}-state">${optionHTML(CLOTHING_STATES, 'ready')}</select></label>${group === 'bottom' ? `<label>腰带要求<select name="${category}-belt">${optionHTML({ unknown: '暂未确定', yes: '需要腰带', optional: '可选', no: '不需要' }, 'unknown')}</select></label>` : ''}</div><label>备注名称（可选）<input name="${category}-name" maxlength="100" placeholder="留空会按类别和颜色命名"></label></fieldset>`;
  }

  const onChange = event => {
    const target = event.target;
    try {
      if (target.name === 'category') {
        const panel = container.querySelector(`[data-add-category="${target.value}"]`);
        if (target.checked && !panel) $('#add-garment-panels').insertAdjacentHTML('beforeend', addPanel(target.value));
        else if (!target.checked) panel?.remove();
      } else if (target.id === 'garment-filter') refreshLists();
      else if (target.id === 'select-all-garments') {
        container.querySelectorAll('[data-garment-select]').forEach(input => input.checked = target.checked); selectedCount();
      } else if (target.matches('[data-garment-select]')) selectedCount();
      else if (target.name === 'outfitGarment' && target.checked) container.querySelectorAll(`[name=outfitGarment][data-group="${target.dataset.group}"]`).forEach(input => { if (input !== target) input.checked = false; });
      else if (target.id === 'outfit-date') {
        if (!validDate(target.value)) throw new Error('请选择有效日期'); selectedDate = target.value; refreshRecommendation();
      } else if (target.matches('[data-item-state]')) {
        guard(); changeGarmentState([target.dataset.itemState], target.value, $('#dry-expected-date').value); reload('衣物状态已更新');
      }
    } catch (error) {
      if (target.dataset.itemState) target.value = data.garments.find(item => item.id === target.dataset.itemState)?.state || 'ready';
      feedback(error.message);
    }
  };
  const onClick = event => {
    const button = event.target.closest('button, [data-open-add]');
    if (!button || !container.contains(button)) return;
    try {
      if (button.matches('[data-open-add]')) { event.preventDefault(); $('#add-garments').open = true; $('#add-garments').scrollIntoView({ behavior: 'smooth' }); }
      else if (button.dataset.bulkState) { guard(); changeGarmentState(selectedIds(), button.dataset.bulkState, $('#dry-expected-date').value); reload('所选衣物状态已更新'); }
      else if (button.dataset.editGarment) {
        guard(); const item = data.garments.find(item => item.id === button.dataset.editGarment);
        const form = $('#garment-edit-form'); form.dataset.id = item.id;
        for (const key of ['name', 'color', 'needsBelt', 'running', 'warmth']) form.elements[key].value = item[key];
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
    } catch (error) { feedback(error.message); }
  };
  const onSubmit = event => {
    const form = event.target;
    if (!form.matches('form')) return;
    event.preventDefault();
    try {
      guard();
      if (form.id === 'add-garments-form') {
        const fields = new FormData(form);
        const groups = fields.getAll('category').map(category => ({ category, color: fields.get(`${category}-color`), quantity: Number(fields.get(`${category}-quantity`)), state: fields.get(`${category}-state`), needsBelt: fields.get(`${category}-belt`) || 'no', name: fields.get(`${category}-name`) }));
        const count = addGarments(groups); form.reset(); $('#add-garment-panels').innerHTML = ''; reload(`已加入${count}件衣物，同款也分别计数`);
      } else if (form.id === 'outfit-form') {
        saveOutfit(form.elements.outfitName.value, new FormData(form).getAll('outfitGarment')); form.reset(); reload('常用搭配已连接好');
      } else if (form.id === 'run-plan-form') {
        saveRunPlan(selectedDate, $('#plan-run').checked); reload('这天的跑步安排已保存');
      } else if (form.id === 'daily-profile-form') {
        const fields = new FormData(form); const values = {};
        for (const key of Object.keys(DEFAULT_PROFILE)) {
          if (key === 'updatedAt') continue;
          values[key] = typeof DEFAULT_PROFILE[key] === 'boolean' ? fields.has(key) : typeof DEFAULT_PROFILE[key] === 'number' ? Number(fields.get(key)) : fields.get(key);
        }
        saveDailyProfile(values); reload('生活偏好已保存在本浏览器');
        $('#dry-expected-date').value = nextDate(localDate(new Date()), data.profile.dryAfterDays);
      } else if (form.id === 'garment-edit-form') {
        editGarment(form.dataset.id, Object.fromEntries(new FormData(form))); $('#garment-edit-dialog').close(); reload('这件衣物已更新');
      }
    } catch (error) {
      if (form.id === 'garment-edit-form') $('#garment-edit-error').textContent = error.message;
      else feedback(error.message);
    }
  };
  const importFile = async event => {
    const file = event.target.files[0]; const token = ++importNumber;
    incoming = null; $('#daily-import-preview').hidden = true;
    if (!file) return;
    try {
      if (file.size > 3 * 1024 * 1024) throw new Error('备份超过3MB，请检查文件');
      const parsed = validateDailyData(JSON.parse(await file.text()));
      if (token !== importNumber) return;
      incoming = parsed;
      $('#daily-import-preview').innerHTML = `<p>已检查：${parsed.garments.length}件衣物、${parsed.outfits.length}套搭配、${parsed.plans.length}条跑步安排。${corrupt ? '本机资料损坏，确认后将用此备份替换。' : '确认后合并，旧备份不会覆盖较新的修改。'}</p>${corrupt ? '<label class="daily-check-row"><input id="replace-unreadable-check" type="checkbox"> 我已下载并保留原始资料，确认替换无法读取的内容</label>' : ''}<button class="btn btn-primary" id="confirm-daily-import" type="button">确认恢复</button>`;
      $('#daily-import-preview').hidden = false;
    } catch (error) { if (token === importNumber) feedback(`备份未导入：${error.message}`); }
  };
  const storageChanged = event => { if (event.key === DAILY_KEY || event.key === null) { try { reload('另一页面的衣橱资料已更新，未提交的表单内容仍保留'); } catch (error) { corrupt = true; feedback(error.message); } } };
  container.addEventListener('change', onChange); container.addEventListener('click', onClick); container.addEventListener('submit', onSubmit);
  $('#import-daily-file').addEventListener('change', importFile); window.addEventListener('storage', storageChanged);
  refreshLists();
  return () => { importNumber++; $('#garment-edit-dialog')?.close(); container.removeEventListener('change', onChange); container.removeEventListener('click', onClick); container.removeEventListener('submit', onSubmit); $('#import-daily-file')?.removeEventListener('change', importFile); window.removeEventListener('storage', storageChanged); };
}
