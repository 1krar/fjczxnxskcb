import { getSettings, saveSettings, setSelectedClass } from './storage.js';
import { rerenderCurrentPage } from './app.js';

export function renderSettings(container, state, dm) {
  const settings = getSettings();
  const classes = dm.getClasses();

  container.innerHTML = `
    <div class="analytics-grid">
      <div class="analytics-card">
        <div class="analytics-card-title">显示设置</div>

        <div class="settings-group">
          <div class="settings-row">
            <span class="settings-label">时间格式</span>
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
              <div class="toggle-switch ${settings.showTeacher ? 'on' : ''}" id="setting-showTeacher"></div>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label">显示教室完整名称</span>
            <div class="settings-control">
              <div class="toggle-switch ${settings.showFullLocation ? 'on' : ''}" id="setting-showFullLocation"></div>
            </div>
          </div>
        </div>

        <div class="settings-group-title">班级设置</div>
        <div class="settings-row">
          <span class="settings-label">默认班级</span>
          <div class="settings-control">
            <select class="settings-select" id="setting-defaultClass">
              ${classes.map(c => `<option value="${c.className}" ${c.className === settings.selectedClass ? 'selected' : ''}>${c.className}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="analytics-card">
        <div class="analytics-card-title">关于</div>
        <div style="font-size:14px;color:var(--color-text-secondary);line-height:1.8;">
          <p>课程控制台 v1.0</p>
          <p>个人课程控制台 · 数据与程序分离</p>
          <p>技术栈：HTML5 / CSS3 / 原生 JavaScript (ES Modules)</p>
          <p>部署目标：Cloudflare Pages 静态部署</p>
        </div>
        <div style="margin-top:20px;padding:16px;background:var(--color-border-light);border-radius:var(--radius);font-size:13px;color:var(--color-text-secondary);line-height:1.6;">
          所有设置保存在浏览器 localStorage 中，仅限当前设备。切换班级后所有页面会自动同步。
        </div>
      </div>
    </div>
  `;

  container.querySelector('#setting-timeFormat').addEventListener('change', (e) => {
    saveSettings({ timeFormat: e.target.value });
    state.settings = getSettings();
    rerenderCurrentPage();
  });

  container.querySelector('#setting-showTeacher').addEventListener('click', (e) => {
    const isOn = e.currentTarget.classList.toggle('on');
    saveSettings({ showTeacher: isOn });
    state.settings = getSettings();
    rerenderCurrentPage();
  });

  container.querySelector('#setting-showFullLocation').addEventListener('click', (e) => {
    const isOn = e.currentTarget.classList.toggle('on');
    saveSettings({ showFullLocation: isOn });
    state.settings = getSettings();
    rerenderCurrentPage();
  });

  container.querySelector('#setting-defaultClass').addEventListener('change', (e) => {
    setSelectedClass(e.target.value);
    state.currentClass = e.target.value;
    state.settings = getSettings();
    rerenderCurrentPage();
  });
}
