// ElevenLabs TTS 客户端与 /api/generate 真实调用路径
//
// 所有上游请求都经过注入的模拟 fetch；整个文件运行期间全局 fetch 被替换为直接抛错，
// 保证测试不会访问真实 ElevenLabs，也不会消耗额度。
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import generate from '../api/generate.js';
import { createInProcessLimiter, getClientKey, setGenerateLimiter } from '../lib/rate-limit.js';
import { buildTtsRequest, createTtsClient, setTtsClient, TtsFailure } from '../lib/tts.js';
import { MAX_BODY_BYTES } from '../lib/config.js';
import { call, freshKey, installMockCatalog } from './helpers.mjs';

const VOICE = 'realVoice12345';
const SECRET = 'xi-test-secret-key-do-not-leak';
const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 9, 8, 7, 6, 5]);

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = () => {
    throw new Error('测试中禁止真实网络请求');
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

const headersOf = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });
const audioResponse = (buf = MP3, headers = {}) => ({
  ok: true,
  status: 200,
  headers: headersOf({ 'content-type': 'audio/mpeg', ...headers }),
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
});
const errorResponse = (status, payload = { detail: { status: 'quota_exceeded', message: `secret ${SECRET}` } }) => ({
  ok: false,
  status,
  headers: headersOf({ 'content-type': 'application/json' }),
  json: async () => payload,
});

function makeLogger() {
  const lines = [];
  const rec = (level) => (event, fields) => lines.push(JSON.stringify({ level, event, ...fields }));
  return { lines, logger: { info: rec('info'), warn: rec('warn'), error: rec('error') } };
}

function makeClient({ fetchImpl, env = { ELEVENLABS_API_KEY: SECRET }, ...options } = {}) {
  const calls = [];
  const log = makeLogger();
  const client = createTtsClient({
    getEnv: () => env,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
    logger: log.logger,
    ...options,
  });
  return { client, calls, log };
}

const input = (overrides = {}) => ({ voiceId: VOICE, text: '你好，世界', modelId: 'eleven_multilingual_v2', settings: { stability: 0.5, speed: 1 }, ...overrides });

describe('TTS 客户端：请求映射', () => {
  it('使用固定端点、POST、xi-api-key 头，以及 model_id / voice_settings 字段映射', async () => {
    const { client, calls } = makeClient({ fetchImpl: async () => audioResponse() });
    const result = await client.synthesize(input({ settings: { stability: 0.4, similarity_boost: 0.8, style: 0, speed: 1.1, use_speaker_boost: false } }));
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['xi-api-key'], SECRET);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.ok(init.signal, '必须带超时信号');
    assert.deepEqual(JSON.parse(init.body), {
      text: '你好，世界',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0, speed: 1.1, use_speaker_boost: false },
    });
    assert.ok(!init.body.includes(SECRET), '密钥只在请求头里，不进入请求体');
  });

  it('未提供 settings 时不发送 voice_settings；不会透传未知字段', () => {
    assert.deepEqual(buildTtsRequest({ voiceId: VOICE, text: 'a', modelId: 'eleven_flash_v2_5', settings: {} }).body, { text: 'a', model_id: 'eleven_flash_v2_5' });
    const { body } = buildTtsRequest({ voiceId: VOICE, text: 'a', modelId: 'eleven_flash_v2_5', settings: { speed: 1, evil: 'x', __proto__: { x: 1 } } });
    assert.deepEqual(body.voice_settings, { speed: 1 });
  });

  it('上游地址固定：voiceId 即使异常也只会被编码进路径，不能改变主机', () => {
    const { url } = buildTtsRequest({ voiceId: '../x?y=1#', text: 'a', modelId: 'eleven_flash_v2_5' });
    assert.ok(url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/'));
    assert.ok(!url.includes('?y=1'));
    assert.equal(new URL(url).host, 'api.elevenlabs.io');
  });

  it('成功：返回音频字节与 audio/mpeg', async () => {
    const { client } = makeClient({ fetchImpl: async () => audioResponse(MP3, { 'content-type': 'audio/mpeg; charset=binary' }) });
    const result = await client.synthesize(input());
    assert.equal(result.ok, true);
    assert.equal(result.contentType, 'audio/mpeg');
    assert.deepEqual(result.audio, MP3);
  });
});

describe('TTS 客户端：不合法输入与缺少密钥时不发请求', () => {
  const bad = [
    ['缺少密钥', { env: {} }, input(), TtsFailure.NOT_CONFIGURED],
    ['密钥为空串', { env: { ELEVENLABS_API_KEY: '' } }, input(), TtsFailure.NOT_CONFIGURED],
    ['空文本', {}, input({ text: '  ' }), TtsFailure.INVALID_INPUT],
    ['超长文本', {}, input({ text: '字'.repeat(1001) }), TtsFailure.INVALID_INPUT],
    ['非法模型', {}, input({ modelId: 'eleven_other' }), TtsFailure.INVALID_INPUT],
    ['非法 voiceId', {}, input({ voiceId: '../../x' }), TtsFailure.INVALID_INPUT],
  ];
  for (const [name, options, args, code] of bad) {
    it(`${name} → ${code}，fetch 未被调用`, async () => {
      const { client, calls } = makeClient({ fetchImpl: async () => audioResponse(), ...options });
      const result = await client.synthesize(args);
      assert.equal(result.ok, false);
      assert.equal(result.code, code);
      assert.equal(calls.length, 0);
    });
  }
});

describe('TTS 客户端：上游失败被安全处理，不重试、不伪造成功', () => {
  const cases = [
    ['401', async () => errorResponse(401), TtsFailure.UPSTREAM_AUTH],
    ['403', async () => errorResponse(403), TtsFailure.UPSTREAM_AUTH],
    ['422', async () => errorResponse(422, { detail: [{ msg: 'x' }] }), TtsFailure.UPSTREAM_ERROR],
    ['429', async () => errorResponse(429), TtsFailure.UPSTREAM_ERROR],
    ['500', async () => errorResponse(500), TtsFailure.UPSTREAM_ERROR],
    ['503', async () => errorResponse(503, 'not json'), TtsFailure.UPSTREAM_ERROR],
    ['网络错误', async () => { throw new TypeError('fetch failed'); }, TtsFailure.UPSTREAM_ERROR],
    ['非音频 Content-Type（JSON 200）', async () => audioResponse(Buffer.from('{}'), { 'content-type': 'application/json' }), TtsFailure.UPSTREAM_ERROR],
    ['HTML 响应', async () => audioResponse(Buffer.from('<html>'), { 'content-type': 'text/html' }), TtsFailure.UPSTREAM_ERROR],
    ['缺少 Content-Type', async () => audioResponse(MP3, { 'content-type': '' }), TtsFailure.UPSTREAM_ERROR],
    ['空响应体', async () => audioResponse(Buffer.alloc(0)), TtsFailure.UPSTREAM_ERROR],
    ['声明长度超限', async () => audioResponse(MP3, { 'content-length': String(10 * 1024 * 1024) }), TtsFailure.UPSTREAM_ERROR],
  ];
  for (const [name, fetchImpl, code] of cases) {
    it(`${name} → ${code}；只调用一次（不自动重试）；日志不含密钥与上游错误描述`, async () => {
      const { client, calls, log } = makeClient({ fetchImpl });
      const result = await client.synthesize(input());
      assert.equal(result.ok, false);
      assert.equal(result.code, code);
      assert.equal(result.audio, undefined);
      assert.equal(calls.length, 1);
      const logs = log.lines.join('\n');
      assert.ok(!logs.includes(SECRET));
      assert.ok(!logs.includes('你好，世界'), '日志不记录用户文本');
      assert.ok(!JSON.stringify(result).includes(SECRET));
    });
  }

  it('实际体积超过上限（未声明长度）→ 拒绝', async () => {
    const { client } = makeClient({ fetchImpl: async () => audioResponse(Buffer.alloc(2048, 1)), maxAudioBytes: 1024 });
    assert.equal((await client.synthesize(input())).code, TtsFailure.UPSTREAM_ERROR);
  });

  it('超时 → UPSTREAM_TIMEOUT，且只请求一次', async () => {
    const { client, calls } = makeClient({
      timeoutMs: 10,
      fetchImpl: (_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    });
    const result = await client.synthesize(input());
    assert.equal(result.code, TtsFailure.UPSTREAM_TIMEOUT);
    assert.equal(calls.length, 1);
  });

  it('成功日志只含状态、耗时与字数，不含文本和密钥', async () => {
    const { client, log } = makeClient({ fetchImpl: async () => audioResponse() });
    await client.synthesize(input());
    const logs = log.lines.join('\n');
    assert.match(logs, /tts_success/);
    assert.ok(!logs.includes(SECRET));
    assert.ok(!logs.includes('你好，世界'));
  });
});

describe('POST /api/generate：真实调用路径（模拟 TTS 客户端）', () => {
  let calls;
  const body = (overrides = {}) => ({ text: '你好', voiceId: VOICE, modelId: 'eleven_multilingual_v2', settings: { speed: 1 }, ...overrides });
  const req = (b = body(), extra = {}) => ({ method: 'POST', headers: { 'idempotency-key': freshKey(), ...extra }, body: b });

  beforeEach(async () => {
    await installMockCatalog([VOICE]);
    calls = [];
    setTtsClient({
      async synthesize(args) {
        calls.push(args);
        return { ok: true, audio: MP3, contentType: 'audio/mpeg' };
      },
    });
    setGenerateLimiter(createInProcessLimiter({ max: 100 }));
  });

  it('成功：音频二进制 + 正确的响应头；传给客户端的是已校验的字段', async () => {
    const res = await call(generate, req());
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'audio/mpeg');
    assert.equal(res.headers['content-length'], String(MP3.length));
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(typeof res.headers['x-request-id'], 'string');
    assert.deepEqual(res.rawBody, MP3);
    assert.equal(calls.length, 1);
    const { timeoutMs, ...forwarded } = calls[0];
    assert.deepEqual(forwarded, { voiceId: VOICE, text: '你好', modelId: 'eleven_multilingual_v2', settings: { speed: 1 } });
    assert.ok(timeoutMs > 0 && timeoutMs <= 26_000, '超时取自剩余预算');
  });

  it('客户端伪造 isPublic / isDemo / voice 不能让未公开音色通过', async () => {
    for (const extra of [{ isPublic: true }, { isDemo: false }, { voice: { id: 'privateVoice99', isPublic: true } }, { voice: { isPublic: true, category: 'premade' } }]) {
      const res = await call(generate, req({ ...body({ voiceId: 'privateVoice99' }), ...extra }));
      assert.equal(res.statusCode, 400, JSON.stringify(extra));
    }
    assert.equal(calls.length, 0);
  });

  it('请求体里多余的字段（上游 URL、请求头、模型参数）不会被转发', async () => {
    const res = await call(generate, req({ ...body(), url: 'https://evil.example', headers: { 'xi-api-key': 'x' }, model_id: 'other', output_format: 'pcm_44100' }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(calls[0]).sort(), ['modelId', 'settings', 'text', 'timeoutMs', 'voiceId']);
  });

  const upstream = [
    [TtsFailure.NOT_CONFIGURED, 503, 'SERVICE_UNAVAILABLE'],
    [TtsFailure.UPSTREAM_AUTH, 503, 'SERVICE_UNAVAILABLE'],
    [TtsFailure.UPSTREAM_ERROR, 502, 'UPSTREAM_ERROR'],
    [TtsFailure.UPSTREAM_TIMEOUT, 504, 'UPSTREAM_TIMEOUT'],
    [TtsFailure.INVALID_INPUT, 500, 'INTERNAL_ERROR'],
  ];
  for (const [failure, status, code] of upstream) {
    it(`TTS 失败 ${failure} → ${status} ${code}，响应是统一 JSON 错误，不含音频和上游细节`, async () => {
      setTtsClient({ async synthesize() { return { ok: false, code: failure, category: 'quota_exceeded' }; } });
      const res = await call(generate, req());
      assert.equal(res.statusCode, status);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error.code, code);
      assert.equal(res.rawBody, undefined);
      assert.ok(!JSON.stringify(res.body).includes('quota'), '内部错误类别不返回给客户端');
    });
  }

  it('API Key 缺失（使用真实客户端）→ 503，且没有任何 fetch 调用', async () => {
    const fetchCalls = [];
    setTtsClient(createTtsClient({ getEnv: () => ({}), fetchImpl: async (...a) => { fetchCalls.push(a); return audioResponse(); }, logger: makeLogger().logger }));
    const res = await call(generate, req());
    assert.equal(res.statusCode, 503);
    assert.equal(fetchCalls.length, 0);
  });

  it('上游 401 经真实客户端 → 503，响应与日志不含密钥或上游错误描述', async () => {
    const log = makeLogger();
    setTtsClient(createTtsClient({ getEnv: () => ({ ELEVENLABS_API_KEY: SECRET }), fetchImpl: async () => errorResponse(401), logger: log.logger }));
    const res = await call(generate, req());
    assert.equal(res.statusCode, 503);
    assert.ok(!JSON.stringify(res.body).includes(SECRET));
    assert.ok(!log.lines.join('\n').includes(SECRET));
  });
});

describe('POST /api/generate：请求体大小与限流', () => {
  const body = () => ({ text: '你好', voiceId: VOICE, modelId: 'eleven_multilingual_v2' });
  const req = (b = body(), headers = {}) => ({ method: 'POST', headers: { 'idempotency-key': freshKey(), ...headers }, body: b });
  let calls;

  beforeEach(async () => {
    await installMockCatalog([VOICE]);
    calls = [];
    setTtsClient({ async synthesize(a) { calls.push(a); return { ok: true, audio: MP3, contentType: 'audio/mpeg' }; } });
    setGenerateLimiter(createInProcessLimiter({ max: 100 }));
  });

  it('content-length 超限 → 413，不触发上游', async () => {
    const res = await call(generate, req(body(), { 'content-length': String(MAX_BODY_BYTES + 1) }));
    assert.equal(res.statusCode, 413);
    assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(calls.length, 0);
  });

  it('请求体本身过大（无 content-length）→ 413', async () => {
    const res = await call(generate, req({ ...body(), padding: 'x'.repeat(MAX_BODY_BYTES) }));
    assert.equal(res.statusCode, 413);
    assert.equal(calls.length, 0);
  });

  it('字符串形式的超大请求体 → 413', async () => {
    const res = await call(generate, req('x'.repeat(MAX_BODY_BYTES + 1)));
    assert.equal(res.statusCode, 413);
  });

  it('超过限流 → 429 + Retry-After，且超限请求不触发上游', async () => {
    let time = 0;
    setGenerateLimiter(createInProcessLimiter({ windowMs: 60_000, max: 5, now: () => time }));
    for (let i = 0; i < 5; i += 1) assert.equal((await call(generate, req())).statusCode, 200);
    const res = await call(generate, req());
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.error.code, 'RATE_LIMITED');
    assert.equal(res.headers['retry-after'], '60');
    assert.equal(calls.length, 5);
    time = 60_001;
    assert.equal((await call(generate, req())).statusCode, 200);
  });

  it('校验失败的请求不消耗限流额度', async () => {
    setGenerateLimiter(createInProcessLimiter({ max: 1 }));
    for (let i = 0; i < 3; i += 1) assert.equal((await call(generate, req({ ...body(), text: '' }))).statusCode, 400);
    assert.equal((await call(generate, req())).statusCode, 200);
  });

  it('不同客户端 IP 分别计数', async () => {
    setGenerateLimiter(createInProcessLimiter({ max: 1 }));
    assert.equal((await call(generate, req(body(), { 'x-real-ip': '1.1.1.1' }))).statusCode, 200);
    assert.equal((await call(generate, req(body(), { 'x-real-ip': '1.1.1.1' }))).statusCode, 429);
    assert.equal((await call(generate, req(body(), { 'x-real-ip': '2.2.2.2' }))).statusCode, 200);
  });

  it('getClientKey：优先 x-real-ip，其次 x-forwarded-for 首项，否则 unknown', () => {
    assert.equal(getClientKey({ headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' } }), '9.9.9.9');
    assert.equal(getClientKey({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } }), '1.1.1.1');
    assert.equal(getClientKey({ headers: {} }), 'unknown');
  });

  it('限流器：满载时拒绝新来源而不是无限增长，且明确标记为不可靠', () => {
    const limiter = createInProcessLimiter({ max: 1 });
    assert.equal(limiter.reliable, false);
    for (let i = 0; i < 5000; i += 1) limiter.check(`k${i}`);
    assert.equal(limiter.check('new').allowed, false);
  });
});
