import { readDailyData } from './daily-store.js?v=20261023-2';
import { cachedWeather, refreshWeather } from './weather-client.js?v=20261023-2';
import { weatherDay, weatherStatus } from './weather-model.js?v=20261023-2';
import { weatherHeadline } from './weather-presentation.js?v=20261023-2';
import { localDate } from './daily-model.js?v=20261023-2';
import { escapeText as esc } from './tasks-store.js?v=20261023-2';

export function mountWeather(container) {
  const slot = container.querySelector('#dash-weather-slot');
  let disposed=false, message='', busy=false, serial=0, lastAttempt=0,lastMinute=-1;
  function city() { try{return readDailyData().profile.city;}catch{return '';} }
  function headline(now=new Date()) {
    const value=weatherHeadline(cachedWeather(city()),now,city());
    return `<span class="weather-context"><span class="weather-range">${esc(value.range||value.label)}</span>${value.range?`<span class="weather-qualifier">${esc(value.label)}</span>`:''}<span class="weather-place">${esc(value.place)}</span><span class="course-list-chevron" aria-hidden="true"></span></span>${value.rain?`<span class="weather-rain-note">${esc(value.rain)}</span>`:''}`;
  }
  function render() {
    if(disposed)return;
    const opened=slot.querySelector('details')?.open||false, focused=slot.contains(document.activeElement)&&document.activeElement?.matches('[data-weather-refresh]');
    const now=new Date(),weather=cachedWeather(city()),status=weatherStatus(weather,now),day=weatherDay(weather,localDate(now),{now});
    const rows=status==='expired'?[]:weather?.hours.filter(row=>Date.parse(row.time+':00+08:00')>=+now-3600000).slice(0,48)||[];
    const value=number=>number===null?'—':Math.round(number);
    slot.innerHTML=`<details class="weather-strip"${opened?' open':''}><summary>${headline(now)}</summary><div class="weather-body"><div class="weather-actions"><button type="button" class="daily-text-button" data-weather-refresh ${busy?'disabled':''}>${busy?'正在获取…':'刷新天气'}</button><a class="daily-link" href="#/wardrobe">地区与穿衣偏好</a></div>
      ${day?`<p class="daily-small">今日日间 ${day.from}—${day.to}参考 · 体感 ${value(day.feelsMin)}—${value(day.feelsMax)}°C · 风速最高 ${value(day.wind)} km/h</p>`:''}
      <p class="daily-small" role="status">${esc(message|| (status==='stale'?'暂用旧预报，出门前可刷新。':''))}</p>
      ${rows.length?`<div class="weather-hours"><table><caption>未来48小时预报</caption><thead><tr><th>时段</th><th>气温／体感</th><th>降雨概率</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.time.slice(5,10))} ${esc(row.time.slice(11))}</td><td>${value(row.temperature)}／${value(row.feelsLike)}°C</td><td>${row.rainProbability===null?'未知':value(row.rainProbability)+'%'}</td></tr>`).join('')}</tbody></table></div>`:''}
      <p class="daily-small">${weather?`获取于 ${esc(new Date(weather.fetchedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}；` : ''}约30分钟缓存，手动检查每分钟最多一次。区域预报，小时降雨概率不代表一定下雨。<a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">天气：Open-Meteo</a> · <a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></p></div></details>`;
    if(focused)slot.querySelector('[data-weather-refresh]')?.focus({preventScroll:true});
  }
  async function load(manual=false) {
    const token=++serial;busy=true;message='';lastAttempt=Date.now();render();
    try{await refreshWeather(city(),manual);}catch(error){if(token===serial)message=error.message;}
    finally{if(token===serial){busy=false;render();}}
  }
  const click=event=>{if(event.target.closest('[data-weather-refresh]'))load(true);};
  const changed=()=>{render();load();};
  const tick=()=>{
    if(document.visibilityState==='hidden')return;
    const minute=Math.floor(Date.now()/60000);
    if(minute!==lastMinute){lastMinute=minute;const summary=slot.querySelector('summary'),html=headline();if(summary&&summary.innerHTML!==html)summary.innerHTML=html;}
    if(Date.now()-lastAttempt>=30*60000)load();
  };
  slot.addEventListener('click',click);window.addEventListener('weather:changed',render);window.addEventListener('daily:changed',changed);document.addEventListener('app:tick',tick);
  render();load();
  return ()=>{disposed=true;serial++;slot.removeEventListener('click',click);window.removeEventListener('weather:changed',render);window.removeEventListener('daily:changed',changed);document.removeEventListener('app:tick',tick);};
}
