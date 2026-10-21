// Horizontal dismissal leaves vertical scrolling and system edge navigation available.
export function setupSwipeDismiss(element, onDismiss) {
  let pointer = null, suppressUntil = 0;
  function reset() { element.style.transform = ''; element.classList.remove('is-swiping'); }
  function down(event) {
    if (event.button !== 0 || !event.isPrimary || !event.target.closest('summary') || event.clientX < 24 || event.clientX > window.innerWidth - 24) return;
    pointer = { id:event.pointerId, x:event.clientX, y:event.clientY, dx:0, horizontal:false };
  }
  function move(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!pointer.horizontal && Math.max(Math.abs(dx), Math.abs(dy)) > 12) {
      if (Math.abs(dx) < Math.abs(dy) * 1.4) { pointer = null; return; }
      pointer.horizontal = true; element.setPointerCapture(event.pointerId); element.classList.add('is-swiping');
    }
    if (pointer.horizontal) { pointer.dx = dx; element.style.transform = `translateX(${dx}px)`; }
  }
  function finish(event, cancelled = false) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const last = pointer; pointer = null;
    if (last.horizontal) suppressUntil = Date.now() + 500;
    reset();
    if (!cancelled && Math.abs(last.dx) >= Math.max(50, element.clientWidth * 0.23)) onDismiss();
  }
  const up = event => finish(event), cancel = event => finish(event, true);
  const blur = () => { pointer = null; reset(); };
  const click = event => { if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); } };
  element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move);
  element.addEventListener('click', click, true);
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('blur', blur);
  return () => {
    blur(); element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move); element.removeEventListener('click', click, true);
    window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', blur);
  };
}
