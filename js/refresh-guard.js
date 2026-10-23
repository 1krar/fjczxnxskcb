// Coalesce routine refreshes, without interrupting an editor or a pending preview.
export function createRefreshGate({ canRefresh, refresh, pending = () => {}, enqueue = queueMicrotask }) {
  const reasons = new Set();
  let queued = false;
  function flush() {
    if (!reasons.size || queued) return;
    queued = true;
    enqueue(() => {
      queued = false;
      if (!reasons.size || !canRefresh()) return;
      const ready = [...reasons];
      reasons.clear(); pending([]); refresh(ready);
    });
  }
  return {
    request(reason) { reasons.add(reason); pending([...reasons]); flush(); },
    flush,
    clear() { reasons.clear(); pending([]); },
    get waiting() { return reasons.size > 0; },
  };
}

export function markFormSaved(form) {
  form?.dispatchEvent(new Event('app:form-saved', { bubbles: true }));
}

export function trackEditors(doc, onSettled) {
  const dirty = new WeakSet();
  const activeSurface = node => node?.isConnected && (
    node.closest('dialog') ? node.closest('dialog').open : !!node.closest('.page-view.active')
  );
  const change = event => {
    const control=event.target;
    if (control.closest?.('[data-refresh-safe]')) return;
    const form=control.closest?.('form');
    if (form && activeSurface(form)) dirty.add(form);
    onSettled();
  };
  const saved = event => { dirty.delete(event.target); onSettled(); };
  const listeners = [['input',change,true],['change',change,true],['reset',saved],['app:form-saved',saved],
    ['close',onSettled,true],['focusout',onSettled],['click',onSettled],['app:editor-closed',onSettled]];
  for (const args of listeners) doc.addEventListener(...args);
  return {
    busy() {
      if (doc.querySelector('dialog[open], .detail-overlay.open')) return true;
      if (doc.querySelector('.page-view.active [aria-busy="true"]')) return true;
      for (const form of doc.querySelectorAll('.page-view.active form')) {
        if (activeSurface(form) && (dirty.has(form) || form.getAttribute('aria-busy')==='true')) return true;
      }
      for (const node of doc.querySelectorAll('.page-view.active [data-refresh-block]')) {
        if (!node.hidden && (node.childElementCount || node.textContent.trim())) return true;
      }
      for (const node of doc.querySelectorAll('.page-view.active [data-preserve-draft]')) {
        if (node.value?.trim()) return true;
      }
      const focus=doc.activeElement;
      return !!(activeSurface(focus) && !focus.closest('[data-refresh-safe]') &&
        focus.matches('textarea,select,input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),[contenteditable=true]'));
    },
    destroy() { for (const args of listeners) doc.removeEventListener(...args); },
  };
}
