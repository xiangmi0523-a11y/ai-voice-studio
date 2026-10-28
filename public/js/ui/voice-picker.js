// 音色选择弹层：搜索、筛选、选择、试听、收藏

import { clear, h, qs } from '../core/dom.js';
import { filterVoices, VOICE_FILTERS } from '../services/voices.js';
import { renderChips } from './chips.js';
import { initSheet } from './sheet.js';
import { showToast } from './toast.js';
import { renderVoiceItem } from './voice-item.js';
import { previewVoice } from './voice-preview.js';

export function initVoicePicker({ store, favorites }) {
  const dialog = qs('#voice-sheet');
  const list = qs('#voice-list');
  const search = qs('#voice-search');
  const chips = qs('#voice-filter');
  const note = qs('#voice-source-note');
  const sheet = initSheet(dialog);

  let query = '';
  let filter = 'all';

  function render() {
    const { voices, voicesSource, selectedVoiceId } = store.get();
    note.textContent =
      voicesSource === 'demo'
        ? 'DEMO 音色：音色服务尚未接入，以下为虚构示例，用于演示选择与收藏交互。'
        : '音色来自语音服务。';
    note.hidden = false;

    renderChips(chips, VOICE_FILTERS, filter, (value) => {
      filter = value;
      render();
    });

    clear(list);
    const visible = filterVoices(voices, { query, filter });
    if (!voices.length) {
      // 服务端没有公开任何音色（未配置、配置无效或没有获准音色）：不是搜索无结果
      list.append(
        h('li', { class: 'empty empty--compact' },
          h('p', { class: 'empty__title' }, '当前没有可用音色'),
          h('p', { class: 'empty__desc' }, '请检查服务端的音色配置'),
        ),
      );
      return;
    }
    if (!visible.length) {
      list.append(
        h('li', { class: 'empty empty--compact' },
          h('p', { class: 'empty__title' }, '没有找到匹配的音色'),
          h('p', { class: 'empty__desc' }, '换个关键词或筛选条件试试'),
        ),
      );
      return;
    }
    for (const voice of visible) {
      list.append(
        renderVoiceItem(voice, {
          selected: voice.id === selectedVoiceId,
          favorite: favorites.has(voice.id),
          selectLabel: '选择',
          onSelect: (v) => {
            store.set({ selectedVoiceId: v.id });
            sheet.close();
          },
          onToggleFavorite: (v) => {
            const added = favorites.toggle(v);
            showToast(added ? `已收藏「${v.name}」` : `已取消收藏「${v.name}」`);
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

  store.subscribe(() => {
    if (sheet.isOpen) render();
  });
  favorites.subscribe(() => {
    if (sheet.isOpen) render();
  });

  return {
    open() {
      render();
      sheet.open();
    },
  };
}
