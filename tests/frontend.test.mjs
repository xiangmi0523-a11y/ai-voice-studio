// 前端纯逻辑模块（无 DOM）的单元测试
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultSettings, STORAGE_KEYS } from '../public/js/config.js';
import { countChars, formatDateTime, formatDuration, formatSettingValue, truncate } from '../public/js/core/format.js';
import { createLocalStore } from '../public/js/core/local-store.js';
import { createStore } from '../public/js/core/state.js';
import { createApiClient } from '../public/js/services/api-client.js';
import { createDemoHistory, DEMO_VOICES, isDemoVoiceId } from '../public/js/services/demo-data.js';
import { createFavoritesStore, createLocalFavoritesAdapter } from '../public/js/services/favorites-store.js';
import { buildGeneratePayload, createIdempotencyKeeper } from '../public/js/services/generation.js';
import { createDemoHistoryStore, fetchRemoteHistory, getHistoryStatusDisplay } from '../public/js/services/history-store.js';
import { filterVoices, loadVoices } from '../public/js/services/voices.js';
import { isUuid, validateGenerateRequest } from '../lib/validation.js';

function memoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}

const jsonResponse = (status, body) => ({ status, json: async () => body });

describe('format', () => {
  it('countChars 按码点计数', () => {
    assert.equal(countChars('你好😀'), 3);
    assert.equal(countChars(''), 0);
    assert.equal(countChars(undefined), 0);
  });
  it('truncate', () => {
    assert.equal(truncate('abcdef', 3), 'abc…');
    assert.equal(truncate('abc', 3), 'abc');
  });
  it('formatDuration', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(65.9), '1:05');
    assert.equal(formatDuration(Number.NaN), '0:00');
    assert.equal(formatDuration(Infinity), '0:00');
  });
  it('formatDateTime 相对日期', () => {
    const now = new Date(2026, 9, 28, 15, 0);
    assert.equal(formatDateTime(new Date(2026, 9, 28, 9, 5).toISOString(), now), '今天 09:05');
    assert.equal(formatDateTime(new Date(2026, 9, 27, 23, 0).toISOString(), now), '昨天 23:00');
    assert.equal(formatDateTime(new Date(2026, 0, 3, 8, 0).toISOString(), now), '1月3日 08:00');
    assert.equal(formatDateTime('bad', now), '');
  });
  it('formatSettingValue', () => {
    assert.equal(formatSettingValue('stability', 0.5), '50%');
    assert.equal(formatSettingValue('speed', 1), '1.00×');
  });
});

describe('createStore', () => {
  it('set 合并状态并通知订阅者', () => {
    const store = createStore({ a: 1, b: 2 });
    const seen = [];
    const off = store.subscribe((s) => seen.push(s.a));
    store.set({ a: 3 });
    store.set((s) => ({ a: s.a + 1 }));
    off();
    store.set({ a: 99 });
    assert.deepEqual(seen, [3, 4]);
    assert.equal(store.get().b, 2);
  });
});

describe('createLocalStore', () => {
  it('读写 JSON', () => {
    const ls = createLocalStore(memoryBackend());
    assert.equal(ls.read('x', 'fallback'), 'fallback');
    ls.write('x', { a: 1 });
    assert.deepEqual(ls.read('x'), { a: 1 });
    ls.remove('x');
    assert.equal(ls.read('x', null), null);
  });
  it('存储不可用时退化为内存，不抛错', () => {
    const broken = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    const ls = createLocalStore(broken);
    ls.write('k', 1);
    assert.equal(ls.read('k', 0), 1);
  });
  it('损坏的 JSON 返回默认值', () => {
    const backend = memoryBackend();
    backend.setItem('k', '{oops');
    assert.equal(createLocalStore(backend).read('k', 'd'), 'd');
  });
});

describe('DEMO 数据隔离', () => {
  it('所有 DEMO 音色带 isDemo 标记、无试听音频，且 ID 能通过服务端格式校验', () => {
    for (const v of DEMO_VOICES) {
      assert.equal(v.isDemo, true);
      assert.equal(v.previewUrl, null);
      assert.match(v.id, /^demo/);
    }
  });
  it('DEMO 历史带 isDemo 标记、无音频，ID 不是 UUID（不会被发往云端接口）', () => {
    for (const item of createDemoHistory()) {
      assert.equal(item.isDemo, true);
      assert.equal(item.audioUrl, null);
      assert.ok(!isUuid(item.id));
    }
  });
  it('DEMO 历史存储：删除、重置，且过滤掉非 DEMO 条目', () => {
    const backend = memoryBackend();
    const ls = createLocalStore(backend);
    ls.write(STORAGE_KEYS.demoHistory, [{ id: 'x', isDemo: false }, { id: 'demo-1', isDemo: true }]);
    const store = createDemoHistoryStore(ls);
    assert.deepEqual(store.list().map((i) => i.id), ['demo-1']);
    store.remove('demo-1');
    assert.equal(store.list().length, 0);
    store.reset();
    assert.equal(store.list().length, 3);
  });
  it('DEMO 历史存储与收藏使用不同的存储键', () => {
    assert.notEqual(STORAGE_KEYS.demoHistory, STORAGE_KEYS.favorites);
    assert.match(STORAGE_KEYS.demoHistory, /demo/);
  });
});

describe('收藏', () => {
  it('收藏、取消、去重、持久化', () => {
    const backend = memoryBackend();
    const ls = createLocalStore(backend);
    const favs = createFavoritesStore(createLocalFavoritesAdapter(ls), { now: () => 't' });
    const [a, b] = DEMO_VOICES;
    let notified = 0;
    favs.subscribe(() => notified++);
    favs.add(a);
    favs.add(a);
    assert.equal(favs.list().length, 1);
    assert.equal(favs.toggle(b), true);
    assert.equal(favs.toggle(b), false);
    assert.ok(favs.has(a.id));
    assert.equal(notified, 3);

    const reloaded = createFavoritesStore(createLocalFavoritesAdapter(ls));
    assert.deepEqual(reloaded.list(), [{ voiceId: a.id, voiceName: a.name, createdAt: 't' }]);
    reloaded.clear();
    assert.equal(reloaded.list().length, 0);
  });
});

describe('音色筛选', () => {
  it('按性别和关键词', () => {
    assert.equal(filterVoices(DEMO_VOICES, { filter: 'female' }).every((v) => v.gender === 'female'), true);
    assert.deepEqual(filterVoices(DEMO_VOICES, { query: '纪录片' }).map((v) => v.name), ['远山']);
    assert.deepEqual(filterVoices(DEMO_VOICES, { query: 'PODCAST' }).map((v) => v.name), ['Leo']);
    assert.equal(filterVoices(DEMO_VOICES, { query: '不存在' }).length, 0);
  });
});

describe('生成请求', () => {
  // 用真实格式的音色 ID；DEMO 音色会被拦截，不能作为“合法请求”
  const base = { text: ' 你好 ', voiceId: 'realVoice12345', modelId: 'eleven_multilingual_v2', settings: defaultSettings() };

  it('前端组装的请求能通过服务端校验', () => {
    const built = buildGeneratePayload(base);
    assert.ok(built.ok);
    assert.equal(built.payload.text, '你好');
    const server = validateGenerateRequest(built.payload, createIdempotencyKeeper().keyFor(built.payload));
    assert.ok(server.ok, JSON.stringify(server.errors));
  });

  it('缺少文本 / 音色 / 模型时给出提示', () => {
    const built = buildGeneratePayload({ ...base, text: '', voiceId: null, modelId: 'x' });
    assert.deepEqual(built.errors.map((e) => e.field), ['text', 'voiceId', 'modelId']);
  });

  it('幂等键：相同内容复用，内容变化或成功后换新', () => {
    let n = 0;
    const keeper = createIdempotencyKeeper(() => `key-${++n}`);
    const p1 = buildGeneratePayload(base).payload;
    assert.equal(keeper.keyFor(p1), 'key-1');
    assert.equal(keeper.keyFor({ ...p1 }), 'key-1');
    assert.equal(keeper.keyFor({ ...p1, text: '别的' }), 'key-2');
    keeper.reset();
    assert.equal(keeper.keyFor(p1), 'key-3');
  });
});

describe('api-client', () => {
  it('透传统一成功 / 失败格式，并带上幂等键', async () => {
    const fetchImpl = fakeFetch((url) =>
      url.endsWith('/health')
        ? jsonResponse(200, { ok: true, data: { stage: 'framework' } })
        : jsonResponse(501, { ok: false, error: { code: 'NOT_IMPLEMENTED', message: '未接入' }, requestId: 'r1' }),
    );
    const client = createApiClient({ fetchImpl });
    assert.deepEqual(await client.getHealth(), { ok: true, status: 200, data: { stage: 'framework' } });
    const gen = await client.generate({ text: 'a' }, 'key-1');
    assert.equal(gen.ok, false);
    assert.equal(gen.error.code, 'NOT_IMPLEMENTED');
    assert.equal(gen.requestId, 'r1');
    const init = fetchImpl.calls[1].init;
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Idempotency-Key'], 'key-1');
    assert.equal(fetchImpl.calls[1].url, '/api/generate');
  });

  it('路径参数会被编码', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(501, { ok: false, error: { code: 'NOT_IMPLEMENTED', message: '' } }));
    await createApiClient({ fetchImpl }).deleteHistory('../x');
    assert.equal(fetchImpl.calls[0].url, '/api/history/..%2Fx');
  });

  it('网络错误 → NETWORK_ERROR', async () => {
    const client = createApiClient({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    const res = await client.getVoices();
    assert.equal(res.error.code, 'NETWORK_ERROR');
  });

  it('非统一格式响应（如静态托管的 404 页面）→ BACKEND_UNAVAILABLE', async () => {
    const client = createApiClient({ fetchImpl: async () => ({ status: 404, json: async () => { throw new SyntaxError(); } }) });
    const res = await client.getVoices();
    assert.equal(res.error.code, 'BACKEND_UNAVAILABLE');
  });

  it('超时 → TIMEOUT', async () => {
    const fetchImpl = (_url, init) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const res = await createApiClient({ fetchImpl }).request('/slow', { timeoutMs: 10 });
    assert.equal(res.error.code, 'TIMEOUT');
  });

  it('有令牌时附带 Authorization 头', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(200, { ok: true, data: {} }));
    await createApiClient({ fetchImpl, getAccessToken: () => 'tok' }).getFavorites();
    assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer tok');
  });
});

describe('数据源回退', () => {
  it('/api/voices 未接入时使用 DEMO 音色并标明来源', async () => {
    const api = { getVoices: async () => ({ ok: false, error: { code: 'NOT_IMPLEMENTED' } }) };
    const res = await loadVoices(api);
    assert.equal(res.source, 'demo');
    assert.equal(res.voices, DEMO_VOICES);
  });
  it('/api/voices 可用时使用远程数据并标记为非 DEMO', async () => {
    const api = { getVoices: async () => ({ ok: true, data: { voices: [{ id: 'abc12345', name: 'X' }] } }) };
    const res = await loadVoices(api);
    assert.equal(res.source, 'remote');
    assert.equal(res.voices[0].isDemo, false);
  });
  it('云端历史未接入时返回 not_implemented 状态，而不是 DEMO 数据', async () => {
    const api = { getHistory: async () => ({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: '' } }) };
    const res = await fetchRemoteHistory(api);
    assert.equal(res.state, 'not_implemented');
    assert.equal(res.items, undefined);
  });
});

describe('历史状态展示', () => {
  it('DEMO 的 succeeded 记录显示为“示例完成”，不使用成功样式', () => {
    const demoSucceeded = createDemoHistory().find((i) => i.status === 'succeeded');
    assert.ok(demoSucceeded, '示例数据中应保留一条 succeeded 记录');
    assert.equal(demoSucceeded.isDemo, true);
    assert.equal(demoSucceeded.audioUrl, null);
    const display = getHistoryStatusDisplay(demoSucceeded);
    assert.equal(display.label, '示例完成');
    assert.notEqual(display.tone, 'success');
  });

  it('所有 DEMO 记录的状态都带“示例”前缀，且不会显示为“已完成”', () => {
    for (const item of createDemoHistory()) {
      const { label, tone } = getHistoryStatusDisplay(item);
      assert.match(label, /^示例/);
      assert.notEqual(label, '已完成');
      assert.equal(tone, 'demo');
    }
    assert.equal(getHistoryStatusDisplay({ isDemo: true, status: 'weird' }).label, '示例记录');
  });

  it('真实记录的状态文案保持不变', () => {
    assert.deepEqual(getHistoryStatusDisplay({ isDemo: false, status: 'succeeded' }), { label: '已完成', tone: 'success' });
    assert.deepEqual(getHistoryStatusDisplay({ isDemo: false, status: 'failed' }), { label: '失败', tone: 'danger' });
    assert.equal(getHistoryStatusDisplay({ isDemo: false, status: 'processing' }).label, '处理中');
  });
});

describe('DEMO 音色保护', () => {
  const base = { text: '你好', modelId: 'eleven_multilingual_v2', settings: defaultSettings() };

  it('选中 DEMO 音色时不会组装生成请求', () => {
    for (const voice of DEMO_VOICES) {
      const built = buildGeneratePayload({ ...base, voiceId: voice.id, voice });
      assert.equal(built.ok, false, `${voice.name} 不应能生成`);
      assert.deepEqual(built.errors.map((e) => e.field), ['voiceId']);
      assert.match(built.errors[0].reason, /DEMO/);
    }
  });

  it('来自接口的真实音色（isDemo: false）不受影响', () => {
    const voice = { id: 'realVoice12345', name: 'X', isDemo: false };
    assert.equal(buildGeneratePayload({ ...base, voiceId: voice.id, voice }).ok, true);
  });

  it('只传 DEMO voiceId、不传 voice 对象时同样被拦截', () => {
    for (const voice of DEMO_VOICES) {
      const built = buildGeneratePayload({ ...base, voiceId: voice.id });
      assert.equal(built.ok, false, `${voice.id} 不应绕过拦截`);
      assert.deepEqual(built.errors.map((e) => e.field), ['voiceId']);
      assert.match(built.errors[0].reason, /DEMO/);
    }
  });

  it('isDemoVoiceId 以 DEMO 数据定义为准：覆盖全部 DEMO 音色，不误伤真实音色', () => {
    assert.ok(DEMO_VOICES.every((v) => isDemoVoiceId(v.id)));
    assert.equal(isDemoVoiceId('21m00Tcm4TlvDq8ikWAM'), false);
    assert.equal(isDemoVoiceId('realVoice12345'), false);
    assert.equal(isDemoVoiceId(undefined), false);
    assert.equal(isDemoVoiceId(null), false);
  });

  it('只有 DEMO 音色会被拦截：缺少 voice 对象时真实音色行为与之前一致', () => {
    assert.equal(buildGeneratePayload({ ...base, voiceId: 'realVoice12345' }).ok, true);
  });

  it('接口不可用时回退的音色全部带 isDemo，不会被当成真实音色', async () => {
    const api = { getVoices: async () => ({ ok: false, error: { code: 'NOT_IMPLEMENTED' } }) };
    const { source, voices } = await loadVoices(api);
    assert.equal(source, 'demo');
    assert.ok(voices.length > 0 && voices.every((v) => v.isDemo === true));
  });
});
