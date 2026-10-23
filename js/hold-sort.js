const moveAnimations = new WeakMap();
// Animate existing nodes only. The DOM order changes immediately for keyboard and reading order.
export function animateReorder(list, change, excluded = null) {
  const nodes = [...list.children];
  const positions = new Map(nodes.map(node => [node, node.getBoundingClientRect().top]));
  change();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const node of nodes) {
    if (node === excluded || !node.isConnected || !node.animate) continue;
    moveAnimations.get(node)?.cancel();
    const offset = positions.get(node) - node.getBoundingClientRect().top;
    if (Math.abs(offset) < 1) continue;
    moveAnimations.set(node, node.animate([{transform:`translateY(${offset}px)`},{transform:'translateY(0)'}], {duration:180,easing:'cubic-bezier(.2,.7,.2,1)'}));
  }
}

// Keep ordinary touch scrolling until the user holds still for a moment.
export function setupHoldSort(list, {onCommit, announce}) {
  let gesture=null,timer=0,frame=0;
  const rows=()=>[...list.querySelectorAll('[data-personal-id]')];
  const ids=()=>rows().map(row=>row.dataset.personalId);
  function restore(order) {
    const byId=new Map(rows().map(row=>[row.dataset.personalId,row]));
    for(const id of order)if(byId.has(id))list.append(byId.get(id));
  }
  function place(y) {
    const target=rows().find(row=>row!==gesture.row&&y<row.getBoundingClientRect().top+row.getBoundingClientRect().height/2);
    if ((target || null) === gesture.row.nextElementSibling) return;
    animateReorder(list,()=>{if(target)list.insertBefore(gesture.row,target);else list.append(gesture.row);},gesture.row);
  }
  function scroll() {
    if(!gesture?.active)return;
    const edge=70,bottom=innerHeight-90;
    const step=gesture.y<edge?-8:gesture.y>bottom?8:0;
    if(step){window.scrollBy(0,step);place(gesture.y);}
    frame=requestAnimationFrame(scroll);
  }
  function finish(cancel=false) {
    clearTimeout(timer);cancelAnimationFrame(frame);
    const current=gesture;gesture=null;
    if(!current)return;
    current.row.classList.remove('is-dragging');list.classList.remove('is-reordering');
    current.row.querySelector('[data-drag-handle]')?.setAttribute('aria-pressed','false');
    if(current.pointerId!==undefined&&list.hasPointerCapture?.(current.pointerId))list.releasePointerCapture(current.pointerId);
    if(!current.active)return;
    list.dataset.ignoreSortClick=String(Date.now()+600);
    if(cancel){restore(current.order);announce('已取消排序');return;}
    const order=ids();
    if(order.join('\0')!==current.order.join('\0')){
      try{onCommit(order,current.row.dataset.personalId);}catch(error){restore(current.order);announce(error.message);}
    }else announce('顺序未改变');
  }
  function start(target,x,y,pointerId) {
    if(gesture)return;
    const row=target.closest('[data-personal-id]');if(!row||!list.contains(row))return;
    const control=target.closest('button,a,input,select,textarea,summary');
    if(control&&!control.matches('[data-drag-handle],[data-item-action="edit"]'))return;
    gesture={row,x,y,startX:x,startY:y,pointerId,active:false,order:ids()};
    timer=setTimeout(()=>{
      if(!gesture)return;
      gesture.active=true;row.classList.add('is-dragging');list.classList.add('is-reordering');
      row.querySelector('[data-drag-handle]')?.setAttribute('aria-pressed','true');
      if(pointerId!==undefined)list.setPointerCapture(pointerId);
      announce('已拿起，向上或向下拖动；松手保存。');scroll();
    },450);
  }
  function move(x,y,event) {
    if(!gesture)return;
    if(!gesture.active){if(Math.hypot(x-gesture.startX,y-gesture.startY)>10)finish(true);return;}
    if(event.cancelable)event.preventDefault();gesture.y=y;place(y);
  }
  const pointerDown=event=>{if(event.pointerType!=='touch'&&event.isPrimary&&event.button===0)start(event.target,event.clientX,event.clientY,event.pointerId);};
  const pointerMove=event=>{if(gesture?.pointerId===event.pointerId)move(event.clientX,event.clientY,event);};
  const pointerUp=event=>{if(gesture?.pointerId===event.pointerId)finish();};
  const pointerCancel=event=>{if(gesture?.pointerId===event.pointerId)finish(true);};
  const touchStart=event=>{if(event.touches.length!==1){finish(true);return;}const touch=event.touches[0];start(event.target,touch.clientX,touch.clientY);};
  const touchMove=event=>{if(event.touches.length!==1){finish(true);return;}const touch=event.touches[0];move(touch.clientX,touch.clientY,event);};
  const touchEnd=event=>{if(gesture?.active&&event.cancelable)event.preventDefault();finish();};
  const touchCancel=()=>finish(true);
  const contextMenu=event=>{if(gesture?.active)event.preventDefault();};
  const click=event=>{if(Number(list.dataset.ignoreSortClick)>Date.now()){event.preventDefault();event.stopImmediatePropagation();delete list.dataset.ignoreSortClick;}};
  const keyDown=event=>{
    if(event.key==='Escape'&&gesture){event.preventDefault();finish(true);return;}
    const handle=event.target.closest('[data-drag-handle]');
    if(!handle||!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const row=handle.closest('[data-personal-id]'),order=ids(),index=order.indexOf(row.dataset.personalId),next=index+(event.key==='ArrowUp'?-1:1);
    if(next<0||next>=order.length)return;
    [order[index],order[next]]=[order[next],order[index]];
    try{onCommit(order,row.dataset.personalId);}catch(error){announce(error.message);}
  };
  const escape=event=>{if(event.key==='Escape'&&gesture){event.preventDefault();finish(true);}};
  const blur=()=>finish(true);
  const listeners=[['pointerdown',pointerDown],
    ['touchstart',touchStart,{passive:true}],['touchmove',touchMove,{passive:false}],['touchend',touchEnd,{passive:false}],['touchcancel',touchCancel],
    ['contextmenu',contextMenu],['click',click,true],['keydown',keyDown]];
  for(const args of listeners)list.addEventListener(...args);
  const documentListeners=[['pointermove',pointerMove],['pointerup',pointerUp],['pointercancel',pointerCancel],['keydown',escape]];
  for(const args of documentListeners)document.addEventListener(...args);
  window.addEventListener('blur',blur);
  return {get active(){return !!gesture;},destroy(){finish(true);for(const args of listeners)list.removeEventListener(...args);for(const args of documentListeners)document.removeEventListener(...args);window.removeEventListener('blur',blur);}};
}
