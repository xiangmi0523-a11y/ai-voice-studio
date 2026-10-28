// 收藏音色
//
// 第一阶段使用 localAdapter（仅当前浏览器）。第二阶段新增 remoteAdapter，
// 通过 api.getFavorites / addFavorite / removeFavorite 读写 Supabase，
// 界面层只依赖本模块暴露的方法，无需改动。

import { STORAGE_KEYS } from '../config.js';

export function createLocalFavoritesAdapter(localStore) {
  return {
    kind: 'local',
    load: () => {
      const list = localStore.read(STORAGE_KEYS.favorites, []);
      return Array.isArray(list) ? list.filter((f) => f && typeof f.voiceId === 'string') : [];
    },
    save: (list) => localStore.write(STORAGE_KEYS.favorites, list),
  };
}

export function createFavoritesStore(adapter, { now = () => new Date().toISOString() } = {}) {
  let items = adapter.load();
  const listeners = new Set();

  function commit(next) {
    items = next;
    adapter.save(items);
    for (const fn of listeners) fn(items);
  }

  return {
    kind: adapter.kind,
    list: () => items,
    has: (voiceId) => items.some((f) => f.voiceId === voiceId),
    add(voice) {
      if (items.some((f) => f.voiceId === voice.id)) return;
      commit([{ voiceId: voice.id, voiceName: voice.name, createdAt: now() }, ...items]);
    },
    remove(voiceId) {
      commit(items.filter((f) => f.voiceId !== voiceId));
    },
    toggle(voice) {
      if (items.some((f) => f.voiceId === voice.id)) this.remove(voice.id);
      else this.add(voice);
      return this.has(voice.id);
    },
    clear() {
      commit([]);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
