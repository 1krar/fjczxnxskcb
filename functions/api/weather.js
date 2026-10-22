import { handleWeather } from '../../server/weather-service.js';
export function onRequest(context) { return handleWeather(context.request); }
