import { formatDate } from './time.js';

export function renderData(container, state, dm) {
  const info = dm.getSemesterInfo();
  const classes = dm.getClasses();
  const errors = dm.getErrors();
  const updatedAt = info.updatedAt || '';
  const updatedAtDisplay = updatedAt ? formatDate(updatedAt.slice(0, 10)) + (updatedAt.length > 10 ? ' ' + updatedAt.slice(11, 16) : '') : '未知';

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
            <span class="data-info-label">数据更新时间</span>
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
          <table class="stat-table sticky-table">
            <thead><tr><th>班级名称</th><th>课程数</th></tr></thead>
            <tbody>
              ${classes.map(c => {
                const courses = dm.getCourses(c.className);
                return `<tr><td style="font-weight:600;">${c.className}</td><td class="mono">${courses.length}</td></tr>`;
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

    <div class="card card-pad" style="margin-top:24px;">
      <div class="analytics-card-title">数据更新说明</div>
      <p style="font-size:14px;color:var(--color-text-secondary);line-height:1.6;">
        课程数据来源于本地 JSON 文件。重新爬取课程数据后，只需替换
        <code style="background:var(--color-border-light);padding:2px 6px;border-radius:4px;font-size:13px;">data/*.json</code>
        文件，网页程序无需修改，页面会自动读取新的数据。
      </p>
    </div>
  `;
}
