// 本地开发服务器：路由解析与端到端请求
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createDevServer, resolveApiRoute } from '../scripts/dev-server.mjs';
import { FAKE_AUDIO, installMockCatalog, installMockTts, VALID_UUID, VALID_VOICE_ID } from './helpers.mjs';

describe('resolveApiRoute', () => {
  it('按 Vercel 规则解析', async () => {
    assert.match((await resolveApiRoute('/api/voices')).file, /api\/voices\.js$/);
    assert.match((await resolveApiRoute('/api/history')).file, /api\/history\/index\.js$/);
    const dyn = await resolveApiRoute(`/api/history/${VALID_UUID}`);
    assert.match(dyn.file, /api\/history\/\[id\]\.js$/);
    assert.deepEqual(dyn.query, { id: VALID_UUID });
    assert.deepEqual((await resolveApiRoute('/api/favorites/demoVoice0001')).query, { voiceId: 'demoVoice0001' });
    assert.equal(await resolveApiRoute('/api/nope'), null);
    assert.equal(await resolveApiRoute('/api/history/a/b'), null);
  });
});

describe('dev server', () => {
  let server;
  let base;
  before(async () => {
    await installMockCatalog();
    await installMockTts();
    server = createDevServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('提供首页和静态资源，并带安全响应头', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /声音工作室/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal((await fetch(`${base}/js/main.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  });

  it('拒绝访问 public 目录之外的文件', async () => {
    const res = await fetch(`${base}/..%2fpackage.json`);
    assert.notEqual(res.status, 200);
  });

  it('POST /api/generate 端到端返回音频二进制（模拟 TTS）', async () => {
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': VALID_UUID },
      body: JSON.stringify({ text: '你好', voiceId: VALID_VOICE_ID, modelId: 'eleven_flash_v2_5' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), FAKE_AUDIO);
  });

  it('DELETE /api/history/:id 动态路由', async () => {
    const res = await fetch(`${base}/api/history/${VALID_UUID}`, { method: 'DELETE' });
    assert.equal(res.status, 501);
  });

  it('未知接口返回统一格式 404', async () => {
    const res = await fetch(`${base}/api/unknown`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).ok, false);
  });
});
