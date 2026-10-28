// 服务端音色白名单与生成参数校验
//
// 本文件所有用例都使用模拟的 fetch，不会向真实 ElevenLabs 发请求。
// 为防止误用，整个文件运行期间全局 fetch 被替换为直接抛错。
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import generate from '../api/generate.js';
import health from '../api/health.js';
import voices from '../api/voices.js';
import { DEMO_VOICE_IDS, isKnownDemoVoiceId } from '../lib/demo-voices.js';
import {
  CatalogFailure,
  createVoiceCatalog,
  ELEVENLABS_VOICES_URL,
  normalizeVoice,
  setVoiceCatalog,
} from '../lib/voice-catalog.js';
import { DEMO_VOICES } from '../public/js/services/demo-data.js';
import { VALID_UUID, call, freshKey, installMockTts } from './helpers.mjs';

const REAL_ID = 'realVoice12345';
const OTHER_REAL_ID = '21m00Tcm4TlvDq8ikWAM';
const UNKNOWN_ID = 'unknownVoice999';
const SECRET = 'xi-test-secret-key-do-not-leak';
const PUBLIC_ENV_VALUE = `${REAL_ID},${OTHER_REAL_ID}`;
const NO_KEY_ENV = { PUBLIC_VOICE_IDS: PUBLIC_ENV_VALUE };

const realFetch = globalThis.fetch;
before(async () => {
  await installMockTts();
  globalThis.fetch = () => {
    throw new Error('测试中禁止真实网络请求');
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

const okResponse = (voiceList) => ({ ok: true, status: 200, json: async () => ({ voices: voiceList }) });
const rawVoice = (id, extra = {}) => ({ voice_id: id, name: `Voice ${id}`, ...extra });

// 构造一个带调用计数的模拟目录
function mockCatalog({ voiceList = [rawVoice(REAL_ID), rawVoice(OTHER_REAL_ID)], env = { ELEVENLABS_API_KEY: SECRET, PUBLIC_VOICE_IDS: PUBLIC_ENV_VALUE }, fetchImpl, ...options } = {}) {
  const calls = [];
  const impl = fetchImpl || (async (url, init) => okResponse(voiceList));
  const catalog = createVoiceCatalog({
    getEnv: () => env,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return impl(url, init);
    },
    logger: { warn() {}, error() {}, info() {} },
    ...options,
  });
  return { catalog, calls };
}

const validBody = (overrides = {}) => ({
  text: '你好，世界',
  voiceId: REAL_ID,
  modelId: 'eleven_multilingual_v2',
  settings: { stability: 0.5, speed: 1, use_speaker_boost: true },
  ...overrides,
});
const NO_BODY = Symbol('no body');
const generateReq = (body = validBody(), headers = { 'idempotency-key': freshKey() }) => ({ method: 'POST', headers, body: body === NO_BODY ? undefined : body });

function errorFields(res) {
  return (res.body.error.details?.errors || []).map((e) => e.field);
}

describe('voice-catalog：拉取与缓存', () => {
  it('带密钥请求 ElevenLabs，并只返回前端需要的字段', async () => {
    const { catalog, calls } = mockCatalog({
      voiceList: [
        rawVoice(REAL_ID, {
          description: '温暖',
          labels: { gender: 'Female', language: 'zh', accent: 'neutral', use_case: 'narration', secret_field: 'x' },
          preview_url: 'https://storage.example.com/p.mp3', // 不在 CSP 允许的域名内 → 不返回
          category: 'premade',
          settings: { stability: 1 },
        }),
      ],
    });
    const result = await catalog.load();
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, ELEVENLABS_VOICES_URL);
    assert.equal(calls[0].init.headers['xi-api-key'], SECRET);
    assert.deepEqual(result.voices, [
      { id: REAL_ID, name: `Voice ${REAL_ID}`, description: '温暖', gender: 'female', language: 'zh', tags: ['neutral', 'narration'], previewUrl: null },
    ]);
    assert.ok(!JSON.stringify(result.voices).includes(SECRET));
    assert.ok(result.ids.has(REAL_ID));
  });

  it('TTL 内命中缓存，不重复请求；过期后重新拉取', async () => {
    let time = 1000;
    const { catalog, calls } = mockCatalog({ now: () => time, ttlMs: 5000 });
    assert.equal((await catalog.load()).cached, false);
    time += 4999;
    assert.equal((await catalog.load()).cached, true);
    assert.equal(calls.length, 1);
    time += 2;
    assert.equal((await catalog.load()).cached, false);
    assert.equal(calls.length, 2);
  });

  it('并发请求只会触发一次上游拉取', async () => {
    const { catalog, calls } = mockCatalog();
    const results = await Promise.all([catalog.load(), catalog.load(), catalog.load()]);
    assert.ok(results.every((r) => r.ok));
    assert.equal(calls.length, 1);
  });

  it('丢弃格式不合法的条目', async () => {
    const { catalog } = mockCatalog({
      voiceList: [rawVoice(REAL_ID), rawVoice('../etc/passwd'), rawVoice('short'), { voice_id: OTHER_REAL_ID }, null, 'str', rawVoice(12345678)],
    });
    const result = await catalog.load();
    assert.deepEqual([...result.ids], [REAL_ID]);
  });

  it('normalizeVoice：非男女性别置空，非 https 试听链接置空', () => {
    const v = normalizeVoice(rawVoice(REAL_ID, { labels: { gender: 'neutral' }, preview_url: 'http://x/y.mp3' }));
    assert.equal(v.gender, null);
    assert.equal(v.previewUrl, null);
  });
});

describe('voice-catalog：安全失败关闭', () => {
  it('未配置密钥 → NOT_CONFIGURED，且不发任何请求', async () => {
    const { catalog, calls } = mockCatalog({ env: NO_KEY_ENV });
    assert.deepEqual(await catalog.load(), { ok: false, code: CatalogFailure.NOT_CONFIGURED });
    assert.equal(calls.length, 0);
  });

  const failures = [
    ['网络错误', () => { throw new TypeError('fetch failed'); }, CatalogFailure.UPSTREAM_ERROR],
    ['上游 401', async () => ({ ok: false, status: 401, json: async () => ({}) }), CatalogFailure.UPSTREAM_ERROR],
    ['上游 429', async () => ({ ok: false, status: 429, json: async () => ({}) }), CatalogFailure.UPSTREAM_ERROR],
    ['上游 500', async () => ({ ok: false, status: 500, json: async () => ({}) }), CatalogFailure.UPSTREAM_ERROR],
    ['响应不是 JSON', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }), CatalogFailure.UPSTREAM_ERROR],
    ['响应缺少 voices', async () => ({ ok: true, status: 200, json: async () => ({}) }), CatalogFailure.UPSTREAM_ERROR],
    ['音色列表为空', async () => okResponse([]), CatalogFailure.UPSTREAM_ERROR],
    ['全部条目都不合法', async () => okResponse([rawVoice('bad id')]), CatalogFailure.UPSTREAM_ERROR],
  ];
  for (const [name, fetchImpl, code] of failures) {
    it(`${name} → ${code}`, async () => {
      const { catalog } = mockCatalog({ fetchImpl });
      assert.deepEqual(await catalog.load(), { ok: false, code });
    });
  }

  it('超时 → UPSTREAM_TIMEOUT', async () => {
    const fetchImpl = (_url, init) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const { catalog } = mockCatalog({ fetchImpl, timeoutMs: 10 });
    assert.deepEqual(await catalog.load(), { ok: false, code: CatalogFailure.UPSTREAM_TIMEOUT });
  });

  it('失败不会被缓存：恢复后下一次请求可成功', async () => {
    let healthy = false;
    const { catalog, calls } = mockCatalog({
      fetchImpl: async () => (healthy ? okResponse([rawVoice(REAL_ID)]) : { ok: false, status: 500, json: async () => ({}) }),
    });
    assert.equal((await catalog.load()).ok, false);
    healthy = true;
    assert.equal((await catalog.load()).ok, true);
    assert.equal(calls.length, 2);
  });

  it('缓存过期后拉取失败：不使用旧数据，直接拒绝', async () => {
    let time = 0;
    let healthy = true;
    const { catalog } = mockCatalog({
      now: () => time,
      ttlMs: 1000,
      fetchImpl: async () => (healthy ? okResponse([rawVoice(REAL_ID)]) : { ok: false, status: 503, json: async () => ({}) }),
    });
    assert.equal((await catalog.load()).ok, true);
    time = 5000;
    healthy = false;
    assert.deepEqual(await catalog.load(), { ok: false, code: CatalogFailure.UPSTREAM_ERROR });
  });

  it('日志和错误结果中不包含密钥', async () => {
    const logged = [];
    const logger = { warn: (...a) => logged.push(JSON.stringify(a)), error() {}, info() {} };
    const { catalog } = mockCatalog({
      logger,
      fetchImpl: async () => {
        throw new Error(`request failed with key ${SECRET}`);
      },
    });
    const result = await catalog.load();
    assert.ok(!JSON.stringify(result).includes(SECRET));
    assert.ok(logged.length > 0);
    // 注意：这里用的是测试自带的简易 logger，真实 logger 会经过 redact；
    // 此处只确认结果对象不含密钥
  });
});

describe('GET /api/voices', () => {
  beforeEach(() => setVoiceCatalog(mockCatalog().catalog));

  it('返回真实音色列表（统一成功格式），响应中不含密钥', async () => {
    const res = await call(voices, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.data.voices.map((v) => v.id), [REAL_ID, OTHER_REAL_ID]);
    assert.equal(res.body.data.cached, false);
    assert.equal(typeof res.body.requestId, 'string');
    assert.ok(!JSON.stringify(res.body).includes(SECRET));
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal((await call(voices, { method: 'GET' })).body.data.cached, true);
  });

  const failures = [
    ['未配置密钥', { env: NO_KEY_ENV }, 503, 'SERVICE_UNAVAILABLE'],
    ['上游错误', { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }, 502, 'UPSTREAM_ERROR'],
    ['上游超时', { fetchImpl: (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))), timeoutMs: 10 }, 504, 'UPSTREAM_TIMEOUT'],
  ];
  for (const [name, options, status, code] of failures) {
    it(`${name} → ${status} ${code}（统一错误格式，不暴露上游细节）`, async () => {
      setVoiceCatalog(mockCatalog(options).catalog);
      const res = await call(voices, { method: 'GET' });
      assert.equal(res.statusCode, status);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error.code, code);
      assert.ok(res.body.error.message.length > 0);
      assert.ok(!JSON.stringify(res.body).includes(SECRET));
    });
  }

  it('非 GET 仍返回 405', async () => {
    assert.equal((await call(voices, { method: 'POST' })).statusCode, 405);
  });
});

describe('POST /api/generate：音色白名单', () => {
  let current;
  beforeEach(() => {
    current = mockCatalog();
    setVoiceCatalog(current.catalog);
  });

  it('白名单内的音色通过校验并进入（模拟的）生成调用', async () => {
    for (const id of [REAL_ID, OTHER_REAL_ID]) {
      const res = await call(generate, generateReq(validBody({ voiceId: id })));
      assert.equal(res.statusCode, 200, id);
      assert.equal(res.headers['content-type'], 'audio/mpeg');
    }
  });

  it('未知音色（格式合法但不在白名单）→ 400', async () => {
    const res = await call(generate, generateReq(validBody({ voiceId: UNKNOWN_ID })));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.deepEqual(errorFields(res), ['voiceId']);
  });

  it('DEMO 音色 → 400，且不会触发任何上游请求（即使白名单当前不可用也是 400 而不是 5xx）', async () => {
    setVoiceCatalog((current = mockCatalog({ env: NO_KEY_ENV })).catalog);
    for (const id of DEMO_VOICE_IDS) {
      const res = await call(generate, generateReq(validBody({ voiceId: id })));
      assert.equal(res.statusCode, 400, id);
      assert.deepEqual(errorFields(res), ['voiceId']);
    }
    assert.equal(current.calls.length, 0);
  });

  it('即使上游白名单里（被污染地）出现了 DEMO ID，也仍然拒绝', async () => {
    setVoiceCatalog((current = mockCatalog({ voiceList: [rawVoice(DEMO_VOICE_IDS[0]), rawVoice(REAL_ID)] })).catalog);
    const res = await call(generate, generateReq(validBody({ voiceId: DEMO_VOICE_IDS[0] })));
    assert.equal(res.statusCode, 400);
  });

  it('伪造 isDemo: false 不能让 DEMO 或未知音色通过', async () => {
    for (const voiceId of [DEMO_VOICE_IDS[0], UNKNOWN_ID]) {
      for (const extra of [{ isDemo: false }, { voice: { isDemo: false } }, { voice: { id: voiceId, isDemo: false } }]) {
        const res = await call(generate, generateReq({ ...validBody({ voiceId }), ...extra }));
        assert.equal(res.statusCode, 400, `${voiceId} ${JSON.stringify(extra)}`);
        assert.deepEqual(errorFields(res), ['voiceId']);
      }
    }
  });

  it('请求体里的 isDemo 标记被忽略，不影响白名单内音色的结果', async () => {
    const res = await call(generate, generateReq({ ...validBody(), isDemo: true }));
    assert.equal(res.statusCode, 200);
  });

  const badVoiceIds = [
    ['空字符串', ''],
    ['缺失', undefined],
    ['null', null],
    ['数字', 12345678],
    ['对象', { id: REAL_ID }],
    ['数组', [REAL_ID]],
    ['含路径字符', '../../etc/passwd'],
    ['含空格', 'real Voice 123'],
    ['过短', 'abc'],
    ['过长', 'a'.repeat(65)],
  ];
  for (const [name, voiceId] of badVoiceIds) {
    it(`音色 ID ${name} → 400，不触发上游请求`, async () => {
      const body = validBody();
      if (voiceId === undefined) delete body.voiceId;
      else body.voiceId = voiceId;
      const res = await call(generate, generateReq(body));
      assert.equal(res.statusCode, 400);
      assert.ok(errorFields(res).includes('voiceId'));
      assert.equal(current.calls.length, 0);
    });
  }

  it('音色大小写敏感：白名单内 ID 的大小写变体不放行', async () => {
    const res = await call(generate, generateReq(validBody({ voiceId: REAL_ID.toUpperCase() })));
    assert.equal(res.statusCode, 400);
  });
});

describe('POST /api/generate：白名单不可用时失败关闭', () => {
  const cases = [
    ['未配置密钥', { env: NO_KEY_ENV }, 503, 'SERVICE_UNAVAILABLE'],
    ['上游 500', { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }, 502, 'UPSTREAM_ERROR'],
    ['上游网络错误', { fetchImpl: async () => { throw new TypeError('fetch failed'); } }, 502, 'UPSTREAM_ERROR'],
    ['上游返回空列表', { voiceList: [] }, 502, 'UPSTREAM_ERROR'],
    ['上游超时', { fetchImpl: (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))), timeoutMs: 10 }, 504, 'UPSTREAM_TIMEOUT'],
  ];
  for (const [name, options, status, code] of cases) {
    it(`${name}：格式合法的音色也被拒绝（${status} ${code}），绝不放行`, async () => {
      setVoiceCatalog(mockCatalog(options).catalog);
      const res = await call(generate, generateReq(validBody({ voiceId: REAL_ID })));
      assert.equal(res.statusCode, status);
      assert.equal(res.body.error.code, code);
      assert.notEqual(res.statusCode, 200);
      assert.ok(!JSON.stringify(res.body).includes(SECRET));
    });
  }

  it('没拉到缓存也没有密钥时，连未知音色也只会得到拒绝而不是放行', async () => {
    setVoiceCatalog(mockCatalog({ env: NO_KEY_ENV }).catalog);
    const res = await call(generate, generateReq(validBody({ voiceId: UNKNOWN_ID })));
    assert.equal(res.statusCode, 503);
  });

  it('缓存过期后上游故障：不使用旧白名单', async () => {
    let time = 0;
    let healthy = true;
    setVoiceCatalog(
      mockCatalog({
        now: () => time,
        ttlMs: 1000,
        fetchImpl: async () => (healthy ? okResponse([rawVoice(REAL_ID)]) : { ok: false, status: 500, json: async () => ({}) }),
      }).catalog,
    );
    assert.equal((await call(generate, generateReq())).statusCode, 200);
    time = 10_000;
    healthy = false;
    assert.equal((await call(generate, generateReq())).statusCode, 502);
  });
});

describe('POST /api/generate：参数与请求体校验（均在访问上游之前拒绝）', () => {
  let current;
  beforeEach(() => {
    current = mockCatalog();
    setVoiceCatalog(current.catalog);
  });

  const invalid = [
    ['请求体缺失', () => NO_BODY, 'body'],
    ['请求体是字符串', () => 'text=hello', 'body'],
    ['请求体是数组', () => [validBody()], 'body'],
    ['请求体是数字', () => 42, 'body'],
    ['文本缺失', () => { const b = validBody(); delete b.text; return b; }, 'text'],
    ['文本为 null', () => validBody({ text: null }), 'text'],
    ['文本是数字', () => validBody({ text: 123 }), 'text'],
    ['文本是数组', () => validBody({ text: ['你好'] }), 'text'],
    ['文本为空', () => validBody({ text: '' }), 'text'],
    ['文本只有空白', () => validBody({ text: ' \n\t ' }), 'text'],
    ['文本超过 1000 字', () => validBody({ text: '字'.repeat(1001) }), 'text'],
    ['文本超过 1000 个码点（emoji）', () => validBody({ text: '😀'.repeat(1001) }), 'text'],
    ['modelId 缺失', () => { const b = validBody(); delete b.modelId; return b; }, 'modelId'],
    ['modelId 不在白名单', () => validBody({ modelId: 'eleven_unknown' }), 'modelId'],
    ['modelId 不是字符串', () => validBody({ modelId: ['eleven_multilingual_v2'] }), 'modelId'],
    ['modelId 带空格', () => validBody({ modelId: ' eleven_multilingual_v2' }), 'modelId'],
    ['settings 是字符串', () => validBody({ settings: 'default' }), 'settings'],
    ['settings 是数组', () => validBody({ settings: [] }), 'settings'],
    ['settings 为 null', () => validBody({ settings: null }), 'settings'],
    ['stability 超出范围', () => validBody({ settings: { stability: 1.5 } }), 'settings.stability'],
    ['speed 低于下限', () => validBody({ settings: { speed: 0.5 } }), 'settings.speed'],
    ['speed 是字符串', () => validBody({ settings: { speed: '1' } }), 'settings.speed'],
    ['参数是 null', () => validBody({ settings: { style: null } }), 'settings.style'],
    ['use_speaker_boost 不是布尔', () => validBody({ settings: { use_speaker_boost: 'yes' } }), 'settings.use_speaker_boost'],
    ['未知参数', () => validBody({ settings: { temperature: 1 } }), 'settings.temperature'],
  ];
  for (const [name, makeBody, field] of invalid) {
    it(`${name} → 400 VALIDATION_ERROR（字段 ${field}），不触发上游请求`, async () => {
      const res = await call(generate, generateReq(makeBody()));
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error.message.length > 0);
      assert.ok(errorFields(res).includes(field), `应包含 ${field}，实际 ${errorFields(res)}`);
      assert.equal(current.calls.length, 0);
    });
  }

  it('幂等键缺失或无效 → 400', async () => {
    for (const headers of [{}, { 'idempotency-key': 'abc' }, { 'idempotency-key': `${VALID_UUID}x` }]) {
      const res = await call(generate, generateReq(validBody(), headers));
      assert.equal(res.statusCode, 400);
      assert.ok(errorFields(res).includes('Idempotency-Key'));
    }
    assert.equal(current.calls.length, 0);
  });

  it('多个字段同时非法时一次性返回全部错误', async () => {
    const res = await call(generate, generateReq({ text: '', voiceId: 'x', modelId: 'y', settings: [] }, {}));
    assert.deepEqual(errorFields(res).sort(), ['Idempotency-Key', 'modelId', 'settings', 'text', 'voiceId']);
  });

  it('边界合法值（1000 字、参数上下限、省略 settings）可通过校验并生成', async () => {
    const bodies = [
      validBody({ text: '字'.repeat(1000) }),
      validBody({ settings: { stability: 0, similarity_boost: 1, style: 0, speed: 0.7 } }),
      validBody({ settings: { speed: 1.2 } }),
      (() => { const b = validBody(); delete b.settings; return b; })(),
    ];
    for (const body of bodies) {
      const res = await call(generate, generateReq(body));
      assert.equal(res.statusCode, 200);
    }
  });

  it('非 POST 仍返回 405', async () => {
    assert.equal((await call(generate, { method: 'GET' })).statusCode, 405);
  });
});

describe('DEMO 音色清单与前端保持一致', () => {
  it('服务端拦截清单与前端 DEMO 数据完全相同', () => {
    assert.deepEqual([...DEMO_VOICE_IDS].sort(), DEMO_VOICES.map((v) => v.id).sort());
  });
  it('isKnownDemoVoiceId 只识别清单内的 ID', () => {
    assert.ok(DEMO_VOICE_IDS.every(isKnownDemoVoiceId));
    assert.equal(isKnownDemoVoiceId(REAL_ID), false);
    assert.equal(isKnownDemoVoiceId(undefined), false);
    assert.equal(isKnownDemoVoiceId(null), false);
    assert.equal(isKnownDemoVoiceId({}), false);
  });
});

describe('GET /api/health 与音色配置', () => {
  it('voices/generate 功能标记需要“已配置密钥”且“已配置公开音色”，且不包含密钥或音色 ID', async () => {
    const saved = { key: process.env.ELEVENLABS_API_KEY, pub: process.env.PUBLIC_VOICE_IDS };
    const set = (k, v) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    const features = async () => (await call(health, { method: 'GET' })).body.data.features;
    try {
      set('ELEVENLABS_API_KEY', undefined);
      set('PUBLIC_VOICE_IDS', undefined);
      assert.deepEqual(await features(), { ...(await features()), voices: false, generate: false });
      set('ELEVENLABS_API_KEY', SECRET);
      assert.equal((await features()).generate, false, '只有密钥、没有公开音色：不可用');
      set('PUBLIC_VOICE_IDS', 'not valid!');
      assert.equal((await features()).generate, false, '公开音色配置无效：不可用');
      set('ELEVENLABS_API_KEY', undefined);
      set('PUBLIC_VOICE_IDS', PUBLIC_ENV_VALUE);
      assert.equal((await features()).generate, false, '只有公开音色、没有密钥：不可用');
      set('ELEVENLABS_API_KEY', SECRET);
      const res = await call(health, { method: 'GET' });
      assert.equal(res.body.data.features.voices, true);
      assert.equal(res.body.data.features.generate, true);
      const text = JSON.stringify(res.body);
      assert.ok(!text.includes(SECRET));
      assert.ok(!text.includes(REAL_ID));
    } finally {
      set('ELEVENLABS_API_KEY', saved.key);
      set('PUBLIC_VOICE_IDS', saved.pub);
    }
  });
});
