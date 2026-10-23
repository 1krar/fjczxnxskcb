import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const storage=new Map(), dataset={}, style={}, listeners={},media={};
const window={matchMedia:query=>media[query]??=( {matches:false,addEventListener:(_,fn)=>listeners[query]=fn} ),addEventListener:()=>{},dispatchEvent:()=>{}};
vm.runInNewContext(readFileSync(new URL('../js/display.js',import.meta.url),'utf8'),{
  window,document:{documentElement:{dataset,style},querySelector:()=>null},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},CustomEvent:class{},
});
assert.equal(dataset.theme,'light');
media['(prefers-color-scheme: dark)'].matches=true;listeners['(prefers-color-scheme: dark)']();
assert.equal(dataset.theme,'dark','system changes update the application');
window.CourseDisplay.save({theme:'light',textSize:'maximum'});
assert.equal(dataset.theme,'light','explicit light mode overrides a dark system');
assert.equal(dataset.textSize,'maximum');
media['(prefers-reduced-motion: reduce)'].matches=true;listeners['(prefers-reduced-motion: reduce)']();
assert.equal(dataset.motion,'reduce','a system accessibility preference is never overridden by extra motion');
assert.throws(()=>window.CourseDisplay.save({theme:'injected'}));
storage.set('course-dashboard-display-v1','not json');window.CourseDisplay.apply();
assert.equal(dataset.theme,'dark','damaged optional display preferences fall back safely');
console.log('Display persistence, system preferences and validation passed.');
