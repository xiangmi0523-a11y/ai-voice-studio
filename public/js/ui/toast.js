import { h, qs } from '../core/dom.js';

const DISPLAY_MS = 2600;
const MAX_VISIBLE = 2;

export function showToast(message) {
  const region = qs('#toast-region');
  if (!region) return;
  const toast = h('div', { class: 'toast' }, message);
  region.append(toast);
  while (region.children.length > MAX_VISIBLE) region.firstElementChild.remove();
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 250);
  }, DISPLAY_MS);
}
