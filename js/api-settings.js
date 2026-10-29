import { readAISettings, saveAISettings, serverStatus, callAI } from './ai-client.js?v=20261029-5';
import { aiSessionStatus, restoreAISession, unlockAISession, logoutAISession, startAISession } from './ai-session-client.js?v=20261029-5';
import { markFormSaved } from './refresh-guard.js?v=20261029-5';
export function renderApiSettings(container) {
  const saved = readAISettings(); let disposed = false, busy = false;
  container.innerHTML = `<section class="agenda-page"><header class="agenda-heading"><div><h1>AI 与服务连接</h1><p>通知识别与每日一句</p></div></header>
  <section class="agenda-panel"><h2>阿里云百炼 · 北京</h2><p class="agenda-muted">普通 API · 模型 <strong>qwen3.8-flash</strong> · 已预设非思考模式与结构化识别。</p><p id="ai-server-status" role="status">正在检查服务端配置…</p>
  <form class="agenda-settings" id="api-settings-form">
  <label class="capture-check"><input type="checkbox" name="enabled" ${saved.enabled ? 'checked' : ''}>启用 AI</label>
  <label class="capture-check"><input type="checkbox" name="notice" ${saved.notice ? 'checked' : ''}>输入通知后自动识别（停笔约1.5秒）</label>
  <label class="capture-check"><input type="checkbox" name="daily" ${saved.daily ? 'checked' : ''}>使用 AI 每日一句</label>
  <label class="capture-check"><input type="checkbox" name="outfit" ${saved.outfit ? 'checked' : ''}>在衣橱中手动请 AI 挑一套</label>
  <label>个人访问口令<input type="password" name="token" autocomplete="off" maxlength="512" placeholder="已解锁时可留空；6位数字或原有长口令"></label>
  <label class="capture-check"><input type="checkbox" name="rememberDevice" ${saved.rememberDevice ? 'checked' : ''}>解锁时记住这个设备（30天）</label>
  <p id="ai-device-status" role="status">正在恢复设备授权…</p>
  <p class="agenda-muted">仅在自己的设备勾选；不勾选则本次浏览解锁，最长8小时。口令不长期保存。</p>
  <p class="agenda-muted">百炼 API Key 保存在 Cloudflare 服务端。开启 AI 后，会把对应功能所需的通知、日程摘要或穿搭候选发送给百炼；个人记录仍保存在当前浏览器。</p>
  <details class="api-use-help"><summary>调用次数与授权说明</summary><p class="agenda-muted">各 AI 功能合计：每分钟最多2次、每天默认20次。每日一句在每天首次打开或回到主页时自动生成；失败后有限重试。关闭网页期间不会后台生成。穿搭仅手动调用；天气不占 AI 次数。</p>
  <p class="agenda-muted">支持6位数字口令。同一网络15分钟内输错5次会暂停验证；全站异常尝试另有限制。原有长口令仍可使用。清除网站 Cookie 或到期后需重新解锁。</p></details>
  <div class="settings-save-bar"><p id="api-error" class="personal-error" role="alert"></p><p id="api-saved" data-save-feedback role="status"></p><button type="submit" id="api-save" class="btn btn-primary">保存设置并解锁</button></div>
  <details class="api-device-tools"><summary>授权检查与退出</summary><div class="personal-backup-actions"><button type="button" class="btn" id="ai-check">检查授权</button><button type="button" class="btn" id="ai-probe">测试模型连接</button></div><p class="agenda-muted">检查授权不调用模型；测试模型连接会调用一次。</p><div class="personal-backup-actions"><button type="button" class="btn" id="ai-logout">退出当前设备</button><button type="button" class="btn" id="ai-logout-all">退出全部设备</button></div></details></form>
  <details><summary>配置与用量说明</summary><p>服务端需配置 DASHSCOPE_API_KEY、AI_ACCESS_TOKEN，并绑定 AI_DB。数据库保存用量、授权凭据摘要及有效期，不保存通知原文。修改服务端口令会让旧设备授权失效。</p><p>检查授权、记住设备及退出不调用模型；测试模型连接调用一次。</p></details></section>
  <section class="agenda-panel"><h2>其他服务</h2><div class="agenda-record"><div><strong>天气 · Open-Meteo</strong><p>区域逐小时预报，无需填写 Key。默认福州仓山附近，约30分钟缓存；获取失败时标明状态。</p></div><a href="#/wardrobe">地区与穿衣偏好 →</a></div><div class="agenda-record"><div><strong>交易日历</strong><p>使用已核对的2026年休市安排。</p></div><a href="#/reminders">提醒设置 →</a></div></section></section>`;
  const form = container.querySelector('form'), error = container.querySelector('#api-error'), message = container.querySelector('#api-saved');
  function deviceStatus() {
    if (disposed) return;
    const value = aiSessionStatus(), label = container.querySelector('#ai-device-status');
    label.textContent = value.status === 'unlocked' ? (value.remembered ? '此设备已记住' : '本次浏览已解锁') + ' · 有效至 ' + new Date(value.expiresAt).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false })
      : value.status === 'locked' ? '此设备尚未解锁或授权已到期。' : value.status === 'unavailable' ? '暂时无法检查设备授权，可点“检查授权”重试。' : '正在恢复设备授权…';
    for (const id of ['ai-logout','ai-logout-all']) container.querySelector('#'+id).disabled = busy || value.status !== 'unlocked';
  }
  function save() {
    const fields = new FormData(form);
    saveAISettings(Object.fromEntries(['enabled','notice','daily','outfit','rememberDevice'].map(key => [key, fields.has(key)])));
    return { token:String(fields.get('token') || '').trim(), remember:fields.has('rememberDevice') };
  }
  async function run(action) {
    if (busy) return;
    busy = true; form.querySelectorAll('button').forEach(button => button.disabled = true);
    form.setAttribute('aria-busy','true');
    error.textContent = ''; message.textContent = '正在处理…';
    try {
      if (action === 'logout' || action === 'logoutAll') {
        await logoutAISession(action === 'logoutAll');
        message.textContent = action === 'logoutAll' ? '全部设备已退出，下次使用 AI 需要重新解锁。' : '当前设备已退出。';
      } else {
        const { token, remember } = save();
        if (token) { await unlockAISession(token, remember); form.elements.token.value = ''; }
        else if (action !== 'save' || aiSessionStatus().status !== 'unlocked') await restoreAISession(true);
        if (action === 'probe') {
          await callAI('probe'); message.textContent = '模型连接成功：北京 · qwen3.8-flash，已实际收到响应。';
        } else {
          message.textContent = aiSessionStatus().status === 'unlocked' ? '设置已保存，设备已解锁。检查授权未调用模型。' : '设置已保存。填写口令并解锁后即可使用 AI。';
        }
      }
    } catch (reason) { if (!disposed) { error.textContent = reason.message; message.textContent = ''; } }
    finally {
      busy = false;
      form.removeAttribute('aria-busy');
      if (!disposed && !error.textContent && !['logout','logoutAll'].includes(action)) markFormSaved(form);
      if (!disposed) { form.querySelectorAll('button').forEach(button => button.disabled = false); deviceStatus(); }
    }
  }
  form.onsubmit = event => { event.preventDefault(); run('save'); };
  container.querySelector('#ai-check').onclick = () => run('check');
  container.querySelector('#ai-probe').onclick = () => run('probe');
  container.querySelector('#ai-logout').onclick = () => run('logout');
  container.querySelector('#ai-logout-all').onclick = () => run('logoutAll');
  window.addEventListener('ai:changed', deviceStatus);
  startAISession(); deviceStatus();
  serverStatus().then(value => { if (!disposed) container.querySelector('#ai-server-status').textContent = value.configured ? '服务端配置已就绪，模型连接尚需测试。' : `尚未启用：还需配置${value.missing.join('、')}。`; }).catch(reason => { if (!disposed) container.querySelector('#ai-server-status').textContent = reason.message; });
  return () => { disposed = true; window.removeEventListener('ai:changed', deviceStatus); };
}
