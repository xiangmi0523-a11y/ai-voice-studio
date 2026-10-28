import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import audio from '../api/audio/[id].js';
import favoriteDelete from '../api/favorites/[voiceId].js';
import favorites from '../api/favorites/index.js';
import generate from '../api/generate.js';
import health from '../api/health.js';
import historyDelete from '../api/history/[id].js';
import history from '../api/history/index.js';
import voices from '../api/voices.js';
import { FAKE_AUDIO, VALID_UUID, VALID_VOICE_ID, call, freshKey, installMockCatalog, installMockTts } from './helpers.mjs';

// 所有需要音色白名单的用例都使用模拟目录，不会请求真实 ElevenLabs
before(async () => {
  await installMockCatalog();
  await installMockTts();
});

function assertErrorShape(res, status, code) {
  assert.equal(res.statusCode, status);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, code);
  assert.equal(typeof res.body.error.message, 'string');
  assert.ok(res.body.error.message.length > 0, '必须包含用户可读提示');
  assert.equal(typeof res.body.requestId, 'string');
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.headers['cache-control'], 'no-store');
}

const validGenerate = () => ({
  method: 'POST',
  headers: { 'idempotency-key': freshKey() },
  body: { text: '你好，世界', voiceId: VALID_VOICE_ID, modelId: 'eleven_multilingual_v2', settings: { stability: 0.5, speed: 1, use_speaker_boost: true } },
});

describe('统一返回格式与 NOT_IMPLEMENTED', () => {
  const cases = [
    ['GET /api/history', history, { method: 'GET' }],
    ['DELETE /api/history/:id', historyDelete, { method: 'DELETE', query: { id: VALID_UUID } }],
    ['GET /api/favorites', favorites, { method: 'GET' }],
    ['POST /api/favorites', favorites, { method: 'POST', body: { voiceId: VALID_VOICE_ID, voiceName: '晨曦' } }],
    ['DELETE /api/favorites/:voiceId', favoriteDelete, { method: 'DELETE', query: { voiceId: VALID_VOICE_ID } }],
    ['GET /api/audio/:id', audio, { method: 'GET', query: { id: VALID_UUID } }],
  ];
  for (const [name, handler, req] of cases) {
    it(`${name} 返回 501 NOT_IMPLEMENTED`, async () => {
      const res = await call(handler, req);
      assertErrorShape(res, 501, 'NOT_IMPLEMENTED');
      assert.equal(res.body.error.details.stage, 'framework');
    });
  }
});

describe('POST /api/generate 已接入真实生成（此处仅用模拟 TTS）', () => {
  it('合法请求返回 200 音频二进制，而不是 501', async () => {
    const res = await call(generate, validGenerate());
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'audio/mpeg');
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(res.rawBody, FAKE_AUDIO);
  });
});

describe('请求方式校验', () => {
  const cases = [
    [voices, 'POST', 'GET'],
    [generate, 'GET', 'POST'],
    [history, 'POST', 'GET'],
    [historyDelete, 'GET', 'DELETE'],
    [favorites, 'PUT', 'GET, POST'],
    [favoriteDelete, 'POST', 'DELETE'],
    [audio, 'DELETE', 'GET'],
    [health, 'POST', 'GET'],
  ];
  for (const [handler, method, allow] of cases) {
    it(`${method} 不被允许时返回 405 并带 Allow 头（${allow}）`, async () => {
      const res = await call(handler, { method });
      assertErrorShape(res, 405, 'METHOD_NOT_ALLOWED');
      assert.equal(res.headers.allow, allow);
    });
  }
});

describe('POST /api/generate 输入校验', () => {
  const invalid = [
    ['空文本', (r) => { r.body.text = '   '; }, 'text'],
    ['超长文本', (r) => { r.body.text = '字'.repeat(1001); }, 'text'],
    ['非法音色 ID', (r) => { r.body.voiceId = '../../etc/passwd'; }, 'voiceId'],
    ['不在白名单的模型', (r) => { r.body.modelId = 'some_other_model'; }, 'modelId'],
    ['参数越界', (r) => { r.body.settings.speed = 3; }, 'settings.speed'],
    ['未知参数', (r) => { r.body.settings.foo = 1; }, 'settings.foo'],
    ['缺少幂等键', (r) => { r.headers = {}; }, 'Idempotency-Key'],
    ['幂等键格式错误', (r) => { r.headers['idempotency-key'] = 'abc'; }, 'Idempotency-Key'],
  ];
  for (const [name, mutate, field] of invalid) {
    it(`${name} → 400 VALIDATION_ERROR`, async () => {
      const req = validGenerate();
      mutate(req);
      const res = await call(generate, req);
      assertErrorShape(res, 400, 'VALIDATION_ERROR');
      assert.ok(res.body.error.details.errors.some((e) => e.field === field), `应指出字段 ${field}`);
    });
  }

  it('请求体不是对象 → 400', async () => {
    const res = await call(generate, { method: 'POST', headers: { 'idempotency-key': freshKey() }, body: 'not json' });
    assertErrorShape(res, 400, 'VALIDATION_ERROR');
  });

  it('正好 1000 字可以通过校验', async () => {
    const req = validGenerate();
    req.body.text = '字'.repeat(1000);
    const res = await call(generate, req);
    assert.equal(res.statusCode, 200);
    assert.ok(res.rawBody);
  });
});

describe('ID 参数校验', () => {
  it('DELETE /api/history/:id 拒绝非 UUID', async () => {
    assertErrorShape(await call(historyDelete, { method: 'DELETE', query: { id: '1 or 1=1' } }), 400, 'VALIDATION_ERROR');
  });
  it('GET /api/audio/:id 拒绝路径穿越', async () => {
    assertErrorShape(await call(audio, { method: 'GET', query: { id: '../secret' } }), 400, 'VALIDATION_ERROR');
  });
  it('DELETE /api/favorites/:voiceId 拒绝非法字符', async () => {
    assertErrorShape(await call(favoriteDelete, { method: 'DELETE', query: { voiceId: 'abc/def' } }), 400, 'VALIDATION_ERROR');
  });
  it('POST /api/favorites 缺少名称', async () => {
    assertErrorShape(await call(favorites, { method: 'POST', body: { voiceId: VALID_VOICE_ID } }), 400, 'VALIDATION_ERROR');
  });
  it('GET /api/history 拒绝越界分页', async () => {
    assertErrorShape(await call(history, { method: 'GET', query: { limit: '1000' } }), 400, 'VALIDATION_ERROR');
  });
});

describe('GET /api/health', () => {
  it('返回成功格式，且只暴露布尔配置状态', async () => {
    const before = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = 'sk_test_secret_value_123456';
    try {
      const res = await call(health, { method: 'GET' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.data.stage, 'framework');
      assert.equal(res.body.data.configured.elevenLabsConfigured, true);
      assert.ok(!JSON.stringify(res.body).includes('sk_test_secret_value'), '响应中不得包含密钥');
    } finally {
      if (before === undefined) delete process.env.ELEVENLABS_API_KEY;
      else process.env.ELEVENLABS_API_KEY = before;
    }
  });
});

describe('异常兜底', () => {
  it('处理函数抛错时返回 500 INTERNAL_ERROR 且不泄露细节', async () => {
    const { withErrorBoundary } = await import('../lib/http.js');
    const errors = [];
    const handler = withErrorBoundary(() => {
      throw new Error('db password=hunter2');
    }, { error: (...args) => errors.push(args) });
    const res = await call(handler, { method: 'GET' });
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(res.body).includes('hunter2'));
    assert.equal(errors.length, 1);
  });
});
