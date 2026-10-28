// 生成请求的组装、前端校验与幂等键管理
//
// 幂等键规则：同一份请求内容（文本、音色、模型、参数完全相同）在未成功前复用同一个 Idempotency-Key。
// 服务端目前只在“同一个实例”内用它做尽力而为的去重（见 lib/idempotency.js），
// 不能保证跨实例不重复生成或不重复计费。因此前端不会自动重试：
// 超时、网络中断、结果未知时，只提示用户，由用户明确确认后才使用新的键重新生成。

import { MAX_TEXT_LENGTH, maxCharsForSpeed, MODELS } from '../config.js';
import { countChars, createId } from '../core/format.js';
import { isDemoVoiceId } from './demo-data.js';

// DEMO 音色是虚构示例，不能进入真实生成流程，因此在这里拦截，不会产生任何 /api/generate 请求。
// 识别方式有两种，任一命中即拦截：音色对象带 isDemo 标记，或 voiceId 在 DEMO 数据定义中（只传 ID 时也生效）。
export function buildGeneratePayload({ text, voiceId, voice, modelId, settings }) {
  const errors = [];
  const trimmed = (text || '').trim();
  if (!trimmed) errors.push({ field: 'text', reason: '请先输入文本' });
  else if (countChars(trimmed) > MAX_TEXT_LENGTH) errors.push({ field: 'text', reason: `文本不能超过 ${MAX_TEXT_LENGTH} 字` });
  else {
    // 语速越慢音频越长，需要更短的文本
    const limit = maxCharsForSpeed(settings?.speed);
    if (countChars(trimmed) > limit) errors.push({ field: 'text', reason: `当前语速下文本不能超过 ${limit} 字（语速越慢，可生成的文本越短）` });
  }
  if (!voiceId) errors.push({ field: 'voiceId', reason: '请先选择音色' });
  else if (voice?.isDemo === true || isDemoVoiceId(voiceId)) errors.push({ field: 'voiceId', reason: 'DEMO 音色仅用于演示，不能用于生成语音' });
  if (!MODELS.some((m) => m.id === modelId)) errors.push({ field: 'modelId', reason: '请选择模型' });
  if (errors.length) return { ok: false, errors };
  return { ok: true, payload: { text: trimmed, voiceId, modelId, settings: { ...settings } } };
}

export function createIdempotencyKeeper(makeId = createId) {
  let fingerprint = null;
  let key = null;
  return {
    keyFor(payload) {
      const next = JSON.stringify(payload);
      if (next !== fingerprint || !key) {
        fingerprint = next;
        key = makeId();
      }
      return key;
    },
    // 成功后清除，下一次相同内容视为新的生成
    reset() {
      fingerprint = null;
      key = null;
    },
  };
}

// 失败后“请求是否可能已经被服务端处理并计费”无法确定的情况。
// 这些情况下绝不自动重试：只提示用户，并由用户明确确认后才发起新的生成。
const UNKNOWN_OUTCOME_CODES = new Set(['TIMEOUT', 'NETWORK_ERROR', 'UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR', 'IDEMPOTENCY_CONFLICT']);

export function isOutcomeUnknown(result) {
  if (!result || result.ok) return false;
  const code = result.error?.code;
  if (UNKNOWN_OUTCOME_CODES.has(code)) return true;
  // 平台强杀函数等非统一格式的 5xx，或 200 却读不出音频：同样无法确定
  if (code === 'BACKEND_UNAVAILABLE') return result.status >= 500 || result.status === 200;
  return false;
}

// 一次生成：只调用一次 api.generate，没有任何自动重试。
// 成功时用本地对象 URL 播放（不上传、不保存到云端），并释放上一个对象 URL。
export async function runGeneration({ api, keeper, payload, previousUrl = null, createObjectUrl = (b) => URL.createObjectURL(b), revokeObjectUrl = (u) => URL.revokeObjectURL(u) }) {
  const result = await api.generate(payload, keeper.keyFor(payload));
  if (!result.ok) {
    return { ok: false, error: result.error, requestId: result.requestId, outcomeUnknown: isOutcomeUnknown(result) };
  }
  keeper.reset();
  if (previousUrl) revokeObjectUrl(previousUrl);
  return { ok: true, url: createObjectUrl(result.data.blob), contentType: result.data.contentType };
}
