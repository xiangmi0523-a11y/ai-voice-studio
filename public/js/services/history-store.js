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

// 历史状态的展示文案。DEMO 记录一律带“示例”前缀并使用中性样式，
// 避免把没有真实音频的示例误认为真实生成成功。
const STATUS_DISPLAY = {
  succeeded: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  processing: { label: '处理中', tone: 'pending' },
  pending: { label: '排队中', tone: 'pending' },
};

const DEMO_STATUS_DISPLAY = {
  succeeded: { label: '示例完成', tone: 'demo' },
  failed: { label: '示例失败', tone: 'demo' },
  processing: { label: '示例处理中', tone: 'demo' },
  pending: { label: '示例排队中', tone: 'demo' },
};

export function getHistoryStatusDisplay(item) {
  const table = item?.isDemo ? DEMO_STATUS_DISPLAY : STATUS_DISPLAY;
  return table[item?.status] || { label: item?.isDemo ? '示例记录' : String(item?.status ?? '未知'), tone: item?.isDemo ? 'demo' : 'neutral' };
}
