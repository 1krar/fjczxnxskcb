import { aiEnabled, callAI } from './ai-client.js?v=20261021-2';
import { resolveNoticeItems } from './notice-model.js?v=20261021-2';
import { escapeText as esc } from './tasks-store.js?v=20261021-2';
import { saveActivity } from './agenda-store.js?v=20261021-2';

const clockInput = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
export function setupCaptureAI(dialog, dm, rerender, notify) {
  const text = dialog.querySelector('#capture-text');
  const panel = document.createElement('section'); panel.className = 'capture-ai';
  panel.innerHTML = `<div class="capture-ai-heading"><strong>通知识别</strong><button type="button" class="btn" data-parse-notice>识别这句话</button></div>
  <p class="daily-small" data-ai-capture-status></p><details><summary>通知的参考时间</summary><label>原通知发布或收到的时间<input type="datetime-local" data-notice-reference min="2000-01-01T00:00" max="2100-12-31T23:59"></label><p class="daily-small">“明天”“下周”“下次课”以此为准。粘贴旧群消息时可改为原消息时间。</p></details><div data-notice-results></div>`;
  text.after(panel);
  const reference = panel.querySelector('[data-notice-reference]'), status = panel.querySelector('[data-ai-capture-status]'), results = panel.querySelector('[data-notice-results]'), button = panel.querySelector('[data-parse-notice]');
  let revision = 0, timer, parsed = [], lastText = '', active = false;
  const input = id => dialog.querySelector(`#capture-${id}`);
  function reset(item = null) {
    revision++; clearTimeout(timer); parsed = []; lastText = ''; active = false; button.disabled = false; results.innerHTML = '';
    reference.value = item?.referenceAt ? clockInput(new Date(item.referenceAt)) : clockInput(new Date());
    status.textContent = aiEnabled('notice') ? '千问识别已开启，停笔后生成预览；应用后才会改动表单。' : '当前使用手动记录。可在“更多 → API 与服务连接”开启千问。';
  }
  async function parse() {
    clearTimeout(timer);
    if (!dialog.open || active) return;
    if (!aiEnabled('notice')) { status.textContent = '请先在 API 设置启用通知识别并填写访问口令，原话现在就能保存。'; return; }
    const original = text.value.trim(), stamp = reference.value;
    if (original.length < 2) { status.textContent = '先写下需要识别的通知。'; return; }
    if (!stamp || !Number.isFinite(+new Date(stamp))) { status.textContent = '请填写通知的参考时间。'; return; }
    const version = ++revision, capturedScope = { ...dialog.captureScope };
    lastText = original; active = true; button.disabled = true; status.textContent = '正在识别，原话随时可以保存…'; results.innerHTML = '';
    try {
      const value = await callAI('notice', { text: original });
      if (revision !== version || !dialog.open || text.value.trim() !== original || reference.value !== stamp) return;
      const courses = dm.getCourses(capturedScope.className);
      parsed = resolveNoticeItems(value.items, { text: original, referenceAt: stamp, courses, sectionTimes: dm.getSectionTimes(), seasonRule: dm.getSemesterInfo().seasonRule, selectedCourseName: input('course').value });
      status.textContent = parsed.length ? `识别到${parsed.length}项。可查看原文依据，再应用到记录或存为候选活动。` : '未识别到独立事项，原话仍可直接保存。';
      results.innerHTML = parsed.map((item, index) => `<article class="notice-preview"><h3>${esc(item.title)}</h3><p>${esc([item.date, item.startTime && item.endTime ? '' : item.dueTime || item.startTime, item.timeContext, item.location, item.courseName].filter(Boolean).join(' · ') || '随手记，未指定时间地点')}</p>
        ${item.issues.length ? `<p class="notice-issues">${esc(item.issues.join('；'))}</p>` : ''}<details><summary>识别依据</summary><p>${item.evidence.map(line=>`「${esc(line)}」`).join('、') || '仅整理了通知内容'}</p>${item.basis.map(line=>`<p>${esc(line)}</p>`).join('')}</details>
        <div class="personal-backup-actions"><button type="button" class="btn" data-apply-notice="${index}">应用到这条记录</button>${item.kind==='activity'?`<button type="button" class="btn" data-save-notice-activity="${index}">存为候选活动</button>`:''}</div>${item.kind==='change'?'<p class="daily-small">仅记录变更通知，不会改写原课表。</p>':''}</article>`).join('');
    } catch (error) { if (revision === version && dialog.open) status.textContent = `${error.message}。原话仍可保存。`; }
    finally { if (revision === version) { active = false; button.disabled = false; } }
  }
  button.onclick = parse;
  function changed() {
    revision++; clearTimeout(timer); active = false; button.disabled = false; parsed = []; results.innerHTML = '';
    if (aiEnabled('notice') && text.value.trim().length >= 2 && text.value.trim() !== lastText) timer = setTimeout(parse, 1500);
  }
  text.addEventListener('input', changed); reference.addEventListener('change', () => { lastText = ''; changed(); });
  input('course').addEventListener('change', () => { lastText = ''; changed(); });
  results.onclick = event => {
    const apply = event.target.closest('[data-apply-notice]'), activity = event.target.closest('[data-save-notice-activity]');
    if (!apply && !activity) return;
    const item = parsed[Number(apply?.dataset.applyNotice ?? activity?.dataset.saveNoticeActivity)];
    if (!item) return;
    try {
      if (activity) {
        saveActivity({ ...dialog.captureScope, title: item.title, sourceText: text.value.trim(), location: item.location, status:'candidate',
          date:item.date, endDate:'', startTime:item.date?item.startTime:'', endTime:item.date&&item.endTime>item.startTime?item.endTime:'', checkInTime:item.date?item.checkInTime:'', registrationDate:item.registrationDate, registrationTime:item.registrationDate?item.registrationTime:'', travelBefore:null, travelAfter:null, reminderMinutes:30 });
        activity.disabled = true; activity.textContent = '已存为候选活动'; rerender(); notify('已保存候选活动，可在日程里查看冲突后决定是否参加');
      } else {
        input('kind').value = item.kind === 'activity' ? 'note' : item.kind;
        input('course').value = item.courseName; input('date').value = item.date;
        input('time').disabled = !item.date; input('time').value = item.date ? item.dueTime : '';
        input('location').value = item.location; input('context').value = item.timeContext;
        input('confirm').checked = item.needsConfirmation;
        dialog.captureReferenceAt = new Date(reference.value).toISOString();
        input('extra').open = true; status.textContent = '已应用到表单，原话完整保留；保存前仍可修改。';
      }
    } catch (error) { status.textContent = error.message; }
  };
  dialog.addEventListener('close', () => { revision++; clearTimeout(timer); });
  dialog.resetAI = reset;
}
