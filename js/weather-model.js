export const DEFAULT_WEATHER_LOCATION = Object.freeze({ name:'福州仓山附近', latitude:26.04, longitude:119.30 });
export const WEATHER_TTL = 30 * 60000;
export const WEATHER_MAX_AGE = 6 * 3600000;
export const weatherCity = value => String(value || '').trim().slice(0,60);
export const isDefaultWeatherCity = value => !weatherCity(value) || /^(福州|福州市)?(仓山|仓山区|仓山附近)$/.test(weatherCity(value));
export function forecastURL(location) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({ latitude:String(location.latitude), longitude:String(location.longitude), timezone:'Asia/Shanghai', forecast_days:'3',
    hourly:'temperature_2m,apparent_temperature,precipitation_probability,precipitation,relative_humidity_2m,wind_speed_10m,weather_code', wind_speed_unit:'kmh', temperature_unit:'celsius' });
  return url.href;
}
export function geocodingURL(city) {
  return 'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name:weatherCity(city), countryCode:'CN', count:'5', language:'zh', format:'json' });
}
export function searchedLocation(raw) {
  const row = raw?.results?.find(row => row.country_code === 'CN' && Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
  if (!row) throw Error('没有找到这个地区，请填写城市名称，例如“福州仓山”或“厦门”。');
  return { name:[row.admin1,row.name].filter(Boolean).join(' · ').slice(0,80), latitude:Math.round(row.latitude*100)/100, longitude:Math.round(row.longitude*100)/100 };
}
const number = (value,min,max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const bounds = { temperature:[-70,65], feelsLike:[-90,85], rainProbability:[0,100], precipitation:[0,1000], humidity:[0,100], wind:[0,500], code:[0,99] };
const validHour = time => typeof time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(time) && Number.isFinite(Date.parse(time+':00+08:00')) && new Date(Date.parse(time+':00+08:00')+8*3600000).toISOString().slice(0,16) === time;
export function normalizeWeather(raw,location,now=new Date()) {
  const hourly = raw?.hourly, units = raw?.hourly_units;
  if (raw?.timezone !== 'Asia/Shanghai' || !Array.isArray(hourly?.time) || hourly.time.length < 1 || hourly.time.length > 96 ||
    units?.temperature_2m !== '°C' || units.apparent_temperature !== '°C' || units.wind_speed_10m !== 'km/h' || units.precipitation_probability !== '%' || units.relative_humidity_2m !== '%' || units.precipitation !== 'mm') throw Error('天气数据的时区或单位不符，未使用这份预报。');
  const fields = ['temperature_2m','apparent_temperature','precipitation_probability','precipitation','relative_humidity_2m','wind_speed_10m','weather_code'];
  if (fields.some(key => !Array.isArray(hourly[key]) || hourly[key].length !== hourly.time.length)) throw Error('天气数据不完整，未使用这份预报。');
  const rows = hourly.time.map((time,i) => {
    if (!validHour(time) || i && time <= hourly.time[i-1]) throw Error('天气时间无效');
    return { time, temperature:number(hourly.temperature_2m[i],-70,65), feelsLike:number(hourly.apparent_temperature[i],-90,85),
      rainProbability:number(hourly.precipitation_probability[i],0,100), precipitation:number(hourly.precipitation[i],0,1000),
      humidity:number(hourly.relative_humidity_2m[i],0,100), wind:number(hourly.wind_speed_10m[i],0,500), code:number(hourly.weather_code[i],0,99) };
  });
  if (!rows.some(row => row.temperature !== null)) throw Error('天气温度暂不可读');
  const weather = { version:1, source:'Open-Meteo', timezone:'Asia/Shanghai', location, fetchedAt:now.toISOString(), hours:rows };
  if (!validWeather(weather) || weatherStatus(weather,now) === 'expired') throw Error('预报已过期，未使用这份数据');
  return weather;
}
export function validWeather(value) {
  return value?.version === 1 && value.source === 'Open-Meteo' && value.timezone === 'Asia/Shanghai' && Number.isFinite(Date.parse(value.fetchedAt)) &&
    typeof value.location?.name === 'string' && value.location.name.length > 0 && value.location.name.length <= 80 && number(value.location.latitude,-90,90) !== null && number(value.location.longitude,-180,180) !== null &&
    Array.isArray(value.hours) && value.hours.length > 0 && value.hours.length <= 96 && value.hours.some(row=>row?.temperature !== null) && value.hours.every((row,i) =>
      row && validHour(row.time) && (!i || row.time > value.hours[i-1].time) && Object.entries(bounds).every(([key,[min,max]])=>row[key] === null || number(row[key],min,max) !== null));
}
export function weatherStatus(weather,now=new Date()) {
  if (!validWeather(weather)) return 'missing';
  const age = +now-Date.parse(weather.fetchedAt);
  if (age < -300000 || age > WEATHER_MAX_AGE || Date.parse(weather.hours.at(-1).time+':00+08:00')+3600000 <= +now) return 'expired';
  return age > WEATHER_TTL ? 'stale' : 'fresh';
}
export function weatherDay(weather,date,{now=new Date(),from='08:00',to='20:00'}={}) {
  const status = weatherStatus(weather,now);
  if (status === 'missing' || status === 'expired') return null;
  const rows = weather.hours.filter(row=>row.time.startsWith(date+'T') && row.time.slice(11)>=from && row.time.slice(11)<=to);
  return summarizeDay(weather,date,rows,status,from,to);
}
function summarizeDay(weather,date,rows,status,from,to) {
  const values = key => rows.map(row=>row[key]).filter(value=>value!==null);
  if (!rows.length || !values('temperature').length) return null;
  const min = key => values(key).length ? Math.min(...values(key)) : null;
  const max = key => values(key).length ? Math.max(...values(key)) : null;
  return { date, from, to, status, location:weather.location.name, fetchedAt:weather.fetchedAt, rows,
    min:min('temperature'), max:max('temperature'), feelsMin:min('feelsLike'), feelsMax:max('feelsLike'), rainProbability:max('rainProbability'), wind:max('wind'), humidity:max('humidity') };
}
const clockMinutes = value => typeof value==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0,2))*60+Number(value.slice(3)) : null;
// Hourly samples describe the hours overlapping a real activity window. Keep
// disjoint classes separate so rain/cold in the free interval cannot decide PE clothes.
export function weatherIntervals(weather,date,intervals,{now=new Date()}={}) {
  const status=weatherStatus(weather,now);
  if(status==='missing'||status==='expired'||!Array.isArray(intervals)||!intervals.length)return null;
  const windows=intervals.map(row=>({from:row?.from,to:row?.to,start:clockMinutes(row?.from),end:clockMinutes(row?.to)}));
  if(windows.some(row=>row.start===null||row.end===null||row.end<=row.start))return null;
  windows.sort((a,b)=>a.start-b.start||a.end-b.end);
  const rows=weather.hours.filter(row=>row.time.startsWith(date+'T')&&windows.some(window=>{
    const start=clockMinutes(row.time.slice(11));return start<window.end&&start+60>window.start;
  }));
  const result=summarizeDay(weather,date,rows,status,windows[0].from,windows.reduce((last,row)=>row.end>last.end?row:last).to);
  return result?{...result,intervals:windows.map(({from,to})=>({from,to}))}:null;
}
export function weatherSummary(day) {
  if (!day) return '天气尚未更新';
  const rain = day.rainProbability;
  return `${Math.round(day.min)}—${Math.round(day.max)}°C${rain === null ? '' : ` · 降雨概率最高${Math.round(rain)}%`}${day.status === 'stale' ? ' · 旧预报' : ''}`;
}
export function weatherFacts(weather,now=new Date()) {
  if(weatherStatus(weather,now)!=='fresh')return [];
  const today=new Date(+now+8*3600000).toISOString().slice(0,10),tomorrow=new Date(+now+32*3600000).toISOString().slice(0,10);
  return [[today,'today','今天'],[tomorrow,'tomorrow','明天']].flatMap(([date,id,label])=>{
    const day=weatherDay(weather,date,{now,from:'07:00',to:'22:00'});
    return day?[{id:`weather:${id}`,text:`${label}${date} ${day.from}—${day.to}区域预报（${day.location}）：${weatherSummary(day)}${day.feelsMin===null?'':`；体感最低${Math.round(day.feelsMin)}°C`}。降雨概率不是必然下雨，不代表实时定位或楼宇天气。`.slice(0,350)}]:[];
  });
}
