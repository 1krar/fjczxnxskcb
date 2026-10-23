// Describe a control by application keys, without retaining input values.
export function focusSelector(element) {
  if (!element || element===document.body) return '';
  if (element.id) return '#'+CSS.escape(element.id);
  const control=[...element.attributes].find(attr=>attr.name.startsWith('data-')&&!['data-refresh-safe','data-preserve-draft'].includes(attr.name));
  if (!control) return '';
  const own=`${element.tagName.toLowerCase()}[${control.name}="${CSS.escape(control.value)}"]`;
  const row=element.closest('[data-personal-id],[data-wear-id],[data-garment-id]');
  if (!row) return own;
  const key=[...row.attributes].find(attr=>['data-personal-id','data-wear-id','data-garment-id'].includes(attr.name));
  return `[${key.name}="${CSS.escape(key.value)}"] ${own}`;
}
