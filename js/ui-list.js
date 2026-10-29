import { animateReorder } from './hold-sort.js?v=20261029-3';
import { reducedMotion } from './motion.js?v=20261029-3';

function departure(node, box) {
  if (!node.animate || !box.width || !box.height || box.bottom<0 || box.top>innerHeight) return;
  const copy=node.cloneNode(true);
  copy.removeAttribute('id'); copy.querySelectorAll('[id]').forEach(child=>child.removeAttribute('id'));
  copy.inert=true; copy.setAttribute('aria-hidden','true'); copy.dataset.uiExit='';
  Object.assign(copy.style,{position:'fixed',left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px',margin:'0',pointerEvents:'none',zIndex:'190'});
  document.body.append(copy);
  copy.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-4px)'}],{duration:120,easing:'ease-out'}).finished.catch(()=>{}).finally(()=>copy.remove());
}

function updateRow(row, next) {
  const details=[...row.querySelectorAll('details')], nextDetails=[...next.querySelectorAll('details')];
  details.forEach((node,index)=>{if(nextDetails[index])nextDetails[index].open=node.open;});
  const focus=row.contains(document.activeElement)?document.activeElement:null;
  const focusMarker=focus&&[...focus.attributes].find(attr=>attr.name==='id'||attr.name.startsWith('data-'));
  const summaryIndex=focus?.matches('summary')?details.indexOf(focus.parentElement):-1;
  for (const attr of [...row.attributes]) if (!next.hasAttribute(attr.name)) row.removeAttribute(attr.name);
  for (const attr of next.attributes) row.setAttribute(attr.name,attr.value);
  if (row.innerHTML===next.innerHTML) return;
  row.innerHTML=next.innerHTML;
  if (!focus) return;
  const replacement=summaryIndex>=0?row.querySelectorAll('details')[summaryIndex]?.querySelector('summary'):
    focusMarker?row.querySelector(`[${focusMarker.name}="${CSS.escape(focusMarker.value)}"]`):null;
  replacement?.focus({preventScroll:true});
}

// Keep row identity, native disclosures, delegated handlers, and reading order.
export function reconcileRows(container, markup, key) {
  const template=document.createElement('template'); template.innerHTML=markup;
  const old=[...container.children], desired=[...template.content.children], used=new Set(), entering=[];
  const identity=(node,index)=>node.getAttribute(key)||`empty:${node.tagName}:${index}`;
  const previous=new Map(old.map((node,index)=>[identity(node,index),node]));
  const animate=old.length>0&&!reducedMotion();
  const boxes=animate?new Map(old.map(node=>[node,node.getBoundingClientRect()])):null;
  const apply=()=>{
    desired.forEach((fresh,index)=>{
      const before=previous.get(identity(fresh,index));
      const row=before&&before.tagName===fresh.tagName?before:fresh;
      if (row===before) updateRow(row,fresh); else entering.push(row);
      used.add(row);
      const at=container.children[index];
      if (at!==row) container.insertBefore(row,at||null);
    });
    for (const node of old) if(!used.has(node)) { if(animate)departure(node,boxes.get(node)); node.remove(); }
  };
  if (animate) animateReorder(container,apply); else apply();
  if (animate) for(const node of entering) if(node.getClientRects().length) node.animate?.([{opacity:0},{opacity:1}],{duration:140,easing:'ease-out'});
}
