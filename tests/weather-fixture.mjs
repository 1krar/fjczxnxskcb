import { normalizeWeather, DEFAULT_WEATHER_LOCATION } from '../js/weather-model.js';
export function rawForecast(date='2026-10-22', days=3) {
  const start=Date.parse(date+'T00:00:00Z');
  const time=Array.from({length:days*24},(_,i)=>new Date(start+i*3600000).toISOString().slice(0,16));
  const fill=value=>time.map(()=>value);
  return {timezone:'Asia/Shanghai',generationtime_ms:5,hourly_units:{temperature_2m:'°C',apparent_temperature:'°C',precipitation_probability:'%',precipitation:'mm',relative_humidity_2m:'%',wind_speed_10m:'km/h'},hourly:{time,temperature_2m:fill(21),apparent_temperature:fill(19),precipitation_probability:fill(60),precipitation:fill(0),relative_humidity_2m:fill(85),wind_speed_10m:fill(12),weather_code:fill(3)}};
}
export function forecast(now=new Date('2026-10-22T08:00:00+08:00'),date='2026-10-22') {return normalizeWeather(rawForecast(date),DEFAULT_WEATHER_LOCATION,now);}
