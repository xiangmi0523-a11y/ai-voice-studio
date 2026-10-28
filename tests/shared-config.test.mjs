// 前端展示配置必须与服务端白名单一致
import assert from 'node:assert/strict';
import { it } from 'node:test';

import * as client from '../public/js/config.js';
import * as server from '../lib/config.js';

it('最大字数一致', () => {
  assert.equal(client.MAX_TEXT_LENGTH, server.MAX_TEXT_LENGTH);
});

it('模型列表与服务端白名单一致', () => {
  assert.deepEqual(client.MODELS.map((m) => m.id), [...server.ALLOWED_MODELS]);
});

it('参数范围一致，且默认值在范围内', () => {
  for (const s of client.VOICE_SETTINGS) {
    const range = server.VOICE_SETTING_RANGES[s.key];
    assert.ok(range, `服务端缺少参数 ${s.key}`);
    assert.equal(s.min, range.min);
    assert.equal(s.max, range.max);
    assert.ok(s.default >= s.min && s.default <= s.max);
  }
  assert.equal(client.VOICE_SETTINGS.length, Object.keys(server.VOICE_SETTING_RANGES).length);
});

it('版本号一致', () => {
  assert.equal(client.APP_VERSION, server.APP_VERSION);
});

it('按语速限制字数的规则一致', () => {
  assert.equal(client.MAX_SPEED_ADJUSTED_CHARS, server.MAX_SPEED_ADJUSTED_CHARS);
  for (const speed of [undefined, 0, 0.7, 0.85, 1, 1.2]) {
    assert.equal(client.maxCharsForSpeed(speed), server.maxCharsForSpeed(speed), `speed=${speed}`);
  }
});
