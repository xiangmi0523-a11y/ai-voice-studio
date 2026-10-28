// 历史记录
//
// 云端历史和 DEMO 历史是两条完全独立的数据源：
// * remote：只通过 /api/history 读取，第一阶段返回 NOT_IMPLEMENTED
// * demo：只存在浏览器本地，带 isDemo 标记，删除等操作永远不会请求服务端

import { STORAGE_KEYS } from '../config.js';
import { createDemoHistory } from './demo-data.js';

export function createDemoHistoryStore(localStore, { seed = createDemoHistory } = {}) {
  const listeners = new Set();

  function load() {
    const saved = localStore.read(STORAGE_KEYS.demoHistory, null);
    if (Array.isArray(saved)) return saved.filter((item) => item?.isDemo === true);
    const seeded = seed();
    localStore.write(STORAGE_KEYS.demoHistory, seeded);
    return seeded;
  }

  let items = load();

  function commit(next) {
    items = next;
    localStore.write(STORAGE_KEYS.demoHistory, items);
    for (const fn of listeners) fn(items);
  }

  return {
    list: () => items,
    get: (id) => items.find((item) => item.id === id) || null,
    remove(id) {
      commit(items.filter((item) => item.id !== id));
    },
    reset() {
      commit(seed());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export async function fetchRemoteHistory(apiClient) {
  const result = await apiClient.getHistory({ limit: 20 });
  if (result.ok) return { state: 'ready', items: (result.data?.items || []).map((i) => ({ ...i, isDemo: false })) };
  if (result.error?.code === 'NOT_IMPLEMENTED') return { state: 'not_implemented', error: result.error };
  return { state: 'error', error: result.error };
}
