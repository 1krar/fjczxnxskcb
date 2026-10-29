import { weatherDay, weatherStatus } from './weather-model.js?v=20261029-3';

export function weatherHeadline(weather,now=new Date(),city='') {
  const today=new Date(+now+8*3600000).toISOString().slice(0,10),status=weatherStatus(weather,now);
  const day=weatherDay(weather,today,{now});
  const place=weather?.location?.name||city||'福州仓山附近';
  const range=day?`${Math.round(day.min)}—${Math.round(day.max)}°C`:'';
  const label=day?(status==='stale'?'今日日间旧预报':'今日日间预报'):status==='expired'?'旧预报已过期':'天气未更新';
  let rain='';
  if(status==='fresh') {
    const rows=weather.hours.filter(row=>row.time.slice(0,10)===today&&Date.parse(row.time+':00+08:00')+3600000>+now);
    const first=rows.findIndex(row=>row.rainProbability!==null&&row.rainProbability>=40);
    if(first>=0) {
      const interval=[rows[first]];
      for(const row of rows.slice(first+1)) {
        if(row.rainProbability===null||row.rainProbability<40||Date.parse(row.time+':00+08:00')-Date.parse(interval.at(-1).time+':00+08:00')!==3600000)break;
        interval.push(row);
      }
      const end=String(Number(interval.at(-1).time.slice(11,13))+1).padStart(2,'0')+':00';
      rain=`${interval[0].time.slice(11)}—${end} 降雨概率最高${Math.round(Math.max(...interval.map(row=>row.rainProbability)))}%`;
    }
  }
  return {range,label,place,rain};
}
