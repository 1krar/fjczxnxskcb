import { DEFAULT_WEATHER_LOCATION, forecastURL, geocodingURL, isDefaultWeatherCity, weatherCity, searchedLocation, normalizeWeather, validWeather, weatherStatus, WEATHER_MAX_AGE } from '../js/weather-model.js';
const inFlight = new Map();
const reply = (value,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function getJSON(url,fetcher) {
  const response = await fetcher(url,{signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});
  if (!response.ok) throw Error('天气服务暂不可用');
  const text = await response.text();
  if (text.length > 160000) throw Error('天气数据过大');
  return JSON.parse(text);
}
export async function handleWeather(request,{fetcher=fetch,cache=globalThis.caches?.default,now=new Date()}={}) {
  if (request.method !== 'GET') return reply({error:'不支持的请求方式'},405);
  const url = new URL(request.url), origin = request.headers.get('Origin');
  if (origin && origin !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return reply({error:'不支持跨站调用'},403);
  const city = weatherCity(url.searchParams.get('city'));
  if ((url.searchParams.get('city') || '').length > 60) return reply({error:'地区名称过长'},400);
  const key = new Request(`${url.origin}/api/weather-cache?city=${encodeURIComponent(isDefaultWeatherCity(city)?'fuzhou-cangshan':city)}`);
  let old = null;
  try { const hit=await cache?.match(key); if(hit){const value=await hit.json();if(validWeather(value.weather))old=value.weather;} } catch { /* Optional cache failure must not prevent a forecast. */ }
  if (weatherStatus(old,now) === 'fresh') return reply({weather:old});
  const id = key.url;
  if (!inFlight.has(id)) {
    const work = (async()=>{
      const location = isDefaultWeatherCity(city) ? DEFAULT_WEATHER_LOCATION : searchedLocation(await getJSON(geocodingURL(city),fetcher));
      const weather = normalizeWeather(await getJSON(forecastURL(location),fetcher),location,now);
      try { await cache?.put(key,Response.json({weather},{headers:{'Cache-Control':`public,max-age=${WEATHER_MAX_AGE/1000}`}})); } catch { /* Forecast still works without edge cache. */ }
      return weather;
    })();
    inFlight.set(id,work); work.finally(()=>inFlight.delete(id)).catch(()=>{});
  }
  try { return reply({weather:await inFlight.get(id)}); }
  catch { return ['fresh','stale'].includes(weatherStatus(old,now)) ? reply({weather:old,warning:'暂时无法更新，保留旧预报。'}) : reply({error:'天气暂时无法更新，稍后可重试。'},502); }
}
