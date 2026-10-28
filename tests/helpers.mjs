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

export const VALID_UUID = '3f2b8c1e-6a4d-4e2f-9b1a-7c5d8e9f0a1b';
export const VALID_VOICE_ID = 'demoVoice0001';
