// 收藏页：搜索、筛选、取消收藏、一键选用

import { clear, h, icon, ICONS, qs } from '../core/dom.js';
import { filterVoices, VOICE_FILTERS } from '../services/voices.js';
import { renderChips } from './chips.js';
import { showToast } from './toast.js';
import { renderVoiceItem } from './voice-item.js';
import { previewVoice } from './voice-preview.js';

export function initFavoritesView({ store, favorites, voicePicker, onUseVoice }) {
  const list = qs('#favorites-list');
  const empty = qs('#favorites-empty');
  const search = qs('#favorites-search');
  const chips = qs('#favorites-filter');
  let query = '';
  let filter = 'all';

  function render() {
    const { voices, selectedVoiceId } = store.get();
    const byId = new Map(voices.map((v) => [v.id, v]));
    // 收藏里可能有当前音色列表中不存在的条目，保留名称以便取消收藏
    const favVoices = favorites.list().map(
      (f) => byId.get(f.voiceId) || { id: f.voiceId, name: f.voiceName, description: '该音色当前不可用', tags: [], isDemo: false },
    );
    const visible = filterVoices(favVoices, { query, filter });

    renderChips(chips, VOICE_FILTERS, filter, (value) => {
      filter = value;
      render();
    });

    clear(list);
    clear(empty);
    list.hidden = visible.length === 0;

    if (!favVoices.length) {
      empty.append(
        h('div', { class: 'card empty' },
          icon(ICONS.star, 'empty__icon'),
          h('p', { class: 'empty__title' }, '还没有收藏的音色'),
          h('p', { class: 'empty__desc' }, '在音色列表中点击星标即可收藏'),
          h('button', { type: 'button', class: 'btn btn--primary btn--small', onclick: () => voicePicker.open() }, '去挑选音色'),
        ),
      );
      return;
    }
    if (!visible.length) {
      empty.append(
        h('div', { class: 'card empty empty--compact' },
          h('p', { class: 'empty__title' }, '没有符合条件的收藏'),
          h('p', { class: 'empty__desc' }, '换个关键词或筛选条件试试'),
        ),
      );
      return;
    }

    for (const voice of visible) {
      list.append(
        renderVoiceItem(voice, {
          selected: voice.id === selectedVoiceId,
          favorite: true,
          selectLabel: '使用',
          onSelect: (v) => {
            if (!byId.has(v.id)) {
              showToast('该音色当前不可用');
              return;
            }
            onUseVoice(v);
          },
          onToggleFavorite: (v) => {
            favorites.remove(v.id);
            showToast(`已取消收藏「${v.name}」`);
          },
          onPreview: previewVoice,
        }),
      );
    }
  }

  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  favorites.subscribe(render);
  store.subscribe(render);
  render();
}
