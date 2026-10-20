import { KINDS, SOURCES, escapeText as esc, readItems, itemsForScope, saveItem, updateItemState, exportBackup, validateBackup, mergeBackup, dateLabel, isOverdue, sortItems } from './tasks-store.js?v=20261020-9';
import { getTodayStr } from './time.js?v=20261020-9';

let context = null;
let editingId = '';
let activeTab = 'open';
let search = '';
let courseFilter = '';
let notice = '';

function scope(state, dm) { return { semester: dm.getSemesterInfo().semester, className: state.currentClass }; }
function notify(message) {
  const target = document.getElementById('personal-feedback');
  target.textContent = message;
  target.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { target.hidden = true; }, 4500);
}

export function setupPersonalItems(state, dm, rerender, closeCourse) {
  context = { state, dm, rerender, closeCourse };
  const root = document.createElement('div');
  root.innerHTML = `
    <button type="button" class="quick-capture btn btn-primary" id="quick-capture"><span aria-hidden="true">＋</span> 记一下</button>
    <div id="personal-feedback" class="personal-feedback" role="status" aria-live="polite" hidden></div>
    <dialog id="capture-dialog" class="capture-dialog" aria-labelledby="capture-title">
      <form id="capture-form">
        <div class="capture-heading"><div><h2 id="capture-title">记一下</h2><p>先记住一句话，其他信息可以以后补。</p></div><button type="button" class="capture-close" aria-label="关闭记录">×</button></div>
        <label for="capture-text">要记住什么 <span class="capture-required">必填</span></label>
        <textarea id="capture-text" name="text" rows="4" maxlength="5000" required placeholder="例如：英语演讲稿下周交，具体日期再确认"></textarea>
        <label for="capture-course">关联课程</label><select id="capture-course" name="courseName"></select>
        <details id="capture-extra"><summary>补充日期、类别或来源 <span>可选</span></summary>
          <div class="capture-fields">
            <label>类别<select id="capture-kind" name="kind">${Object.entries(KINDS).map(([key, value]) => `<option value="${key}">${value}</option>`).join('')}</select></label>
            <label>来源<select id="capture-source" name="source">${Object.entries(SOURCES).map(([key, value]) => `<option value="${key}">${value}</option>`).join('')}</select></label>
            <label>日期（截止或要记得的日期）<input type="date" id="capture-date" name="dueDate" min="2000-01-01" max="2100-12-31"></label>
            <label>具体时间<input type="time" id="capture-time" name="dueTime"></label>
          </div>
          <label class="capture-check"><input type="checkbox" id="capture-confirm" name="needsConfirmation"> 这条通知还需要核对</label>
          <label for="capture-next">容易开始的下一步</label><input type="text" id="capture-next" name="nextStep" maxlength="1000" placeholder="例如：先打开老师发的作业要求">
        </details>
        <p class="capture-hint">原话会完整保留。日期由你选择；没确定的通知可以先标为待确认。</p>
        <p id="capture-error" class="personal-error" role="alert"></p>
        <div class="capture-footer"><span>保存在本机浏览器</span><button type="submit" class="btn btn-primary">保存</button></div>
      </form>
    </dialog>`;
  document.body.append(root);
  const dialog = document.getElementById('capture-dialog');
  document.getElementById('quick-capture').addEventListener('click', () => openCapture());
  root.querySelector('.capture-close').addEventListener('click', () => dialog.close());
  document.getElementById('capture-date').addEventListener('change', event => {
    document.getElementById('capture-time').disabled = !event.target.value;
    if (!event.target.value) document.getElementById('capture-time').value = '';
    document.getElementById('capture-confirm').checked = !event.target.value;
  });
  document.getElementById('capture-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      saveItem({
        ...dialog.captureScope,
        text: form.get('text').trim(), courseName: form.get('courseName'),
        kind: form.get('kind'), source: form.get('source'), dueDate: form.get('dueDate'), dueTime: form.get('dueTime') || '',
        needsConfirmation: form.has('needsConfirmation'), nextStep: form.get('nextStep').trim(),
      }, editingId);
      dialog.close();
      rerender();
      notify(editingId ? '已保存修改' : '已记下，查课表时也能看到');
    } catch (error) { document.getElementById('capture-error').textContent = error.message; }
  });
  window.addEventListener('storage', event => {
    if (event.key === 'course-dashboard-personal-items-v1' || event.key === null) rerender();
  });
}

export function openCapture({ courseName = '', item = null } = {}) {
  if (!context) return;
  const { state, dm, closeCourse } = context;
  closeCourse();
  const dialog = document.getElementById('capture-dialog');
  const form = document.getElementById('capture-form');
  form.reset();
  editingId = item?.id || '';
  dialog.captureScope = item ? { semester: item.semester, className: item.className } : scope(state, dm);
  const names = [...new Set(dm.getCourses(dialog.captureScope.className).map(course => course.courseName))];
  const now = new Date();
  const current = dm.getTodayCourses(dialog.captureScope.className).find(course => course.startDateTime <= now && course.endDateTime > now);
  const selected = item ? item.courseName : (courseName || current?.courseName || '');
  if (selected && !names.includes(selected)) names.push(selected);
  const select = document.getElementById('capture-course');
  select.innerHTML = `<option value="">先不关联课程</option>${names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}`;
  select.value = selected;
  document.getElementById('capture-title').textContent = item ? '补充这条事项' : '记一下';
  document.getElementById('capture-text').value = item?.text || '';
  document.getElementById('capture-kind').value = item?.kind || 'task';
  document.getElementById('capture-source').value = item?.source || (selected ? 'oral' : 'other');
  document.getElementById('capture-date').value = item?.dueDate || '';
  document.getElementById('capture-time').value = item?.dueTime || '';
  document.getElementById('capture-time').disabled = !item?.dueDate;
  document.getElementById('capture-confirm').checked = item ? item.needsConfirmation : true;
  document.getElementById('capture-next').value = item?.nextStep || '';
  document.getElementById('capture-error').textContent = '';
  document.getElementById('capture-extra').open = !!item;
  dialog.showModal();
  document.getElementById('capture-text').focus();
}

function itemCard(item, today, compact = false) {
  const overdue = isOverdue(item, today);
  return `<article class="personal-item ${item.completedAt ? 'is-complete' : ''}" data-personal-id="${esc(item.id)}">
    <div class="personal-item-main">
      <div class="personal-tags"><span>${esc(KINDS[item.kind])}</span>${item.courseName ? `<span>${esc(item.courseName)}</span>` : ''}</div>
      <p class="personal-text">${esc(item.text)}</p>
      <div class="personal-meta"><span class="${overdue ? 'is-overdue' : ''}">${overdue ? '已过所设时间 · ' : ''}${esc(dateLabel(item, today))}</span>${item.needsConfirmation && item.dueDate ? '<span>通知待核对</span>' : ''}<span>${esc(SOURCES[item.source])}</span></div>
      ${item.nextStep ? `<p class="personal-next">下一步：${esc(item.nextStep)}</p>` : ''}
    </div>
    <div class="personal-item-actions">
      ${item.deletedAt ? `<button type="button" data-item-action="restore">恢复</button>` : `
      <button type="button" data-item-action="${item.completedAt ? 'reopen' : 'complete'}">${item.completedAt ? '撤销完成' : '完成'}</button>
      <button type="button" data-item-action="edit">补充</button>
      ${compact ? '' : '<button type="button" data-item-action="trash">移入回收站</button>'}`}
    </div>
  </article>`;
}

function attachItemActions(container, refresh) {
  container.addEventListener('click', event => {
    const button = event.target.closest('[data-item-action]');
    if (!button || !container.contains(button)) return;
    const id = button.closest('[data-personal-id]').dataset.personalId;
    try {
      if (button.dataset.itemAction === 'edit') {
        const item = readItems().find(row => row.id === id);
        if (!item) throw new Error('这条事项已不存在，请刷新后重试');
        openCapture({ item });
      } else {
        updateItemState(id, button.dataset.itemAction);
        refresh();
        notify({ complete: '已完成，可在待办页撤销', reopen: '已恢复为未完成', trash: '已移入回收站，可以恢复', restore: '已恢复事项' }[button.dataset.itemAction]);
      }
    } catch (error) { notify(error.message); }
  });
}

export function mountTodayItems(container, state, dm) {
  const block = document.createElement('section');
  block.className = 'personal-today';
  const slot = container.querySelector('#dash-personal-slot');
  const timeline = container.querySelector('.today-timeline-section, .today-empty-section');
  if (slot) slot.append(block);
  else container.insertBefore(block, timeline);
  let items;
  try { items = sortItems(itemsForScope(scope(state, dm)).filter(item => !item.completedAt && !item.deletedAt)); }
  catch (error) { block.innerHTML = `<h2>今天要记得</h2><p class="personal-error">${esc(error.message)}</p><a class="btn" href="#/tasks">检查个人事项</a>`; return; }
  const today = getTodayStr();
  const todayCourses = new Set(dm.getTodayCourses(state.currentClass).map(course => course.courseName));
  const important = items.filter(item => (item.dueDate && item.dueDate <= today) || item.needsConfirmation || (todayCourses.has(item.courseName) && !item.dueDate));
  const tomorrow = new Date(`${today}T00:00:00`); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const rank = item => !item.needsConfirmation && item.dueDate && item.dueDate <= today ? 0 : !item.needsConfirmation && item.dueDate === tomorrowStr ? 1 : important.includes(item) ? 2 : 3;
  const shown = [...items].sort((a, b) => rank(a) - rank(b)).slice(0, 2);
  block.innerHTML = `<div class="personal-section-heading"><h2>要记得</h2><button type="button" class="btn btn-primary" data-today-capture>＋ 记一句</button></div>
    ${shown.length ? shown.map(item => `<article class="personal-item home-personal-item" data-personal-id="${esc(item.id)}"><button type="button" class="home-personal-open" data-item-action="edit" aria-label="查看并补充：${esc(item.text)}"><span class="personal-text">${esc(item.text)}</span><span class="personal-meta${isOverdue(item, today) ? ' is-overdue' : ''}">${isOverdue(item, today) ? '已过所设时间 · ' : ''}${esc(dateLabel(item, today))}${item.needsConfirmation && item.dueDate ? ' · 通知待核对' : ''}${item.courseName ? ` · ${esc(item.courseName)}` : ''}</span></button><button type="button" class="home-personal-complete" data-item-action="complete" aria-label="完成：${esc(item.text)}">完成</button></article>`).join('') : '<p class="personal-muted personal-home-empty">还没有记录的事项，先记一句就好。</p>'}
    ${items.length ? `<a class="personal-view-all" href="#/tasks">全部${items.length}条未完成事项 →</a>` : ''}`;
  block.querySelector('[data-today-capture]')?.addEventListener('click', () => openCapture());
  attachItemActions(block, () => context.rerender());
}

export function mountCourseItems(container, course) {
  const section = document.createElement('section');
  section.className = 'course-personal';
  let items = [];
  let error = '';
  try { items = sortItems(itemsForScope({ semester: context.dm.getSemesterInfo().semester, className: course.className }).filter(item => item.courseName === course.courseName && !item.completedAt && !item.deletedAt)); }
  catch (err) { error = err.message; }
  section.innerHTML = `<div class="personal-section-heading"><h3>这门课要记得</h3><button type="button" class="btn" data-course-capture>＋ 记一下</button></div>
    ${error ? `<p class="personal-error">${esc(error)}</p>` : items.length ? items.map(item => itemCard(item, getTodayStr(), true)).join('') : '<p class="personal-muted">老师交代的作业、下次要带的东西，可以直接记在这里。</p>'}`;
  container.querySelector('.detail-body').append(section);
  section.querySelector('[data-course-capture]').addEventListener('click', () => openCapture({ courseName: course.courseName }));
  attachItemActions(section, () => { section.remove(); mountCourseItems(container, course); context.rerender(); });
}

export function renderTasks(container, state, dm) {
  const currentScope = scope(state, dm);
  let all;
  try { all = itemsForScope(currentScope); }
  catch (error) {
    container.innerHTML = `<section class="card personal-page"><h1>个人事项</h1><p class="personal-error">${esc(error.message)}</p><button type="button" class="btn" id="personal-raw-export">导出原始数据</button></section>`;
    container.querySelector('#personal-raw-export').addEventListener('click', () => { try { exportBackup(true); } catch (err) { notify(err.message); } });
    return;
  }
  const today = getTodayStr();
  const courses = [...new Set(all.map(item => item.courseName).filter(Boolean))].sort();
  if (courseFilter && !courses.includes(courseFilter)) courseFilter = '';
  const counts = { open: all.filter(item => !item.completedAt && !item.deletedAt).length, done: all.filter(item => item.completedAt && !item.deletedAt).length, trash: all.filter(item => item.deletedAt).length };
  container.innerHTML = `<div class="personal-page">
    <div class="personal-page-heading"><div><h1>个人事项</h1><p>先记一句，稍后补充</p></div><button type="button" class="btn btn-primary" id="personal-add">＋ 记一下</button></div>
    <div class="personal-tabs" role="group" aria-label="事项状态">${[['open', '未完成'], ['done', '已完成'], ['trash', '回收站']].map(([key, label]) => `<button type="button" data-personal-tab="${key}" aria-pressed="${activeTab === key}" class="${activeTab === key ? 'active' : ''}">${label} <span>${counts[key]}</span></button>`).join('')}</div>
    <div class="personal-filters"><label>搜索<input type="search" id="personal-search" placeholder="搜索通知原话或下一步" value="${esc(search)}"></label><label>课程<select id="personal-course-filter"><option value="">全部课程与未关联事项</option>${courses.map(name => `<option value="${esc(name)}" ${courseFilter === name ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label></div>
    <div id="personal-list"></div>
    <details class="personal-backup card"><summary>保存与备份</summary><p>个人事项保存在当前浏览器，刷新后仍在。本地预览与在线网站各自保存；云同步尚未启用。换设备前可以导出备份。</p><p>备份包含所有班级、学期的个人事项，也包含已完成和回收站中的记录。</p><div class="personal-backup-actions"><button type="button" class="btn" id="personal-export">导出备份</button><button type="button" class="btn" id="personal-import">恢复备份</button><input type="file" id="personal-import-file" accept=".json,application/json" hidden></div><div id="personal-import-preview" hidden></div><p id="personal-backup-message" role="status">${esc(notice)}</p></details>
  </div>`;
  function showList() {
    const filtered = sortItems(all.filter(item => (activeTab === 'trash' ? !!item.deletedAt : !item.deletedAt && (activeTab === 'done' ? !!item.completedAt : !item.completedAt)) &&
      (!courseFilter || item.courseName === courseFilter) && (!search || `${item.text} ${item.nextStep} ${item.courseName}`.toLowerCase().includes(search.toLowerCase()))));
    const list = container.querySelector('#personal-list');
    list.innerHTML = filtered.length ? filtered.map(item => itemCard(item, today)).join('') : `<div class="personal-empty"><h2>${search || courseFilter ? '没有找到匹配的事项' : activeTab === 'done' ? '完成的事情会留在这里' : activeTab === 'trash' ? '回收站是空的' : '先记住一件小事'}</h2><p>${activeTab === 'open' && !search && !courseFilter ? '只写一句话就能保存，日期和课程都可以以后补。' : '可以调整筛选，或到其他状态中查看。'}</p></div>`;
  }
  showList();
  attachItemActions(container.querySelector('#personal-list'), () => renderTasks(container, state, dm));
  container.querySelector('#personal-add').addEventListener('click', () => openCapture());
  container.querySelectorAll('[data-personal-tab]').forEach(button => button.addEventListener('click', () => { activeTab = button.dataset.personalTab; renderTasks(container, state, dm); }));
  container.querySelector('#personal-search').addEventListener('input', event => { search = event.target.value; showList(); });
  container.querySelector('#personal-course-filter').addEventListener('change', event => { courseFilter = event.target.value; showList(); });
  const backupMessage = container.querySelector('#personal-backup-message');
  container.querySelector('#personal-export').addEventListener('click', () => { try { exportBackup(); backupMessage.textContent = '已生成个人事项备份。'; } catch (error) { backupMessage.textContent = error.message; } });
  const file = container.querySelector('#personal-import-file');
  const preview = container.querySelector('#personal-import-preview');
  container.querySelector('#personal-import').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    preview.hidden = true;
    backupMessage.textContent = '';
    try {
      const selected = file.files?.[0];
      if (!selected) return;
      if (selected.size > 8 * 1024 * 1024) throw new Error('备份过大，请选择8MB以内的个人事项文件');
      const incoming = validateBackup(JSON.parse(await selected.text()));
      preview.innerHTML = `<p>读到 ${incoming.items.length} 条事项。将按编号合并；已有的较新修改会保留。</p><button type="button" class="btn btn-primary">确认合并恢复</button>`;
      preview.hidden = false;
      preview.querySelector('button').addEventListener('click', () => {
        try { const result = mergeBackup(incoming); notice = `恢复完成：新增 ${result.added} 条，更新 ${result.updated} 条。`; renderTasks(container, state, dm); notify(notice); }
        catch (error) { backupMessage.textContent = error.message; }
      });
    } catch (error) { backupMessage.textContent = error instanceof SyntaxError ? '文件不是有效的 JSON 备份，未改动本机数据。' : error.message; }
    finally { file.value = ''; }
  });
}
