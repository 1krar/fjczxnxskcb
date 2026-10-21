import { escapeText as esc } from './tasks-store.js?v=20261021-7';
import { readAISettings, accessToken, saveAISettings, serverStatus, callAI } from './ai-client.js?v=20261021-7';
export function renderApiSettings(container) {
  const saved = readAISettings(); let disposed = false;
  container.innerHTML = `<section class="agenda-page"><header class="agenda-heading"><div><h1>API 与服务连接</h1><p>通知识别与每日一句</p></div></header>
  <section class="agenda-panel"><h2>阿里云百炼 · 北京</h2><p class="agenda-muted">普通 API · 模型 <strong>qwen3.8-flash</strong> · 已预设非思考模式与结构化识别。</p><p id="ai-server-status" role="status">正在检查服务端配置…</p>
  <form class="agenda-settings" id="api-settings-form">
  <label class="capture-check"><input type="checkbox" name="enabled" ${saved.enabled ? 'checked' : ''}>启用 AI</label>
  <label class="capture-check"><input type="checkbox" name="notice" ${saved.notice ? 'checked' : ''}>输入通知后自动识别（停笔约1.5秒）</label>
  <label class="capture-check"><input type="checkbox" name="daily" ${saved.daily ? 'checked' : ''}>使用 AI 每日一句</label>
  <label>个人访问口令<input type="password" name="token" autocomplete="off" maxlength="512" value="${esc(accessToken())}" placeholder="6位数字，或原有的长口令"></label>
  <p class="agenda-muted">百炼 API Key 放在 Cloudflare 服务端；这里仅填写你自己设置的网站访问口令，本次浏览会话保存。开启后，待识别通知或每日一句所需的事实摘要会发送给百炼。个人记录仍保存在当前浏览器。</p>
  <p class="agenda-muted">通知识别、每日一句与模型测试合计：每分钟最多2次、每天默认20次。每日一句每天自动生成一次；记录变化后可手动更新，失败时显示本地内容。</p>
  <p class="agenda-muted">支持6位数字口令。同一网络15分钟内输错5次会暂停验证；全站异常尝试另有限制。原有长口令仍可使用。</p>
  <p id="api-error" class="personal-error" role="alert"></p><p id="api-saved" role="status"></p>
  <div class="personal-backup-actions"><button type="submit" class="btn btn-primary">保存设置</button><button type="button" class="btn" id="ai-check">验证配置与口令</button><button type="button" class="btn" id="ai-probe">测试模型连接</button></div></form>
  <details><summary>首次启用需要什么</summary><p>在 Cloudflare Pages 配置百炼密钥 DASHSCOPE_API_KEY、个人访问口令 AI_ACCESS_TOKEN（6位数字或原有长口令），并绑定用量数据库 AI_DB，再重新部署。用量数据库只记录次数，不保存通知原文。</p><p>验证配置不调用模型；测试模型连接会调用一次。配置存在并不代表密钥有效，以模型测试结果为准。</p></details></section>
  <section class="agenda-panel"><h2>其他服务</h2><div class="agenda-record"><div><strong>天气</strong><p>尚未连接，不会按实时天气给出结论。</p></div><a href="#/wardrobe">生活偏好 →</a></div><div class="agenda-record"><div><strong>交易日历</strong><p>使用已核对的2026年休市安排。</p></div><a href="#/reminders">提醒设置 →</a></div></section></section>`;
  const form = container.querySelector('form'), error = container.querySelector('#api-error'), message = container.querySelector('#api-saved');
  function save() { const fields = new FormData(form); saveAISettings({ enabled: fields.has('enabled'), notice: fields.has('notice'), daily: fields.has('daily') }, String(fields.get('token') || '').trim()); }
  form.onsubmit = event => { event.preventDefault(); try { save(); error.textContent = ''; message.textContent = '设置已保存。模型是否可用，请点“测试模型连接”。'; } catch (reason) { error.textContent = reason.message; } };
  async function test(action, button) {
    button.disabled = true; error.textContent = ''; message.textContent = '正在检查…';
    try { save(); await callAI(action); if (!disposed) message.textContent = action === 'probe' ? '模型连接成功：北京 · qwen3.8-flash，已实际收到响应。' : '服务端配置与访问口令通过；尚未调用模型。'; }
    catch (reason) { if (!disposed) { error.textContent = reason.message; message.textContent = ''; } }
    finally { button.disabled = false; }
  }
  container.querySelector('#ai-check').onclick = event => test('check', event.currentTarget);
  container.querySelector('#ai-probe').onclick = event => test('probe', event.currentTarget);
  serverStatus().then(value => { if (!disposed) container.querySelector('#ai-server-status').textContent = value.configured ? '服务端配置已就绪，模型连接尚需测试。' : `尚未启用：还需配置${value.missing.join('、')}。`; }).catch(reason => { if (!disposed) container.querySelector('#ai-server-status').textContent = reason.message; });
  return () => { disposed = true; };
}
