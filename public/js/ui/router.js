// 底部 Tab 导航，基于 location.hash，支持浏览器返回

import { qs, qsa } from '../core/dom.js';

export const VIEWS = Object.freeze(['create', 'history', 'favorites', 'settings']);

export function initRouter({ onChange } = {}) {
  const tabs = qsa('[data-tab]');

  function show(view, { focus = false } = {}) {
    const target = VIEWS.includes(view) ? view : 'create';
    for (const section of qsa('[data-view]')) section.hidden = section.dataset.view !== target;
    for (const tab of tabs) {
      if (tab.dataset.tab === target) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    window.scrollTo({ top: 0 });
    if (focus) {
      const title = qs(`#title-${target}`);
      title?.setAttribute('tabindex', '-1');
      title?.focus({ preventScroll: true });
    }
    onChange?.(target);
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const view = tab.dataset.tab;
      if (location.hash !== `#${view}`) history.pushState(null, '', `#${view}`);
      show(view, { focus: true });
    });
  }

  window.addEventListener('popstate', () => show(location.hash.slice(1)));
  show(location.hash.slice(1));

  return {
    go(view) {
      if (location.hash !== `#${view}`) history.pushState(null, '', `#${view}`);
      show(view, { focus: true });
    },
  };
}
