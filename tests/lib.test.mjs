import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readBearerToken } from '../lib/auth.js';
import { redact } from '../lib/logger.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { buildAudioPath } from '../lib/storage.js';
import { isUuid, isVoiceId, validateText, validateVoiceSettings } from '../lib/validation.js';
import { VALID_UUID } from './helpers.mjs';

describe('validation', () => {
  it('isUuid', () => {
    assert.ok(isUuid(VALID_UUID));
    assert.ok(!isUuid('not-a-uuid'));
    assert.ok(!isUuid(`${VALID_UUID}/../x`));
    assert.ok(!isUuid(undefined));
  });
  it('isVoiceId 只允许字母数字', () => {
    assert.ok(isVoiceId('21m00Tcm4TlvDq8ikWAM'));
    assert.ok(!isVoiceId('short'));
    assert.ok(!isVoiceId('abc-def-ghi'));
    assert.ok(!isVoiceId('a'.repeat(65)));
  });
  it('validateText 去除首尾空白，按码点计数', () => {
    assert.deepEqual(validateText('  hi  '), { ok: true, value: 'hi' });
    assert.equal(validateText('😀'.repeat(1000)).ok, true);
    assert.equal(validateText('😀'.repeat(1001)).ok, false);
    assert.equal(validateText(123).ok, false);
  });
  it('validateVoiceSettings', () => {
    assert.equal(validateVoiceSettings(undefined).ok, true);
    assert.equal(validateVoiceSettings([]).ok, false);
    assert.equal(validateVoiceSettings({ stability: Number.NaN }).ok, false);
    assert.equal(validateVoiceSettings({ use_speaker_boost: 'yes' }).ok, false);
    assert.deepEqual(validateVoiceSettings({ stability: 0, speed: 1.2 }), { ok: true, value: { stability: 0, speed: 1.2 } });
  });
});

describe('logger.redact', () => {
  it('遮蔽敏感字段名和疑似凭证', () => {
    const out = redact({
      headers: { authorization: 'Bearer abc.def.ghi', 'x-other': 'ok' },
      apiKey: 'sk_live_1234567890',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      message: 'failed with Bearer secret-token-value',
      nested: { list: ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'] },
    });
    assert.equal(out.headers.authorization, '[REDACTED]');
    assert.equal(out.headers['x-other'], 'ok');
    assert.equal(out.apiKey, '[REDACTED]');
    assert.equal(out.SUPABASE_SERVICE_ROLE_KEY, '[REDACTED]');
    assert.ok(!out.message.includes('secret-token-value'));
    assert.equal(out.nested.list[0], '[REDACTED]');
  });
  it('处理 Error 对象', () => {
    const out = redact(new Error('token Bearer abc123'));
    assert.equal(out.name, 'Error');
    assert.ok(!out.message.includes('abc123'));
  });
});

describe('storage.buildAudioPath', () => {
  it('只接受 UUID 并生成 <user>/<id>.mp3', () => {
    assert.equal(buildAudioPath(VALID_UUID, VALID_UUID.toUpperCase()), `${VALID_UUID}/${VALID_UUID}.mp3`);
    assert.throws(() => buildAudioPath('../other-user', VALID_UUID));
    assert.throws(() => buildAudioPath(VALID_UUID, 'file.mp3'));
  });
});

describe('auth.readBearerToken', () => {
  it('解析 Bearer 令牌', () => {
    assert.equal(readBearerToken({ headers: { authorization: 'Bearer a.b.c' } }), 'a.b.c');
    assert.equal(readBearerToken({ headers: { authorization: 'Basic xyz' } }), null);
    assert.equal(readBearerToken({ headers: {} }), null);
  });
});

describe('rate-limit 占位', () => {
  it('第一阶段明确标记为未生效', async () => {
    assert.deepEqual(await checkRateLimit('generate', 'u'), { enforced: false, allowed: true });
  });
});
