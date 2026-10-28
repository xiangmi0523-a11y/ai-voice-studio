// 音色条目，音色选择弹层和收藏页共用

import { h, icon, ICONS } from '../core/dom.js';

export function renderVoiceItem(voice, { selected = false, favorite = false, onSelect, onToggleFavorite, onPreview, selectLabel }) {
  const initial = [...voice.name][0] || '?';

  const main = h(
    'button',
    { type: 'button', class: 'voice-item__main', onclick: () => onSelect?.(voice), 'aria-label': selectLabel ? `${selectLabel}：${voice.name}` : undefined },
    h('span', { class: 'voice-item__avatar', 'aria-hidden': 'true' }, initial),
    h(
      'span',
      { class: 'voice-item__text' },
      h('span', { class: 'voice-item__name' }, voice.name, voice.isDemo ? h('span', { class: 'pill pill--demo' }, 'DEMO') : null),
      h('span', { class: 'voice-item__desc' }, voice.description || ''),
      h('span', { class: 'voice-item__tags' }, [voice.language, ...(voice.tags || [])].filter(Boolean).map((t) => h('span', { class: 'badge' }, t))),
    ),
    selected ? icon(ICONS.check, 'icon voice-item__check') : null,
  );

  const preview = h(
    'button',
    { type: 'button', class: 'icon-btn icon-btn--small', 'aria-label': `试听 ${voice.name}`, onclick: () => onPreview?.(voice) },
    icon(ICONS.play),
  );

  const fav = h(
    'button',
    {
      type: 'button',
      class: 'icon-btn icon-btn--small favorite-btn',
      'aria-pressed': String(favorite),
      'aria-label': favorite ? `取消收藏 ${voice.name}` : `收藏 ${voice.name}`,
      onclick: () => onToggleFavorite?.(voice),
    },
    icon(ICONS.star),
  );

  return h('li', { class: `voice-item${selected ? ' is-selected' : ''}`, dataset: { voiceId: voice.id } }, main, preview, fav);
}
