// ElevenLabs 文字转语音（服务端）
//
// POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
// 密钥只在服务端通过 xi-api-key 请求头发送，绝不进入响应、错误详情或日志。
//
// 安全约束：
// * 上游地址和输出格式固定；voice_id 只来自已通过白名单校验的值，并经过格式校验后放入路径，
//   不接受任何来自客户端的 URL、请求头或额外模型参数。
// * 请求体只包含 text、model_id 和经过校验的 voice_settings。
// * 不自动重试（429 / 5xx / 超时都不重试），避免重复计费；是否重试由用户决定。
// * 不返回上游原始错误体，只在服务端日志里记录错误类别。
// * 不缓存文本或音频。

import { ALLOWED_MODELS, MAX_AUDIO_BYTES, MAX_TEXT_LENGTH, TTS_TIMEOUT_MS, VOICE_SETTING_RANGES } from './config.js';
import { ErrorCodes, sendError } from './http.js';
import { logger as defaultLogger } from './logger.js';
import { isVoiceId } from './validation.js';

export const ELEVENLABS_TTS_BASE_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
export const OUTPUT_FORMAT = 'mp3_44100_128';
export const AUDIO_CONTENT_TYPE = 'audio/mpeg';

export const TtsFailure = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  UPSTREAM_AUTH: 'UPSTREAM_AUTH',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  INVALID_INPUT: 'INVALID_INPUT',
});

const VOICE_SETTING_KEYS = [...Object.keys(VOICE_SETTING_RANGES), 'use_speaker_boost'];

// 只挑选项目确实需要且上游支持的字段
export function buildVoiceSettings(settings) {
  const out = {};
  for (const key of VOICE_SETTING_KEYS) {
    if (settings && Object.hasOwn(settings, key)) out[key] = settings[key];
  }
  return out;
}

export function buildTtsRequest({ voiceId, text, modelId, settings }) {
  const body = { text, model_id: modelId };
  const voiceSettings = buildVoiceSettings(settings);
  if (Object.keys(voiceSettings).length) body.voice_settings = voiceSettings;
  return {
    url: `${ELEVENLABS_TTS_BASE_URL}/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`,
    body,
  };
}

// 只提取上游错误的“类别”用于内部日志（如 quota_exceeded），不读取、不记录错误描述
async function readErrorCategory(response) {
  try {
    const payload = await response.json();
    const status = payload?.detail?.status;
    return typeof status === 'string' && /^[a-z_]{1,40}$/.test(status) ? status : 'unknown';
  } catch {
    return 'unknown';
  }
}

// 读取响应体并限制大小：超过上限立即取消读取并返回 null，不会把超大响应整个读进内存。
// 响应体读取同样受 AbortSignal 约束（超时会中断）。没有流接口的实现（如测试里的简化对象）退回 arrayBuffer。
async function readLimited(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function createTtsClient({
  getEnv = () => process.env,
  // 延迟读取全局 fetch，便于测试时整体替换
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = TTS_TIMEOUT_MS,
  maxAudioBytes = MAX_AUDIO_BYTES,
  now = () => Date.now(),
  logger = defaultLogger,
} = {}) {
  // maybeCharged：上游是否“可能已经计费”。超时、网络中断、5xx、响应异常时无法确定，按“可能已计费”处理；
  // 未配置、输入无效、401/403 以及 4xx（含 429）是上游在生成前就拒绝的，视为未计费。
  const fail = (code, category, maybeCharged = false) => ({ ok: false, code, category, maybeCharged });

  return {
    // 返回 { ok: true, audio: Buffer, contentType } 或 { ok: false, code, category }
    // timeoutMs 可由调用方按剩余时间预算收紧，但不会超过客户端默认上限
    async synthesize({ voiceId, text, modelId, settings, timeoutMs: requestedTimeoutMs }) {
      // 纵深防御：调用方应已完成全部校验，这里再确认一次，任何不合法的输入都不会发出上游请求
      if (
        !isVoiceId(voiceId) ||
        typeof text !== 'string' || !text.trim() || [...text].length > MAX_TEXT_LENGTH ||
        !ALLOWED_MODELS.includes(modelId)
      ) {
        return fail(TtsFailure.INVALID_INPUT, 'invalid_input');
      }
      const apiKey = getEnv().ELEVENLABS_API_KEY;
      if (!apiKey) return fail(TtsFailure.NOT_CONFIGURED, 'not_configured');

      const { url, body } = buildTtsRequest({ voiceId, text, modelId, settings });
      const startedAt = now();
      const controller = new AbortController();
      const effectiveTimeoutMs = Math.min(timeoutMs, Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0 ? requestedTimeoutMs : timeoutMs);
      const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
      const elapsed = () => now() - startedAt;

      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: AUDIO_CONTENT_TYPE },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const category = await readErrorCategory(response);
          logger.warn('tts_upstream_error', { status: response.status, category, durationMs: elapsed(), characters: [...text].length, modelId });
          // 401 / 403 多为服务端密钥或额度问题：对客户端只表现为“服务暂不可用”，不泄露认证细节
          if (response.status === 401 || response.status === 403) return fail(TtsFailure.UPSTREAM_AUTH, category, false);
          return fail(TtsFailure.UPSTREAM_ERROR, category, response.status >= 500);
        }

        const contentType = (response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
        if (contentType !== 'audio/mpeg' && contentType !== 'audio/mp3') {
          logger.warn('tts_invalid_content_type', { durationMs: elapsed(), contentType: contentType.slice(0, 60) });
          return fail(TtsFailure.UPSTREAM_ERROR, 'invalid_content_type', true);
        }
        const declared = Number(response.headers?.get?.('content-length'));
        if (Number.isFinite(declared) && declared > maxAudioBytes) {
          logger.warn('tts_audio_too_large', { durationMs: elapsed(), bytes: declared });
          return fail(TtsFailure.UPSTREAM_ERROR, 'audio_too_large', true);
        }

        const audio = await readLimited(response, maxAudioBytes);
        if (audio === null) {
          logger.warn('tts_audio_too_large', { durationMs: elapsed() });
          return fail(TtsFailure.UPSTREAM_ERROR, 'audio_too_large', true);
        }
        if (audio.length === 0) {
          logger.warn('tts_empty_audio', { durationMs: elapsed() });
          return fail(TtsFailure.UPSTREAM_ERROR, 'empty_audio', true);
        }
        if (audio.length > maxAudioBytes) {
          logger.warn('tts_audio_too_large', { durationMs: elapsed(), bytes: audio.length });
          return fail(TtsFailure.UPSTREAM_ERROR, 'audio_too_large', true);
        }

        logger.info('tts_success', { durationMs: elapsed(), characters: [...text].length, modelId, bytes: audio.length });
        return { ok: true, audio, contentType: AUDIO_CONTENT_TYPE };
      } catch (err) {
        if (err?.name === 'AbortError') {
          logger.warn('tts_timeout', { durationMs: elapsed(), characters: [...text].length, modelId });
          return fail(TtsFailure.UPSTREAM_TIMEOUT, 'timeout', true);
        }
        logger.warn('tts_request_failed', { durationMs: elapsed(), error: err });
        return fail(TtsFailure.UPSTREAM_ERROR, 'network', true);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

let current = createTtsClient();

export function getTtsClient() {
  return current;
}

// 仅供测试注入模拟客户端，避免对真实 ElevenLabs 发请求
export function setTtsClient(client) {
  current = client;
}

const FAILURE_TO_ERROR = {
  [TtsFailure.NOT_CONFIGURED]: ErrorCodes.SERVICE_UNAVAILABLE,
  [TtsFailure.UPSTREAM_AUTH]: ErrorCodes.SERVICE_UNAVAILABLE,
  [TtsFailure.UPSTREAM_ERROR]: ErrorCodes.UPSTREAM_ERROR,
  [TtsFailure.UPSTREAM_TIMEOUT]: ErrorCodes.UPSTREAM_TIMEOUT,
  [TtsFailure.INVALID_INPUT]: ErrorCodes.INTERNAL_ERROR,
};

export function sendTtsFailure(res, failure, { requestId }) {
  sendError(res, FAILURE_TO_ERROR[failure.code] || ErrorCodes.UPSTREAM_ERROR, { requestId, details: { feature: 'generate' } });
}
