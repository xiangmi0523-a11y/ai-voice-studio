// 前端纯逻辑模块（无 DOM）的单元测试
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultSettings, STORAGE_KEYS } from '../public/js/config.js';
import { countChars, formatDateTime, formatDuration, formatSettingValue, truncate } from '../public/js/core/format.js';
import { createLocalStore } from '../public/js/core/local-store.js';
import { createStore } from '../public/js/core/state.js';
import { createApiClient, GENERATE_TIMEOUT_MS } from '../public/js/services/api-client.js';
import { createDemoHistory, DEMO_VOICES, isDemoVoiceId } from '../public/js/services/demo-data.js';
import { createFavoritesStore, createLocalFavoritesAdapter } from '../public/js/services/favorites-store.js';
import { buildGeneratePayload, createIdempotencyKeeper, isOutcomeUnknown, runGeneration } from '../public/js/services/generation.js';
import { createDemoHistoryStore, fetchRemoteHistory, getHistoryStatusDisplay } from '../public/js/services/history-store.js';
import { filterVoices, loadVoices, voicesPatch } from '../public/js/services/voices.js';
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

  it('生成成功返回音频二进制 → data.blob，且请求声明可接收 audio/mpeg', async () => {
    const bytes = new Uint8Array([0xff, 0xfb, 1, 2, 3]);
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'audio/mpeg' }), blob: async () => new Blob([bytes], { type: 'audio/mpeg' }) };
    };
    const res = await createApiClient({ fetchImpl }).generate({ text: 'a' }, 'key-1');
    assert.equal(res.ok, true);
    assert.equal(res.data.contentType, 'audio/mpeg');
    assert.equal(res.data.blob.size, bytes.length);
    assert.match(calls[0].init.headers.Accept, /audio\/mpeg/);
  });

  it('音频响应为空 → 失败而不是“成功但无声”', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'audio/mpeg' }), blob: async () => new Blob([]) });
    const res = await createApiClient({ fetchImpl }).generate({ text: 'a' }, 'key-1');
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'BACKEND_UNAVAILABLE');
  });

  it('错误状态即使带 audio 类型也不当作成功；JSON 错误照常解析（含 503/502/504/413）', async () => {
    const bad = await createApiClient({ fetchImpl: async () => ({ ok: false, status: 500, headers: new Headers({ 'content-type': 'audio/mpeg' }), json: async () => { throw new SyntaxError(); } }) }).generate({}, 'k');
    assert.equal(bad.ok, false);
    for (const [status, code] of [[503, 'SERVICE_UNAVAILABLE'], [502, 'UPSTREAM_ERROR'], [504, 'UPSTREAM_TIMEOUT'], [413, 'PAYLOAD_TOO_LARGE']]) {
      const fetchImpl = async () => ({ ok: false, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: false, error: { code, message: 'm' }, requestId: 'r' }) });
      const res = await createApiClient({ fetchImpl }).generate({}, 'k');
      assert.equal(res.ok, false);
      assert.equal(res.error.code, code);
    }
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

describe('生成流程（runGeneration）：模拟接口，不访问真实 ElevenLabs', () => {
  const payload = { text: '你好', voiceId: 'realVoice12345', modelId: 'eleven_flash_v2_5', settings: {} };
  const blob = new Blob([new Uint8Array([0xff, 0xfb, 1, 2])], { type: 'audio/mpeg' });
  const urls = { created: [], revoked: [] };
  const hooks = {
    createObjectUrl: (b) => { urls.created.push(b); return `blob:mock/${urls.created.length}`; },
    revokeObjectUrl: (u) => urls.revoked.push(u),
  };
  const apiWith = (result) => {
    const api = { calls: [], async generate(p, key) { api.calls.push({ p, key }); return typeof result === 'function' ? result() : result; } };
    return api;
  };
  const failure = (code, status, extra = {}) => ({ ok: false, status, error: { code, message: 'm' }, requestId: 'r', ...extra });

  it('生成成功：Blob 变成对象 URL 用于播放，并释放上一个对象 URL；成功后重置幂等键', async () => {
    urls.created.length = 0;
    urls.revoked.length = 0;
    const keeper = createIdempotencyKeeper(() => 'key-1');
    const api = apiWith({ ok: true, status: 200, data: { blob, contentType: 'audio/mpeg' } });
    const out = await runGeneration({ api, keeper, payload, previousUrl: 'blob:old', ...hooks });
    assert.equal(out.ok, true);
    assert.equal(out.url, 'blob:mock/1');
    assert.equal(out.contentType, 'audio/mpeg');
    assert.equal(urls.created[0], blob);
    assert.deepEqual(urls.revoked, ['blob:old']);
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].key, 'key-1');
  });

  it('失败时不创建、也不释放对象 URL（上一段音频仍可播放）', async () => {
    urls.created.length = 0;
    urls.revoked.length = 0;
    const out = await runGeneration({ api: apiWith(failure('SERVICE_UNAVAILABLE', 503)), keeper: createIdempotencyKeeper(), payload, previousUrl: 'blob:old', ...hooks });
    assert.equal(out.ok, false);
    assert.equal(urls.created.length, 0);
    assert.deepEqual(urls.revoked, []);
  });

  const definite = [
    ['服务端 503', failure('SERVICE_UNAVAILABLE', 503)],
    ['限流 429', failure('RATE_LIMITED', 429)],
    ['校验失败 400', failure('VALIDATION_ERROR', 400)],
    ['请求体过大 413', failure('PAYLOAD_TOO_LARGE', 413)],
    ['静态预览下接口不存在', failure('BACKEND_UNAVAILABLE', 404)],
  ];
  for (const [name, result] of definite) {
    it(`${name}：明确未生成，可用同一个键手动重试；只请求一次，没有自动重试`, async () => {
      const keeper = createIdempotencyKeeper(() => `k${Math.random()}`);
      const api = apiWith(result);
      const out = await runGeneration({ api, keeper, payload, ...hooks });
      assert.equal(out.ok, false);
      assert.equal(out.outcomeUnknown, false);
      assert.equal(out.error.code, result.error.code);
      assert.equal(api.calls.length, 1);
      // 用户手动重试时使用同一个键
      await runGeneration({ api, keeper, payload, ...hooks });
      assert.equal(api.calls[1].key, api.calls[0].key);
    });
  }

  const unknown = [
    ['服务端 504（上游超时）', failure('UPSTREAM_TIMEOUT', 504)],
    ['服务端 502', failure('UPSTREAM_ERROR', 502)],
    ['请求超时（客户端放弃）', failure('TIMEOUT', 0)],
    ['网络中断', failure('NETWORK_ERROR', 0)],
    ['平台强杀函数返回非统一格式的 5xx', failure('BACKEND_UNAVAILABLE', 504)],
    ['200 但音频读不出来', failure('BACKEND_UNAVAILABLE', 200)],
    ['同一个请求已提交过（409）', failure('IDEMPOTENCY_CONFLICT', 409)],
  ];
  for (const [name, result] of unknown) {
    it(`${name}：标记为“结果未知”，且只请求一次，不会自动再发生成请求`, async () => {
      const api = apiWith(result);
      const out = await runGeneration({ api, keeper: createIdempotencyKeeper(), payload, ...hooks });
      assert.equal(out.ok, false);
      assert.equal(out.outcomeUnknown, true);
      assert.equal(isOutcomeUnknown(result), true);
      assert.equal(api.calls.length, 1);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(api.calls.length, 1, '等待之后依然没有自动重试');
    });
  }

  it('用户明确确认重新生成（keeper.reset）才会换新的幂等键', async () => {
    let n = 0;
    const keeper = createIdempotencyKeeper(() => `key-${++n}`);
    const api = apiWith(failure('UPSTREAM_TIMEOUT', 504));
    await runGeneration({ api, keeper, payload, ...hooks });
    await runGeneration({ api, keeper, payload, ...hooks });
    assert.equal(api.calls[1].key, api.calls[0].key, '没有确认前沿用同一个键');
    keeper.reset();
    await runGeneration({ api, keeper, payload, ...hooks });
    assert.notEqual(api.calls[2].key, api.calls[0].key);
  });

  it('isOutcomeUnknown：成功或空值不是“未知”', () => {
    assert.equal(isOutcomeUnknown({ ok: true }), false);
    assert.equal(isOutcomeUnknown(null), false);
  });
});

describe('api-client 生成请求：超时与不自动重试', () => {
  it('生成请求的客户端超时长于服务端函数上限（30 秒），避免客户端先放弃而服务端继续计费', () => {
    assert.ok(GENERATE_TIMEOUT_MS > 30_000);
  });

  it('请求超时 → TIMEOUT，fetch 只被调用一次', async () => {
    let calls = 0;
    const fetchImpl = (_url, init) => {
      calls += 1;
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    };
    const res = await createApiClient({ fetchImpl }).request('/generate', { method: 'POST', body: {}, timeoutMs: 10 });
    assert.equal(res.error.code, 'TIMEOUT');
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 1);
  });

  for (const [status, code] of [[503, 'SERVICE_UNAVAILABLE'], [429, 'RATE_LIMITED'], [504, 'UPSTREAM_TIMEOUT']]) {
    it(`服务端 ${status} ${code}：返回统一错误，fetch 只被调用一次`, async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls += 1;
        return { ok: false, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: false, error: { code, message: 'm' }, requestId: 'r' }) };
      };
      const res = await createApiClient({ fetchImpl }).generate({ text: 'a' }, 'key-1');
      assert.equal(res.ok, false);
      assert.equal(res.error.code, code);
      assert.equal(res.status, status);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(calls, 1);
    });
  }
});

describe('生成前的前端校验：字数 ÷ 语速', () => {
  const base = { voiceId: 'realVoice12345', voice: { isDemo: false }, modelId: 'eleven_flash_v2_5' };
  it('语速 0.7 时超过 700 字被拦截，不会产生请求', () => {
    const bad = buildGeneratePayload({ ...base, text: '字'.repeat(701), settings: { speed: 0.7 } });
    assert.equal(bad.ok, false);
    assert.equal(bad.errors[0].field, 'text');
    assert.equal(buildGeneratePayload({ ...base, text: '字'.repeat(700), settings: { speed: 0.7 } }).ok, true);
  });
  it('语速为 1 时 1000 字可以通过', () => {
    assert.equal(buildGeneratePayload({ ...base, text: '字'.repeat(1000), settings: { speed: 1 } }).ok, true);
  });
});

describe('音色列表为空：不显示 DEMO，也不显示“没有找到匹配的音色”', () => {
  it('服务端返回空列表 → 清空音色并取消选择（界面提示“当前没有可用音色”）', () => {
    const patch = voicesPatch({ source: 'remote', voices: [] }, 'demoVoice0001');
    assert.deepEqual(patch, { voices: [], voicesSource: 'remote', selectedVoiceId: null });
  });
  it('请求失败（source 为 demo）→ 不改动，保留带 DEMO 标记的示例音色', () => {
    assert.equal(voicesPatch({ source: 'demo', voices: [] }, null), null);
  });
  it('有音色：保留仍存在的选择，否则选第一个', () => {
    const voices = [{ id: 'a1234567' }, { id: 'b1234567' }];
    assert.equal(voicesPatch({ source: 'remote', voices }, 'b1234567').selectedVoiceId, 'b1234567');
    assert.equal(voicesPatch({ source: 'remote', voices }, 'gone').selectedVoiceId, 'a1234567');
  });
  it('/api/voices 返回 200 空数组时 loadVoices 视为 remote（不是 DEMO 回退）', async () => {
    const api = { getVoices: async () => ({ ok: true, data: { voices: [] } }) };
    assert.deepEqual(await loadVoices(api), { source: 'remote', voices: [] });
  });
});
