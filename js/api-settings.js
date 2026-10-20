import { escapeText as esc } from './tasks-store.js?v=20261020-9';
const KEY='course-dashboard-api-connection-v1';
export function renderApiSettings(container) {
  let saved={endpoint:'',model:''},error='';
  try {const raw=localStorage.getItem(KEY);if(raw){const value=JSON.parse(raw);if(!value||typeof value.endpoint!=='string'||typeof value.model!=='string')throw new Error('连接配置无法读取');saved=value;}}
  catch(reason){error=reason.message;}
  container.innerHTML=`<section class="agenda-page"><header class="agenda-heading"><div><h1>API 与服务连接</h1><p>为通知解析、天气和交易日历预留连接入口。</p></div></header><section class="agenda-panel"><h2>AI 通知解析</h2><p class="agenda-muted">状态：尚未接通。当前活动可以手动录入和核对；保存配置不会启用模型或产生调用费用。</p><form class="agenda-settings" id="api-settings-form"><label>个人代理服务地址<input type="url" name="endpoint" value="${esc(saved.endpoint)}" maxlength="500" placeholder="https://你的服务地址"></label><label>模型名称<input name="model" value="${esc(saved.model)}" maxlength="120" placeholder="接入服务后填写"></label><p class="agenda-muted">这里只保存地址与模型名称。API密钥应放在Cloudflare服务端；当前网页不收集或保存密钥。正式接通还需要服务端身份验证、调用限额和连接测试。</p><p id="api-error" class="personal-error" role="alert">${esc(error)}</p><p id="api-saved" role="status"></p><button type="submit" class="btn btn-primary">保存连接草稿</button></form></section>
  <section class="agenda-panel"><h2>其他服务</h2><div class="agenda-record"><div><strong>天气</strong><p>尚未连接，当前不会按实时天气给出穿衣结论。</p></div><a href="#/wardrobe">生活偏好 →</a></div><div class="agenda-record"><div><strong>交易日历</strong><p>使用已核对的2026年休市安排；未启用实时更新接口。</p></div><a href="#/reminders">提醒设置 →</a></div></section></section>`;
  container.querySelector('#api-settings-form').onsubmit=event=>{
    event.preventDefault();const form=new FormData(event.currentTarget);
    try {const endpoint=String(form.get('endpoint')||'').trim(),model=String(form.get('model')||'').trim();if(endpoint){const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('请使用不含账号、密钥、查询参数或片段的HTTPS服务地址');}if(model.length>120)throw new Error('模型名称过长');localStorage.setItem(KEY,JSON.stringify({endpoint,model}));container.querySelector('#api-error').textContent='';container.querySelector('#api-saved').textContent='连接草稿已保存；服务仍未接通。';}
    catch(error){container.querySelector('#api-error').textContent=error.message;}
  };
}
