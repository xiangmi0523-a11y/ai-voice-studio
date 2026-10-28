// 生成请求的组装、前端校验与幂等键管理
//
// 幂等键规则：同一份请求内容（文本、音色、模型、参数完全相同）在未成功前
// 复用同一个 Idempotency-Key。这样重复点击或点“重试”时，
// 服务端可以识别为同一次请求，避免重复生成和重复扣费。

import { MAX_TEXT_LENGTH, MODELS } from '../config.js';
import { countChars, createId } from '../core/format.js';
import { isDemoVoiceId } from './demo-data.js';

// DEMO 音色是虚构示例，不能进入真实生成流程，因此在这里拦截，不会产生任何 /api/generate 请求。
// 识别方式有两种，任一命中即拦截：音色对象带 isDemo 标记，或 voiceId 在 DEMO 数据定义中（只传 ID 时也生效）。
export function buildGeneratePayload({ text, voiceId, voice, modelId, settings }) {
  const errors = [];
  const trimmed = (text || '').trim();
  if (!trimmed) errors.push({ field: 'text', reason: '请先输入文本' });
  else if (countChars(trimmed) > MAX_TEXT_LENGTH) errors.push({ field: 'text', reason: `文本不能超过 ${MAX_TEXT_LENGTH} 字` });
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
