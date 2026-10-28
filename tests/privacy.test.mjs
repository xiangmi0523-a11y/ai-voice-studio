// 音色公开保护：PUBLIC_VOICE_IDS 允许列表、字段最小化、缓存与配置变化
// 全部使用虚构的测试 ID 与模拟 fetch，不访问真实 ElevenLabs。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';

import generate from '../api/generate.js';
import voices from '../api/voices.js';
import { DEMO_VOICE_IDS } from '../lib/demo-voices.js';
import { MAX_PUBLIC_VOICES, parsePublicVoiceIds } from '../lib/public-voices.js';
import { setGenerateLimiter, createInProcessLimiter } from '../lib/rate-limit.js';
import { setTtsClient } from '../lib/tts.js';
import { ALLOWED_PREVIEW_HOST_SUFFIXES, allowedPreviewUrl, createVoiceCatalog, setVoiceCatalog } from '../lib/voice-catalog.js';
import { call, freshKey } from './helpers.mjs';

const PUB1 = 'publicVoice0001';
const PUB2 = 'publicVoice0002';
const PRIV = 'privateVoice0001'; // 账号里有，但没有被公开
const CLONED = 'clonedVoice0001'; // 即使写进了允许列表也必须拒绝
const MISSING = 'missingVoice0001'; // 在允许列表里，但账号里并不存在

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = () => {
    throw new Error('测试中禁止真实网络请求');
  };
});
after(() => {
  globalThis.fetch = realFetch;
});

const account = () => [
  { voice_id: PUB1, name: '公开一号', category: 'premade', labels: { gender: 'female', language: 'zh' }, sharing: { status: 'private', owner: 'someone' }, verified_languages: [{ x: 1 }], settings: { stability: 1 }, owner_id: 'u_secret', preview_url: 'https://x.supabase.co/a.mp3' },
  { voice_id: PUB2, name: '公开二号', category: 'professional', description: '简介' },
  { voice_id: PRIV, name: '私有音色', category: 'premade' },
  { voice_id: CLONED, name: '克隆音色', category: 'cloned' },
];

function setup({ publicIds, list = account(), now = () => 0, ttlMs = 60_000 } = {}) {
  const env = { ELEVENLABS_API_KEY: 'k', PUBLIC_VOICE_IDS: publicIds };
  const state = { fetches: 0, list };
  const catalog = createVoiceCatalog({
    getEnv: () => env,
    fetchImpl: async () => {
      state.fetches += 1;
      return { ok: true, status: 200, json: async () => ({ voices: state.list }) };
    },
    now,
    ttlMs,
    logger: { info() {}, warn() {}, error() {} },
  });
  setVoiceCatalog(catalog);
  return { env, state, catalog };
}

const ids = (res) => res.body.data.voices.map((v) => v.id);

describe('parsePublicVoiceIds：失败关闭', () => {
  const none = [undefined, null, '', '   ', ',', ' , ,', 123, {}, []];
  for (const raw of none) {
    it(`未配置/为空 ${JSON.stringify(raw)} → 不公开任何音色`, () => {
      const r = parsePublicVoiceIds(raw);
      assert.equal(r.ok, false);
      assert.equal(r.ids.size, 0);
    });
  }
  const invalid = ['*', 'all', `${PUB1},bad id`, `${PUB1},../x`, `${PUB1},short`, `${PUB1};${PUB2}`, `${PUB1},${DEMO_VOICE_IDS[0]}`];
  for (const raw of invalid) {
    it(`含无效项 ${JSON.stringify(raw)} → 整个配置无效，不会只保留其中合法的部分`, () => {
      const r = parsePublicVoiceIds(raw);
      assert.equal(r.ok, false);
      assert.equal(r.ids.size, 0);
    });
  }
  it('合法配置：去空白、忽略空项、去重', () => {
    const r = parsePublicVoiceIds(` ${PUB1} , ,${PUB2},${PUB1}`);
    assert.equal(r.ok, true);
    assert.deepEqual([...r.ids], [PUB1, PUB2]);
  });
  it('数量超过上限 → 无效', () => {
    const many = Array.from({ length: MAX_PUBLIC_VOICES + 1 }, (_, i) => `voiceNumber${String(i).padStart(4, '0')}`).join(',');
    assert.equal(parsePublicVoiceIds(many).ok, false);
  });
});

describe('/api/voices：只返回明确公开的音色与字段', () => {
  it('未配置 → 200 空列表，且不请求上游，也不回退为全部音色', async () => {
    const { state } = setup({ publicIds: undefined });
    const res = await call(voices, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.voices, []);
    assert.equal(state.fetches, 0);
  });

  it('无效配置 → 同样为空，不请求上游', async () => {
    const { state } = setup({ publicIds: `${PUB1},not valid!` });
    assert.deepEqual((await call(voices, { method: 'GET' })).body.data.voices, []);
    assert.equal(state.fetches, 0);
  });

  it('只返回允许列表内且真实存在的音色；私有、克隆、不存在的均不出现', async () => {
    setup({ publicIds: `${PUB1},${PUB2},${CLONED},${MISSING}` });
    const res = await call(voices, { method: 'GET' });
    assert.deepEqual(ids(res), [PUB1, PUB2]);
    const text = JSON.stringify(res.body);
    for (const hidden of [PRIV, CLONED, MISSING, '私有音色', '克隆音色']) assert.ok(!text.includes(hidden), hidden);
  });

  it('字段最小化：只有 id/name/description/gender/language/tags/previewUrl', async () => {
    setup({ publicIds: PUB1 });
    const [voice] = (await call(voices, { method: 'GET' })).body.data.voices;
    assert.deepEqual(Object.keys(voice).sort(), ['description', 'gender', 'id', 'language', 'name', 'previewUrl', 'tags']);
    const text = JSON.stringify(voice);
    for (const leaked of ['sharing', 'owner', 'u_secret', 'verified', 'settings', 'category', 'someone']) assert.ok(!text.includes(leaked), leaked);
  });

  it('试听链接：仅 CSP 放行的域名才返回，其余为 null（ElevenLabs 域名默认被丢弃）', () => {
    assert.equal(allowedPreviewUrl('https://abc.supabase.co/p.mp3'), 'https://abc.supabase.co/p.mp3');
    for (const url of ['https://storage.googleapis.com/eleven-public/p.mp3', 'http://abc.supabase.co/p.mp3', 'https://evilsupabase.co/p.mp3', 'https://abc.supabase.co.evil.com/p.mp3', 'javascript:alert(1)', 'not a url', null, undefined, 5]) {
      assert.equal(allowedPreviewUrl(url), null, String(url));
    }
  });

  it('试听域名白名单必须被 vercel.json 的 CSP media-src 覆盖（不擅自放宽 CSP）', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const csp = JSON.stringify(config);
    const media = /media-src ([^;"]+)/.exec(csp)[1].split(' ');
    for (const suffix of ALLOWED_PREVIEW_HOST_SUFFIXES) {
      assert.ok(media.includes(`https://*${suffix}`), `media-src 未放行 ${suffix}`);
    }
  });
});

describe('/api/generate：生成权限独立于展示，并遵守同一允许列表', () => {
  let calls;
  const req = (voiceId, extra = {}) => ({ method: 'POST', headers: { 'idempotency-key': freshKey() }, body: { text: '你好', voiceId, modelId: 'eleven_flash_v2_5', ...extra } });
  beforeEach(() => {
    calls = [];
    setTtsClient({ async synthesize(a) { calls.push(a); return { ok: true, audio: Buffer.from([1, 2, 3]), contentType: 'audio/mpeg' }; } });
    setGenerateLimiter(createInProcessLimiter({ max: 100 }));
  });

  it('公开音色可以生成；账号里存在但未公开、克隆、不存在的音色一律 400 且不请求 TTS', async () => {
    setup({ publicIds: `${PUB1},${CLONED},${MISSING}` });
    assert.equal((await call(generate, req(PUB1))).statusCode, 200);
    for (const id of [PUB2, PRIV, CLONED, MISSING]) {
      const res = await call(generate, req(id));
      assert.equal(res.statusCode, 400, id);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(calls.length, 1);
  });

  it('未配置或无效的允许列表 → 503 失败关闭（不是放行），不请求 TTS', async () => {
    for (const publicIds of [undefined, '', 'bad id!']) {
      setup({ publicIds });
      const res = await call(generate, req(PUB1));
      assert.equal(res.statusCode, 503, String(publicIds));
      assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    }
    assert.equal(calls.length, 0);
  });

  it('客户端提交的 isPublic / isDemo / voice 对象不是授权依据', async () => {
    setup({ publicIds: PUB1 });
    const res = await call(generate, req(PRIV, { isPublic: true, isDemo: false, voice: { id: PRIV, isPublic: true } }));
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
  });
});

describe('缓存、过期与配置变化不会泄露未授权音色', () => {
  it('缓存命中后收紧配置：立即生效，不会继续返回/放行已撤销的音色', async () => {
    const { env, state } = setup({ publicIds: `${PUB1},${PUB2}` });
    assert.deepEqual(ids(await call(voices, { method: 'GET' })), [PUB1, PUB2]);
    env.PUBLIC_VOICE_IDS = PUB1;
    const res = await call(voices, { method: 'GET' });
    assert.deepEqual(ids(res), [PUB1]);
    assert.equal(res.body.data.cached, true, '确实命中了缓存');
    assert.equal(state.fetches, 1);
    setTtsClient({ async synthesize() { return { ok: true, audio: Buffer.from([1]), contentType: 'audio/mpeg' }; } });
    setGenerateLimiter(createInProcessLimiter({ max: 100 }));
    const gen = await call(generate, { method: 'POST', headers: { 'idempotency-key': freshKey() }, body: { text: 'a', voiceId: PUB2, modelId: 'eleven_flash_v2_5' } });
    assert.equal(gen.statusCode, 400);
  });

  it('缓存命中后配置被清空或写坏：立即回到不公开任何音色', async () => {
    const { env } = setup({ publicIds: PUB1 });
    await call(voices, { method: 'GET' });
    for (const raw of ['', undefined, 'bad id']) {
      env.PUBLIC_VOICE_IDS = raw;
      assert.deepEqual((await call(voices, { method: 'GET' })).body.data.voices, []);
    }
  });

  it('扩大配置时只会出现账号里真实存在、且非克隆的音色', async () => {
    const { env } = setup({ publicIds: PUB1 });
    await call(voices, { method: 'GET' });
    env.PUBLIC_VOICE_IDS = `${PUB1},${PRIV},${CLONED}`;
    assert.deepEqual(ids(await call(voices, { method: 'GET' })), [PUB1, PRIV]);
  });

  it('上游把某音色改为 cloned 后，缓存过期重新拉取即不再公开', async () => {
    let time = 0;
    const { state } = setup({ publicIds: `${PUB1},${PUB2}`, now: () => time, ttlMs: 1000 });
    assert.deepEqual(ids(await call(voices, { method: 'GET' })), [PUB1, PUB2]);
    state.list = state.list.map((v) => (v.voice_id === PUB2 ? { ...v, category: 'cloned' } : v));
    time = 5000;
    assert.deepEqual(ids(await call(voices, { method: 'GET' })), [PUB1]);
  });

  it('缓存过期后上游失败：返回错误，不用旧缓存继续公开', async () => {
    let time = 0;
    const { state } = setup({ publicIds: PUB1, now: () => time, ttlMs: 1000 });
    assert.equal((await call(voices, { method: 'GET' })).statusCode, 200);
    assert.equal(state.fetches, 1);
    time = 5000;
    // 让下一次拉取失败
    setVoiceCatalog(
      createVoiceCatalog({
        getEnv: () => ({ ELEVENLABS_API_KEY: 'k', PUBLIC_VOICE_IDS: PUB1 }),
        fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
        now: () => time,
        logger: { info() {}, warn() {}, error() {} },
      }),
    );
    const res = await call(voices, { method: 'GET' });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.data, undefined);
  });

  it('load() 返回的集合与列表是副本：调用方修改不会污染内部缓存', async () => {
    const { catalog } = setup({ publicIds: PUB1 });
    const first = await catalog.load();
    first.voices.push({ id: PRIV });
    first.ids.add(PRIV);
    first.voices[0].name = 'tampered';
    const second = await catalog.load();
    assert.deepEqual([...second.ids], [PUB1]);
    assert.equal(second.voices.length, 1);
    assert.equal(second.voices[0].name, '公开一号');
  });
});
