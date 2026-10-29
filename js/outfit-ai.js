// Candidate IDs map back to real wardrobe pieces; the model never edits availability.
export function outfitAIInput(plan, purpose, preference = '', profile = {}) {
  const fit = purpose === 'sport' ? plan.sport : plan.daily;
  const weather=Object.hasOwn(fit,'weather')?fit.weather:purpose==='sport'&&Object.hasOwn(plan,'sportWeather')?plan.sportWeather:plan.weather;
  return {
    date:fit.date, purpose:purpose === 'sport' ? '运动准备' : plan.separate ? '日常穿搭，运动前另换装' : plan.sportNeeded ? '全天兼顾运动' : '日常穿搭',
    preference:String(preference).trim().slice(0,300), thermalPreference:profile.thermalPreference || 'unknown',
    requirements:{ shorts:fit.requireShorts, running:fit.run || fit.pe },
    weather:weather ? { date:weather.date, from:weather.from, to:weather.to, min:weather.min, max:weather.max, feelsMin:weather.feelsMin, feelsMax:weather.feelsMax, rainProbability:weather.rainProbability, status:weather.status } : null,
    weatherNote:fit.weatherNote||'',
    planning:plan.planning ? {
      laundryAssumption:plan.planning.laundryAssumption,
      laundryReturnDate:plan.planning.laundryReturnDate,
      comparison:plan.planning.weatherComparison?.text || '',
      reservations:plan.planning.reservations.slice(0,8).map(row=>row.text),
    } : null,
    candidates:fit.candidates.map((set,index)=>({ id:`set:${index}`, pieces:set.pieces.map(item=>({ id:item.id, name:item.name, category:item.category, color:item.color, warmth:item.warmth, preference:item.preference, wetWeather:item.wetWeather })), reasons:set.reasons, score:set.score, scoreReasons:set.scoreReasons||[] })),
  };
}
export function applyOutfitChoice(input, fit, result) {
  const index=input.candidates.findIndex(row=>row.id===result?.choiceId);
  if(index<0 || typeof result.explanation!=='string' || !result.explanation.trim() || result.explanation.length>200) throw Error('AI未选中现有搭配，继续显示当前方案。');
  const set=fit.candidates[index];
  if(!set || set.conditionalIds.length) throw Error('候选已变化，请重新挑选。');
  return {set,explanation:result.explanation.trim()};
}
