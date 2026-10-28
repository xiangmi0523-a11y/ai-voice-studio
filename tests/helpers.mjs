// 测试工具：模拟 Vercel Node 运行时的 req / res

export function mockReq({ method = 'GET', headers = {}, query = {}, body } = {}) {
  return { method, headers, query, body };
}

export function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(payload) {
      this.headersSent = true;
      if (Buffer.isBuffer(payload)) {
        this.rawBody = payload;
        return;
      }
      this.body = payload ? JSON.parse(payload) : undefined;
    },
  };
  return res;
}

export async function call(handler, reqOptions) {
  const res = mockRes();
  await handler(mockReq(reqOptions), res);
  return res;
}

import { randomUUID } from 'node:crypto';

// 每个生成请求用新的幂等键（服务端会对重复键返回 409）
export const freshKey = () => randomUUID();

export const VALID_UUID = '3f2b8c1e-6a4d-4e2f-9b1a-7c5d8e9f0a1b';
// 模拟的“真实”音色 ID（格式与 ElevenLabs 的 voice_id 相同，但只存在于测试用的模拟白名单中）
export const VALID_VOICE_ID = 'realVoice12345';

// 安装一个只返回模拟数据的音色目录，测试中不会向 ElevenLabs 发任何请求
// publicIds 缺省时与 voiceIds 相同（即“全部公开”），可单独传入以测试“存在但未公开”
export async function installMockCatalog(voiceIds = [VALID_VOICE_ID], { publicIds = voiceIds, voices } = {}) {
  const { createVoiceCatalog, setVoiceCatalog } = await import('../lib/voice-catalog.js');
  const list = voices || voiceIds.map((id) => ({ voice_id: id, name: `Voice ${id}` }));
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ voices: list }) });
  const env = { ELEVENLABS_API_KEY: 'test-key-not-real', PUBLIC_VOICE_IDS: publicIds.join(',') };
  setVoiceCatalog(createVoiceCatalog({ getEnv: () => env, fetchImpl }));
}

export const FAKE_AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);

// 安装模拟 TTS 客户端与宽松限流器。返回调用记录，测试不会访问真实 ElevenLabs
export async function installMockTts({ audio = FAKE_AUDIO, failure } = {}) {
  const { setTtsClient } = await import('../lib/tts.js');
  const { setGenerateLimiter } = await import('../lib/rate-limit.js');
  const calls = [];
  setTtsClient({
    async synthesize(args) {
      calls.push(args);
      if (failure) return { ok: false, code: failure, category: "mock" };
      return { ok: true, audio, contentType: 'audio/mpeg' };
    },
  });
  setGenerateLimiter({ reliable: false, check: () => ({ allowed: true, retryAfterSeconds: 0 }) });
  return calls;
}
