// POST /api/generate — 生成语音（ElevenLabs 文字转语音，服务端调用）
//
// 请求头：Idempotency-Key: <uuid>（当前仅校验格式；跨实例幂等需共享存储，尚未实现）
// 请求体：{ text, voiceId, modelId, settings }
// 成功：200，Content-Type: audio/mpeg，响应体就是音频二进制（不缓存，不落盘）
// 失败：统一的 JSON 错误格式（见 lib/http.js）
//
// 处理顺序（任何一步失败都不会向上游发请求）：
// 1. 请求体大小 → 请求体结构、文本、modelId、settings、幂等键
// 2. 已知 DEMO 音色 → 400
// 3. 公开音色允许列表 PUBLIC_VOICE_IDS ∩ ElevenLabs 真实音色：白名单不可用时失败关闭，
//    不在白名单内 → 400。服务端不信任请求体里的 isDemo / voice / isPublic 等任何标记
// 4. 幂等（进程内、尽力而为：只在同一实例内去重，见 lib/idempotency.js）→ 重复/未知结果返回 409
// 5. 限流（进程内、尽力而为，不是可靠的跨实例限流，见 lib/rate-limit.js）
// 6. 调用 ElevenLabs（固定地址、不重试）→ 返回音频。整个请求有总时间预算（lib/config.js），
//    目录拉取与 TTS 共用；剩余预算不足时不向上游发请求。
//
// 尚未实现（上线前需要）：用户登录、共享限流与可靠的服务端幂等、用量/费用控制、音频存储与历史记录。
import { MAX_BODY_BYTES, MIN_TTS_BUDGET_MS, REQUEST_BUDGET_MS } from '../lib/config.js';
import { createDeadline } from '../lib/deadline.js';
import { isKnownDemoVoiceId } from '../lib/demo-voices.js';
import { allowMethods, ErrorCodes, sendAudio, sendError, withErrorBoundary } from '../lib/http.js';
import { fingerprintOf, getIdempotency, IdempotencyState } from '../lib/idempotency.js';
import { logger } from '../lib/logger.js';
import { getClientKey, getGenerateLimiter } from '../lib/rate-limit.js';
import { getTtsClient, sendTtsFailure } from '../lib/tts.js';
import { readJsonBody, validateGenerateRequest } from '../lib/validation.js';
import { getVoiceCatalog, sendCatalogFailure } from '../lib/voice-catalog.js';

function rejectVoice(res, requestId, reason) {
  sendError(res, ErrorCodes.VALIDATION_ERROR, {
    requestId,
    details: { errors: [{ field: 'voiceId', reason }] },
  });
}

function bodyTooLarge(req, body) {
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return true;
  if (body && typeof body === 'object') {
    try {
      return Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES;
    } catch {
      return true;
    }
  }
  return typeof body === 'string' && Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES;
}

const IDEMPOTENCY_MESSAGES = {
  [IdempotencyState.IN_PROGRESS]: '相同的请求正在处理中，请勿重复提交。',
  [IdempotencyState.FINISHED]: '这个请求之前已经提交过，结果没有保留，可能已经产生费用。如需重新生成，请重新点击“生成语音”。',
  [IdempotencyState.UNKNOWN]: '这个请求之前已经提交，但结果未知，可能已经产生费用。如需重新生成，请确认后重新点击“生成语音”。',
  [IdempotencyState.MISMATCH]: '请求标识已被用于其他内容，请重新点击“生成语音”。',
};

export default withErrorBoundary(async (req, res, { requestId }) => {
  const deadline = createDeadline(REQUEST_BUDGET_MS);
  if (!allowMethods(req, res, ['POST'], requestId)) return;

  const body = readJsonBody(req);
  if (bodyTooLarge(req, req.body ?? body)) {
    sendError(res, ErrorCodes.PAYLOAD_TOO_LARGE, { requestId });
    return;
  }

  const result = validateGenerateRequest(body, req.headers['idempotency-key']);
  if (!result.ok) {
    sendError(res, ErrorCodes.VALIDATION_ERROR, { requestId, details: { errors: result.errors } });
    return;
  }
  const { text, voiceId, modelId, settings } = result.value;

  if (isKnownDemoVoiceId(voiceId)) {
    logger.warn('generate_rejected_demo_voice', { requestId });
    rejectVoice(res, requestId, 'DEMO 音色仅用于演示，不能用于生成语音');
    return;
  }

  const catalog = await getVoiceCatalog().load();
  if (!catalog.ok) {
    logger.warn('generate_voice_whitelist_unavailable', { requestId, reason: catalog.code });
    sendCatalogFailure(res, catalog, { requestId, feature: 'generate' });
    return;
  }
  if (!catalog.ids.has(voiceId)) {
    logger.warn('generate_rejected_unknown_voice', { requestId });
    rejectVoice(res, requestId, '音色不存在或不可用');
    return;
  }

  const idempotency = getIdempotency();
  const state = idempotency.begin(result.value.idempotencyKey, fingerprintOf(result.value));
  if (state !== IdempotencyState.NEW) {
    logger.warn('generate_idempotency_conflict', { requestId, state });
    sendError(res, ErrorCodes.IDEMPOTENCY_CONFLICT, { requestId, message: IDEMPOTENCY_MESSAGES[state], details: { state } });
    return;
  }
  const key = result.value.idempotencyKey;

  const limit = getGenerateLimiter().check(getClientKey(req));
  if (!limit.allowed) {
    idempotency.release(key);
    logger.warn('generate_rate_limited', { requestId });
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    sendError(res, ErrorCodes.RATE_LIMITED, { requestId, details: { retryAfterSeconds: limit.retryAfterSeconds } });
    return;
  }

  // 剩余预算不足：不发出注定会被平台强杀的请求（上游可能照常计费）
  const remaining = deadline.remainingMs();
  if (remaining < MIN_TTS_BUDGET_MS) {
    idempotency.release(key);
    logger.warn('generate_budget_exhausted', { requestId, remainingMs: remaining });
    sendError(res, ErrorCodes.UPSTREAM_TIMEOUT, { requestId, details: { feature: 'generate' } });
    return;
  }

  const speech = await getTtsClient().synthesize({ voiceId, text, modelId, settings, timeoutMs: remaining });
  if (!speech.ok) {
    // 可能已计费（超时、5xx、响应异常）：占住这个键，同一实例上不再用它重复发出请求
    if (speech.maybeCharged) idempotency.finish(key, IdempotencyState.UNKNOWN);
    else idempotency.release(key);
    sendTtsFailure(res, speech, { requestId });
    return;
  }
  idempotency.finish(key, IdempotencyState.FINISHED);
  sendAudio(res, speech.audio, { contentType: speech.contentType, requestId });
}, logger);
