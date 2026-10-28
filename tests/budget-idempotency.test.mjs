// 时间预算、幂等（进程内最低限度保护）与“字数 ÷ 语速”限制
// 全部使用模拟 fetch / 模拟 TTS 客户端，不访问真实 ElevenLabs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';

import generate from '../api/generate.js';
import {
  CATALOG_TIMEOUT_MS,
  FUNCTION_MAX_DURATION_MS,
  MAX_AUDIO_BYTES,
  MAX_SPEED_ADJUSTED_CHARS,
  MAX_TEXT_LENGTH,
  maxCharsForSpeed,
  MIN_TTS_BUDGET_MS,
  REQUEST_BUDGET_MS,
  TTS_TIMEOUT_MS,
} from '../lib/config.js';
import { setClock } from '../lib/deadline.js';
import { createInProcessIdempotency, fingerprintOf, IdempotencyState, setIdempotency } from '../lib/idempotency.js';
import { createInProcessLimiter, setGenerateLimiter } from '../lib/rate-limit.js';
import { createTtsClient, setTtsClient, TtsFailure } from '../lib/tts.js';
import { validateGenerateRequest } from '../lib/validation.js';
import { createVoiceCatalog, setVoiceCatalog } from '../lib/voice-catalog.js';
import { call, freshKey, installMockCatalog } from './helpers.mjs';

const VOICE = 'realVoice12345';
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);
const quiet = { info() {}, warn() {}, error() {} };

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = () => {
    throw new Error('测试中禁止真实网络请求');
  };
});
after(() => {
  globalThis.fetch = realFetch;
  setClock(null);
});

const body = (overrides = {}) => ({ text: '你好', voiceId: VOICE, modelId: 'eleven_multilingual_v2', ...overrides });
const req = (b = body(), key = freshKey()) => ({ method: 'POST', headers: { 'idempotency-key': key }, body: b });

describe('时间预算', () => {
  it('预算与 vercel.json 的 maxDuration 自洽，并为返回响应预留时间', () => {
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    assert.equal(vercel.functions['api/generate.js'].maxDuration * 1000, FUNCTION_MAX_DURATION_MS);
    assert.ok(CATALOG_TIMEOUT_MS + TTS_TIMEOUT_MS <= REQUEST_BUDGET_MS, '目录与 TTS 的超时之和不超过总预算');
    assert.ok(FUNCTION_MAX_DURATION_MS - REQUEST_BUDGET_MS >= 3000, '至少预留 3 秒给响应和平台开销');
    assert.ok(MIN_TTS_BUDGET_MS < TTS_TIMEOUT_MS);
  });

  describe('handler', () => {
    let calls;
    let time;
    beforeEach(() => {
      time = 0;
      setClock(() => time);
      calls = [];
      setIdempotency(createInProcessIdempotency());
      setGenerateLimiter(createInProcessLimiter({ max: 100 }));
      setTtsClient({ async synthesize(a) { calls.push(a); return { ok: true, audio: MP3, contentType: 'audio/mpeg' }; } });
    });
    after(() => setClock(null));

    // 模拟目录拉取耗时 spentMs（推进假时钟）
    function catalogTaking(spentMs) {
      setVoiceCatalog(createVoiceCatalog({
        getEnv: () => ({ ELEVENLABS_API_KEY: 'k', PUBLIC_VOICE_IDS: VOICE }),
        fetchImpl: async () => {
          time += spentMs;
          return { ok: true, status: 200, json: async () => ({ voices: [{ voice_id: VOICE, name: 'v' }] }) };
        },
        logger: quiet,
      }));
    }

    it('TTS 的超时取自剩余预算：总预算扣掉目录拉取已用时间', async () => {
      catalogTaking(4000);
      assert.equal((await call(generate, req())).statusCode, 200);
      assert.equal(calls[0].timeoutMs, REQUEST_BUDGET_MS - 4000);
    });

    it('剩余预算不足时不向上游发请求，返回 504，且不占用幂等键', async () => {
      catalogTaking(REQUEST_BUDGET_MS - MIN_TTS_BUDGET_MS + 1);
      const key = freshKey();
      const res = await call(generate, req(body(), key));
      assert.equal(res.statusCode, 504);
      assert.equal(res.body.error.code, 'UPSTREAM_TIMEOUT');
      assert.equal(calls.length, 0);
      // 没有发出上游请求，所以同一个键可以直接重试
      time = 1_000_000;
      await installMockCatalog([VOICE]);
      assert.equal((await call(generate, req(body(), key))).statusCode, 200);
    });

    it('恰好等于最低预算时仍可发出请求', async () => {
      catalogTaking(REQUEST_BUDGET_MS - MIN_TTS_BUDGET_MS);
      assert.equal((await call(generate, req())).statusCode, 200);
      assert.equal(calls[0].timeoutMs, MIN_TTS_BUDGET_MS);
    });
  });

  describe('TTS 客户端的取消行为', () => {
    const headers = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
    const input = { voiceId: VOICE, text: '你好', modelId: 'eleven_flash_v2_5' };
    const abortable = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

    it('调用方传入的更短超时生效，并真正取消上游请求', async () => {
      let signal;
      const client = createTtsClient({ getEnv: () => ({ ELEVENLABS_API_KEY: 'k' }), logger: quiet, timeoutMs: 10_000, fetchImpl: (_u, init) => { signal = init.signal; return abortable(init.signal); } });
      const started = Date.now();
      const result = await client.synthesize({ ...input, timeoutMs: 20 });
      assert.equal(result.code, TtsFailure.UPSTREAM_TIMEOUT);
      assert.equal(result.maybeCharged, true);
      assert.equal(signal.aborted, true);
      assert.ok(Date.now() - started < 1000);
    });

    it('调用方不能把超时调得比客户端上限更长', async () => {
      const client = createTtsClient({ getEnv: () => ({ ELEVENLABS_API_KEY: 'k' }), logger: quiet, timeoutMs: 20, fetchImpl: (_u, init) => abortable(init.signal) });
      const started = Date.now();
      const result = await client.synthesize({ ...input, timeoutMs: 60_000 });
      assert.equal(result.code, TtsFailure.UPSTREAM_TIMEOUT);
      assert.ok(Date.now() - started < 1000);
    });

    it('响应头已到、但响应体读取卡住：同样被超时中断，不会无限等待', async () => {
      const client = createTtsClient({
        getEnv: () => ({ ELEVENLABS_API_KEY: 'k' }),
        logger: quiet,
        timeoutMs: 20,
        fetchImpl: async (_u, init) => ({
          ok: true,
          status: 200,
          headers: headers({ 'content-type': 'audio/mpeg' }),
          body: { getReader: () => ({ read: () => abortable(init.signal), cancel: async () => {} }) },
        }),
      });
      const result = await client.synthesize(input);
      assert.equal(result.code, TtsFailure.UPSTREAM_TIMEOUT);
    });

    it('流式读取超过大小上限：立即取消读取，不把超大响应读进内存', async () => {
      let cancelled = false;
      let reads = 0;
      const client = createTtsClient({
        getEnv: () => ({ ELEVENLABS_API_KEY: 'k' }),
        logger: quiet,
        maxAudioBytes: 1024,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: headers({ 'content-type': 'audio/mpeg' }),
          body: { getReader: () => ({ read: async () => { reads += 1; return { done: false, value: new Uint8Array(600) }; }, cancel: async () => { cancelled = true; } }) },
        }),
      });
      const result = await client.synthesize(input);
      assert.equal(result.ok, false);
      assert.equal(result.code, TtsFailure.UPSTREAM_ERROR);
      assert.equal(result.maybeCharged, true, '上游已生成并可能计费，但本应用拒收');
      assert.equal(cancelled, true);
      assert.equal(reads, 2);
    });

    it('流式读取在上限内：拼接为完整音频', async () => {
      const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
      const client = createTtsClient({
        getEnv: () => ({ ELEVENLABS_API_KEY: 'k' }),
        logger: quiet,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: headers({ 'content-type': 'audio/mpeg' }),
          body: { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }), cancel: async () => {} }) },
        }),
      });
      const result = await client.synthesize(input);
      assert.deepEqual([...result.audio], [1, 2, 3, 4, 5]);
    });
  });
});

describe('maybeCharged：哪些上游失败可能已经计费', () => {
  const headers = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
  const errResponse = (status) => ({ ok: false, status, headers: headers({}), json: async () => ({}) });
  const run = (fetchImpl) =>
    createTtsClient({ getEnv: () => ({ ELEVENLABS_API_KEY: 'k' }), logger: quiet, fetchImpl }).synthesize({ voiceId: VOICE, text: '你好', modelId: 'eleven_flash_v2_5' });

  for (const [status, expected] of [[401, false], [403, false], [422, false], [429, false], [500, true], [502, true], [503, true]]) {
    it(`上游 ${status} → maybeCharged=${expected}`, async () => {
      assert.equal((await run(async () => errResponse(status))).maybeCharged, expected);
    });
  }
  it('网络错误 → 可能已计费', async () => {
    assert.equal((await run(async () => { throw new TypeError('fetch failed'); })).maybeCharged, true);
  });
  it('未配置密钥 / 输入无效 → 未计费', async () => {
    const noKey = await createTtsClient({ getEnv: () => ({}), logger: quiet, fetchImpl: async () => { throw new Error('不应调用'); } }).synthesize({ voiceId: VOICE, text: '你好', modelId: 'eleven_flash_v2_5' });
    assert.equal(noKey.maybeCharged, false);
  });
});

describe('幂等（进程内最低限度保护，不是可靠的跨实例去重）', () => {
  let calls;
  beforeEach(async () => {
    await installMockCatalog([VOICE]);
    setClock(null);
    calls = [];
    setIdempotency(createInProcessIdempotency());
    setGenerateLimiter(createInProcessLimiter({ max: 100 }));
    setTtsClient({ async synthesize(a) { calls.push(a); return { ok: true, audio: MP3, contentType: 'audio/mpeg' }; } });
  });

  const failing = (code, maybeCharged) => setTtsClient({ async synthesize(a) { calls.push(a); return { ok: false, code, category: 'x', maybeCharged }; } });

  it('明确标记为不可靠', () => {
    assert.equal(createInProcessIdempotency().reliable, false);
  });

  it('同一个键并发请求：第二个得到 409，上游只被调用一次', async () => {
    let finish;
    setTtsClient({ async synthesize(a) { calls.push(a); await new Promise((r) => { finish = r; }); return { ok: true, audio: MP3, contentType: 'audio/mpeg' }; } });
    const key = freshKey();
    const first = call(generate, req(body(), key));
    await new Promise((r) => setTimeout(r, 10));
    const second = await call(generate, req(body(), key));
    assert.equal(second.statusCode, 409);
    assert.equal(second.body.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(second.body.error.details.state, IdempotencyState.IN_PROGRESS);
    finish();
    assert.equal((await first).statusCode, 200);
    assert.equal(calls.length, 1);
  });

  it('成功后用同一个键再次请求（例如响应丢失后重试）：409，不再次计费，也不返回缓存的音频', async () => {
    const key = freshKey();
    assert.equal((await call(generate, req(body(), key))).statusCode, 200);
    const again = await call(generate, req(body(), key));
    assert.equal(again.statusCode, 409);
    assert.equal(again.body.error.details.state, IdempotencyState.FINISHED);
    assert.equal(again.rawBody, undefined, '不保留、不重放音频');
    assert.equal(calls.length, 1);
  });

  it('首次请求超时（结果未知）：同一个键不会再次发出上游请求；换新键才是用户明确的重新生成', async () => {
    const key = freshKey();
    failing(TtsFailure.UPSTREAM_TIMEOUT, true);
    assert.equal((await call(generate, req(body(), key))).statusCode, 504);
    const retry = await call(generate, req(body(), key));
    assert.equal(retry.statusCode, 409);
    assert.equal(retry.body.error.details.state, IdempotencyState.UNKNOWN);
    assert.equal(calls.length, 1);
    // 用户明确确认后用新键重新生成
    assert.equal((await call(generate, req(body(), freshKey()))).statusCode, 504);
    assert.equal(calls.length, 2);
  });

  it('上游在生成前就拒绝（401/4xx，未计费）：释放键，可以用同一个键手动重试', async () => {
    const key = freshKey();
    failing(TtsFailure.UPSTREAM_AUTH, false);
    assert.equal((await call(generate, req(body(), key))).statusCode, 503);
    setTtsClient({ async synthesize(a) { calls.push(a); return { ok: true, audio: MP3, contentType: 'audio/mpeg' }; } });
    assert.equal((await call(generate, req(body(), key))).statusCode, 200);
  });

  it('同一个键搭配不同内容 → 409，不发出上游请求', async () => {
    const key = freshKey();
    assert.equal((await call(generate, req(body(), key))).statusCode, 200);
    const res = await call(generate, req(body({ text: '另一段文字' }), key));
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.details.state, IdempotencyState.MISMATCH);
    assert.equal(calls.length, 1);
  });

  it('被限流拒绝不占用键', async () => {
    setGenerateLimiter(createInProcessLimiter({ max: 1 }));
    await call(generate, req());
    const key = freshKey();
    assert.equal((await call(generate, req(body(), key))).statusCode, 429);
    setGenerateLimiter(createInProcessLimiter({ max: 5 }));
    assert.equal((await call(generate, req(body(), key))).statusCode, 200);
  });

  it('校验失败的请求不占用键', async () => {
    const key = freshKey();
    assert.equal((await call(generate, req(body({ text: '' }), key))).statusCode, 400);
    assert.equal((await call(generate, req(body(), key))).statusCode, 200);
  });

  it('键在 TTL 后过期；指纹是哈希，不含文本；容量有上限', () => {
    let time = 0;
    const store = createInProcessIdempotency({ now: () => time, ttlMs: 1000 });
    const fp = fingerprintOf({ text: '机密文本', voiceId: VOICE, modelId: 'm', settings: {} });
    assert.match(fp, /^[0-9a-f]{64}$/);
    assert.ok(!fp.includes('机密'));
    assert.equal(store.begin('k', fp), IdempotencyState.NEW);
    assert.equal(store.begin('k', fp), IdempotencyState.IN_PROGRESS);
    time = 1001;
    assert.equal(store.begin('k', fp), IdempotencyState.NEW);
    for (let i = 0; i < 5000; i += 1) store.begin(`key-${i}`, fp);
    assert.equal(store.begin('key-4999', fp), IdempotencyState.IN_PROGRESS, '最近的键仍在，旧键被淘汰而不是无限增长');
  });
});

describe('音频大小：字数 ÷ 语速限制', () => {
  it('估算的最大音频体积不超过 MAX_AUDIO_BYTES（128kbps ≈ 16KB/秒，每字按 0.25 秒）', () => {
    assert.ok(MAX_SPEED_ADJUSTED_CHARS * 0.25 * 16_000 <= MAX_AUDIO_BYTES);
    assert.ok(MAX_AUDIO_BYTES < 4.5 * 1024 * 1024, '低于 Vercel 4.5MB 响应限制');
  });

  it('maxCharsForSpeed', () => {
    assert.equal(maxCharsForSpeed(1), 1000);
    assert.equal(maxCharsForSpeed(0.7), 700);
    assert.equal(maxCharsForSpeed(0.85), 850);
    assert.equal(maxCharsForSpeed(1.2), MAX_TEXT_LENGTH, '语速更快不放宽最大字数');
    assert.equal(maxCharsForSpeed(undefined), 1000);
    assert.equal(maxCharsForSpeed(0), 1000);
  });

  const validate = (text, settings) => validateGenerateRequest({ text, voiceId: VOICE, modelId: 'eleven_flash_v2_5', settings }, freshKey());

  it('语速 0.7 时 700 字通过，701 字被拒绝并指向 text', () => {
    assert.equal(validate('字'.repeat(700), { speed: 0.7 }).ok, true);
    const bad = validate('字'.repeat(701), { speed: 0.7 });
    assert.equal(bad.ok, false);
    assert.equal(bad.errors[0].field, 'text');
    assert.match(bad.errors[0].reason, /700/);
  });

  it('语速为 1 或未设置时仍允许 1000 字', () => {
    assert.equal(validate('字'.repeat(1000), { speed: 1 }).ok, true);
    assert.equal(validate('字'.repeat(1000), undefined).ok, true);
    assert.equal(validate('字'.repeat(1000), { stability: 0.5 }).ok, true);
  });

  it('超限请求通过 handler 返回 400，且不触发上游', async () => {
    await installMockCatalog([VOICE]);
    setIdempotency(createInProcessIdempotency());
    setGenerateLimiter(createInProcessLimiter({ max: 100 }));
    const calls = [];
    setTtsClient({ async synthesize(a) { calls.push(a); return { ok: true, audio: MP3, contentType: 'audio/mpeg' }; } });
    const res = await call(generate, req(body({ text: '字'.repeat(701), settings: { speed: 0.7 } })));
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
  });
});
