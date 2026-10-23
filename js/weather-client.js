import { DEFAULT_WEATHER_LOCATION, forecastURL, geocodingURL, isDefaultWeatherCity, weatherCity, searchedLocation, normalizeWeather, validWeather, weatherStatus, WEATHER_TTL } from './weather-model.js?v=20261023-2';
export const WEATHER_KEY = 'course-dashboard-weather-v1';
const pending = new Map(), cooldown = new Map();
let memory = null;
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===WEATHER_KEY||event.key===null){memory=null;window.dispatchEvent(new CustomEvent('weather:changed'));}});
const cityKey = city => isDefaultWeatherCity(city) ? '福州仓山' : weatherCity(city);
export function cachedWeather(city='') {
  const key = cityKey(city);
  if (memory?.city === key && validWeather(memory.weather)) return memory.weather;
  try { const value=JSON.parse(localStorage.getItem(WEATHER_KEY)||'null');if(value?.city===key&&validWeather(value.weather)){memory=value;return value.weather;} } catch { /* A forecast cache never replaces wardrobe data. */ }
  return null;
}
async function json(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
  if (!response.ok) { const error=Error('天气暂时无法更新');error.status=response.status;throw error; }
  return response.json();
}
export function refreshWeather(city='',manual=false) {
  const key=cityKey(city), old=cachedWeather(city), now=Date.now();
  if(pending.has(key))return pending.get(key);
  if(!manual && old && weatherStatus(old)==='fresh')return Promise.resolve(old);
  if(now-(cooldown.get(key)||0)<(manual?60000:WEATHER_TTL))return manual?Promise.reject(Error('这分钟已经检查过天气，请稍后再刷新。')):old?Promise.resolve(old):Promise.reject(Error('请稍后再刷新天气。'));
  cooldown.set(key,now);
  const work=(async()=>{
    let value;
    try { value=await json('/api/weather?'+new URLSearchParams({city:weatherCity(city)})); }
    catch(error) {
      // A static localhost preview has no Pages Functions. The public forecast requires no secret.
      if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)||![404,405].includes(error.status))throw error;
      const point=isDefaultWeatherCity(city)?DEFAULT_WEATHER_LOCATION:searchedLocation(await json(geocodingURL(city)));
      value={weather:normalizeWeather(await json(forecastURL(point)),point)};
    }
    if(!validWeather(value.weather))throw Error('天气数据未能读取');
    memory={city:key,weather:value.weather};
    try{localStorage.setItem(WEATHER_KEY,JSON.stringify(memory));}catch{/* In-memory weather remains usable. */}
    window.dispatchEvent(new CustomEvent('weather:changed'));
    return value.weather;
  })();
  pending.set(key,work);work.finally(()=>pending.delete(key)).catch(()=>{});
  return work;
}
