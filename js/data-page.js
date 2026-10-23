import { formatDate } from './time.js?v=20261023-4b';
import { rerenderCurrentPage, selectClass } from './app.js?v=20261023-4b';
import {
  compareCourses,
  getSavedUpdate,
  readProjectUpdate,
  readUpdateFile,
  removeClassUpdate,
  saveClassUpdate,
  validateImportedData,
} from './data-update.js?v=20261023-4b';

let updateNotice = '';

export function renderData(container, state, dm) {
  const info = dm.getSemesterInfo();
  const classes = dm.getClasses();
  const errors = dm.getErrors();
  const updatedAt = info.updatedAt || '';
  const updatedAtDisplay = updatedAt ? formatDate(updatedAt.slice(0, 10)) + (updatedAt.length > 10 ? ' ' + updatedAt.slice(11, 16) : '') : '未知';
  const saved = getSavedUpdate(info.semester, state.currentClass);

  container.innerHTML = `
    <div class="analytics-grid">
      <div class="analytics-card">
        <div class="analytics-card-title">数据信息</div>
        <div class="data-info-grid">
          <div class="data-info-item">
            <span class="data-info-label">当前学期</span>
            <span class="data-info-value">${info.semester}</span>
          </div>
          <div class="data-info-item">
            <span class="data-info-label">学期开始</span>
            <span class="data-info-value">${info.semesterStart}</span>
          </div>
          <div class="data-info-item">
            <span class="data-info-label">${saved ? '程序原版时间' : '数据更新时间'}</span>
            <span class="data-info-value">${updatedAtDisplay}</span>
          </div>
          <div class="data-info-item">
            <span class="data-info-label">课程周</span>
            <span class="data-info-value">${info.firstWeek} — ${info.lastWeek}</span>
          </div>
          <div class="data-info-item">
            <span class="data-info-label">班级数</span>
            <span class="data-info-value">${classes.length}</span>
          </div>
          <div class="data-info-item">
            <span class="data-info-label">季节模式</span>
            <span class="data-info-value">${info.seasonMode === 'auto' ? '自动' : info.seasonMode}</span>
          </div>
        </div>
      </div>

      <div class="analytics-card" style="padding:0;overflow:hidden;">
        <div class="analytics-card-title" style="padding:20px 20px 0;">班级列表</div>
        <div class="table-scroll">
          <table class="stat-table sticky-table sticky-first-col" style="min-width:480px;">
            <thead><tr><th>班级名称</th><th>课程类型 / 门</th><th>课程安排 / 次</th><th>总节次 / 节</th><th>教学时长 / 小时</th></tr></thead>
            <tbody>
              ${classes.map(c => {
                const courses = dm.getCourses(c.className);
                const stats = dm.getCourseStats(c.className);
                const courseTypes = stats.length;
                const totalSessions = stats.reduce((sum, s) => sum + s.count, 0);
                const totalSections = stats.reduce((sum, s) => sum + s.totalSections, 0);
                const totalHours = stats.reduce((sum, s) => sum + s.totalHours, 0);
                return `<tr><td style="font-weight:600;">${c.className}</td><td class="mono">${courseTypes}</td><td class="mono">${totalSessions}</td><td class="mono">${totalSections}</td><td class="mono">${totalHours}</td></tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="analytics-card analytics-full">
        <div class="analytics-card-title">数据校验</div>
        ${errors.length === 0
          ? `<div class="badge badge-success" style="font-size:14px;padding:8px 12px;">✓ 数据校验通过，未发现异常</div>`
          : `<div class="error-banner">检测到 ${errors.length} 个数据异常：</div>
             <ul style="margin-top:8px;padding-left:20px;font-size:13px;color:var(--color-text-secondary);">
               ${errors.map(e => `<li>${e}</li>`).join('')}
             </ul>`}
      </div>
    </div>

    <div class="card card-pad data-update-card" style="margin-top:24px;">
      <div class="analytics-card-title">更新课表</div>
      <p class="data-update-help">先在电脑上运行“抓取课表.cmd”并完成学校登录，再将生成的 JSON 文件导入这里。更新会保存在当前设备的浏览器中。</p>
      <div class="data-update-current">
        <span>当前班级：<strong id="data-update-class"></strong></span>
        <span id="data-update-source"></span>
      </div>
      <div class="data-update-actions">
        <button type="button" class="btn btn-primary" id="data-update-choose">选择课表文件</button>
        <button type="button" class="btn" id="data-update-project">读取项目新文件</button>
        <button type="button" class="btn" id="data-update-restore" ${saved ? '' : 'disabled'}>恢复原版</button>
        <input type="file" id="data-update-file" accept=".json,application/json" hidden>
      </div>
      <p class="data-update-help">电脑本地预览时，可在抓取后点“读取项目新文件”；在线网站需先发布新文件，或直接选择文件导入。</p>
      <div class="data-update-message" id="data-update-message" role="status" aria-live="polite"></div>
      <div class="data-update-preview" id="data-update-preview" hidden>
        <strong id="data-update-preview-title"></strong>
        <p id="data-update-preview-detail"></p>
        <button type="button" class="btn btn-primary" id="data-update-apply">确认使用新课表</button>
      </div>
    </div>
  `;

  container.querySelector('#data-update-class').textContent = state.currentClass;
  container.querySelector('#data-update-source').textContent = saved
    ? `本机更新 · ${new Date(saved.importedAt).toLocaleDateString('zh-CN')}`
    : '程序原版数据';
  const message = container.querySelector('#data-update-message');
  message.textContent = updateNotice;
  let pending = null;

  function showError(error) {
    message.textContent = error.message || '读取失败，请重试';
    message.classList.add('is-error');
    container.querySelector('#data-update-preview').hidden = true;
    pending = null;
  }

  function prepare(value, sourceName) {
    pending = validateImportedData(value, dm);
    const current = dm.getClass(pending.className).courses || [];
    const diff = compareCourses(current, pending.courses);
    container.querySelector('#data-update-preview-title').textContent =
      `${sourceName} · ${pending.className}`;
    container.querySelector('#data-update-preview-detail').textContent =
      `${pending.courses.length} 次课程；新增 ${diff.added}、移除 ${diff.removed}、信息变更 ${diff.changed}。`;
    container.querySelector('#data-update-preview').hidden = false;
    message.classList.remove('is-error');
    message.textContent = '已读取文件，请核对变更后确认使用。';
  }

  const fileInput = container.querySelector('#data-update-file');
  container.querySelector('#data-update-choose').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    try {
      if (!fileInput.files?.length) return;
      message.textContent = '正在读取文件…';
      prepare(await readUpdateFile(fileInput.files[0]), fileInput.files[0].name);
    } catch (error) {
      showError(error);
    } finally {
      fileInput.value = '';
    }
  });

  container.querySelector('#data-update-project').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    message.textContent = '正在检查项目新文件…';
    try {
      const value = await readProjectUpdate(info.semester, state.currentClass);
      prepare(value, '项目新文件');
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  });

  container.querySelector('#data-update-apply').addEventListener('click', () => {
    if (!pending) return;
    try {
      saveClassUpdate(dm, pending);
      updateNotice = `已更新 ${pending.className}，本设备现在使用新课表。`;
      selectClass(pending.className);
    } catch (error) {
      showError(error);
    }
  });

  container.querySelector('#data-update-restore').addEventListener('click', () => {
    try {
      removeClassUpdate(dm, state.currentClass);
      updateNotice = `已恢复 ${state.currentClass} 的程序原版课表。`;
      rerenderCurrentPage();
    } catch (error) {
      showError(error);
    }
  });
}
