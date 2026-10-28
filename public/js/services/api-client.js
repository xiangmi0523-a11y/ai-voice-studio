// 前端唯一的服务端访问入口。前端只调用本应用的 /api/*，
// 不直接访问 ElevenLabs，也不持有任何密钥。
//
// 所有方法都返回统一结构：
//   { ok: true, data }  或  { ok: false, status, error: { code, message, details? } }
// 生成语音成功时服务端直接返回音频二进制，此时 data 为 { blob, contentType }。

export const ClientErrorCodes = Object.freeze({
  NETWORK_ERROR: 'NETWORK_ERROR',
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
});

const DEFAULT_TIMEOUT_MS = 30000;
// 生成请求的超时必须比服务端函数的最长执行时间（30 秒）更长：
// 否则客户端先放弃，而服务端仍在生成并计费，用户随后重试就会重复计费。
export const GENERATE_TIMEOUT_MS = 35000;

export function createApiClient({ baseUrl = '/api', fetchImpl = globalThis.fetch, getAccessToken = () => null } = {}) {
  async function request(path, { method = 'GET', body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const finalHeaders = { Accept: 'application/json', ...headers };
    if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
    const token = getAccessToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: finalHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'same-origin',
      });
    } catch (err) {
      const timedOut = err?.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        error: timedOut
          ? { code: ClientErrorCodes.TIMEOUT, message: '请求超时，请检查网络后重试。' }
          : { code: ClientErrorCodes.NETWORK_ERROR, message: '无法连接到服务端，请检查网络后重试。' },
      };
    } finally {
      clearTimeout(timer);
    }

    // 成功的音频响应（audio/*）：读成 Blob，由调用方用 URL.createObjectURL 播放
    const contentType = (response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (response.ok && contentType.startsWith('audio/')) {
      try {
        const blob = await response.blob();
        if (blob.size > 0) return { ok: true, status: response.status, data: { blob, contentType } };
      } catch {
        // 读取失败按后端不可用处理
      }
      return {
        ok: false,
        status: response.status,
        error: { code: ClientErrorCodes.BACKEND_UNAVAILABLE, message: '音频数据无效，请稍后重试。' },
      };
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    // 不是本应用的统一格式（例如纯静态预览时 /api 不存在）
    if (!payload || typeof payload.ok !== 'boolean') {
      return {
        ok: false,
        status: response.status,
        error: {
          code: ClientErrorCodes.BACKEND_UNAVAILABLE,
          message: '后端接口不可用。纯静态预览时这是正常的，部署到 Vercel 或运行 npm run dev 后可用。',
        },
      };
    }

    if (payload.ok) return { ok: true, status: response.status, data: payload.data };
    return { ok: false, status: response.status, error: payload.error, requestId: payload.requestId };
  }

  const enc = encodeURIComponent;

  return {
    request,
    getHealth: () => request('/health'),
    getVoices: () => request('/voices'),
    generate: (payload, idempotencyKey) =>
      request('/generate', { method: 'POST', body: payload, timeoutMs: GENERATE_TIMEOUT_MS, headers: { 'Idempotency-Key': idempotencyKey, Accept: 'audio/mpeg, application/json' } }),
    getHistory: ({ limit = 20 } = {}) => request(`/history?limit=${enc(limit)}`),
    deleteHistory: (id) => request(`/history/${enc(id)}`, { method: 'DELETE' }),
    getFavorites: () => request('/favorites'),
    addFavorite: (voice) => request('/favorites', { method: 'POST', body: { voiceId: voice.id, voiceName: voice.name } }),
    removeFavorite: (voiceId) => request(`/favorites/${enc(voiceId)}`, { method: 'DELETE' }),
    getAudio: (id) => request(`/audio/${enc(id)}`),
  };
}

export const api = createApiClient();
