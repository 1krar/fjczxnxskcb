import { getSettings, saveSettings } from './storage.js?v=20261030-1';
import { selectClass } from './app.js?v=20261030-1';

export function renderSettings(container, state, dm) {
  const settings = getSettings();
  const classes = dm.getClasses();
  const display=window.CourseDisplay.read();

  container.innerHTML = `
    <header class="personal-page-heading"><div><h1>更多</h1><p>日常准备、课表工具与设置</p></div></header>
    <nav class="more-links more-sections" aria-label="更多功能">
      <section><h2>日常准备</h2>
        <a href="#/wardrobe"><span>小衣橱<span>选明天穿搭，记录实穿与洗晒</span></span><span aria-hidden="true">›</span></a>
        <a href="#/agenda"><span>日历与活动<span>查看每天安排，检查时间冲突</span></span><span aria-hidden="true">›</span></a>
        <a href="#/study"><span>晚自习与特殊安排<span>九、十节，按天记录活动和请假</span></span><span aria-hidden="true">›</span></a>
      </section>
      <section><h2>课程与提醒</h2>
        <a href="#/reminders"><span>提前提醒与大 A<span>出门准备、课程区间与提醒时间</span></span><span aria-hidden="true">›</span></a>
        <a href="#/analytics"><span>课程分析</span><span aria-hidden="true">›</span></a>
        <a href="#/compare"><span>班级对比</span><span aria-hidden="true">›</span></a>
      </section>
      <section><h2>设置与数据</h2>
        <a href="#/api"><span>AI 与服务连接<span>访问解锁、模型与调用设置</span></span><span aria-hidden="true">›</span></a>
        <a href="#/data"><span>课表数据与更新<span>导入新课表，查看数据来源</span></span><span aria-hidden="true">›</span></a>
      </section>
    </nav>
    <div class="analytics-grid">
      <div class="analytics-card">
        <div class="analytics-card-title">显示设置</div>

        <div class="settings-group">
          <div class="settings-row"><label class="settings-label" for="setting-theme">外观</label><div class="settings-control"><select class="settings-select" id="setting-theme">${[['system','跟随系统'],['light','浅色'],['dark','深色']].map(([value,label])=>`<option value="${value}"${display.theme===value?' selected':''}>${label}</option>`).join('')}</select></div></div>
          <div class="settings-row"><label class="settings-label" for="setting-textSize">文字大小</label><div class="settings-control"><select class="settings-select" id="setting-textSize">${[['normal','标准 · 100%'],['large','较大 · 125%'],['larger','特大 · 150%'],['maximum','最大 · 200%']].map(([value,label])=>`<option value="${value}"${display.textSize===value?' selected':''}>${label}</option>`).join('')}</select></div></div>
          <div class="settings-row"><label class="settings-label" for="setting-motion">动态效果</label><div class="settings-control"><select class="settings-select" id="setting-motion">${[['system','跟随系统'],['reduce','减少动态效果']].map(([value,label])=>`<option value="${value}"${display.motion===value?' selected':''}>${label}</option>`).join('')}</select></div></div>
          <p class="daily-small" id="display-settings-status" role="status">选择后立即生效，仅保存在当前浏览器。</p>
          <div class="settings-row">
            <label class="settings-label" for="setting-timeFormat">时间格式</label>
            <div class="settings-control">
              <select class="settings-select" id="setting-timeFormat">
                <option value="24h" ${settings.timeFormat === '24h' ? 'selected' : ''}>24 小时制</option>
                <option value="12h" ${settings.timeFormat === '12h' ? 'selected' : ''}>12 小时制</option>
              </select>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label">显示教师</span>
            <div class="settings-control">
              <button type="button" class="toggle-switch ${settings.showTeacher ? 'on' : ''}" id="setting-showTeacher" role="switch" aria-label="显示教师" aria-checked="${settings.showTeacher}"></button>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label">显示教室完整名称</span>
            <div class="settings-control">
              <button type="button" class="toggle-switch ${settings.showFullLocation ? 'on' : ''}" id="setting-showFullLocation" role="switch" aria-label="显示教室完整名称" aria-checked="${settings.showFullLocation}"></button>
            </div>
          </div>
        </div>

        <div class="settings-group-title">班级设置</div>
        <div class="settings-row">
          <label class="settings-label" for="setting-defaultClass">默认班级</label>
          <div class="settings-control">
            <select class="settings-select" id="setting-defaultClass">
              ${classes.map(c => `<option value="${c.className}" ${c.className === settings.selectedClass ? 'selected' : ''}>${c.className}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <details class="analytics-card settings-about"><summary>数据存在哪里</summary><p class="daily-muted">显示设置、个人事项、衣物和穿搭记录保存在当前浏览器。换设备前，请分别在事项页和衣橱页下载备份。切换班级会同步更新各页面的课表。</p></details>
    </div>
  `;

  for (const name of ['theme','textSize','motion']) container.querySelector('#setting-'+name).addEventListener('change',event=>{
    try { window.CourseDisplay.save({[name]:event.target.value}); container.querySelector('#display-settings-status').textContent='显示设置已保存。'; }
    catch(error) { event.target.value=window.CourseDisplay.read()[name]; container.querySelector('#display-settings-status').textContent=error.message; }
  });

  container.querySelector('#setting-timeFormat').addEventListener('change', (e) => {
    saveSettings({ timeFormat: e.target.value });
    state.settings = getSettings();
  });

  container.querySelector('#setting-showTeacher').addEventListener('click', (e) => {
    const isOn = e.currentTarget.classList.toggle('on');
    e.currentTarget.setAttribute('aria-checked', String(isOn));
    saveSettings({ showTeacher: isOn });
    state.settings = getSettings();
  });

  container.querySelector('#setting-showFullLocation').addEventListener('click', (e) => {
    const isOn = e.currentTarget.classList.toggle('on');
    e.currentTarget.setAttribute('aria-checked', String(isOn));
    saveSettings({ showFullLocation: isOn });
    state.settings = getSettings();
  });

  container.querySelector('#setting-defaultClass').addEventListener('change', (e) => {
    selectClass(e.target.value);
  });
}
