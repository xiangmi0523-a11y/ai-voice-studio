// 输入校验。所有来自客户端的值都先经过这里，任何用户输入都不会被直接
// 用作文件路径或数据库标识。

import { ALLOWED_MODELS, MAX_TEXT_LENGTH, maxCharsForSpeed, VOICE_SETTING_RANGES } from './config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// ElevenLabs voice_id 为字母数字组合；限制长度与字符集
const VOICE_ID_RE = /^[A-Za-z0-9]{8,64}$/;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isVoiceId(value) {
  return typeof value === 'string' && VOICE_ID_RE.test(value);
}

export function isAllowedModel(value) {
  return typeof value === 'string' && ALLOWED_MODELS.includes(value);
}

// 返回 { ok: true, value } 或 { ok: false, field, reason }
export function validateText(text) {
  if (typeof text !== 'string') return { ok: false, field: 'text', reason: '缺少文本内容' };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, field: 'text', reason: '文本不能为空' };
  // 按 Unicode 码点计数，与前端字数统计保持一致
  if ([...trimmed].length > MAX_TEXT_LENGTH) {
    return { ok: false, field: 'text', reason: `文本不能超过 ${MAX_TEXT_LENGTH} 字` };
  }
  return { ok: true, value: trimmed };
}

export function validateVoiceSettings(settings) {
  if (settings === undefined) return { ok: true, value: {} };
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { ok: false, field: 'settings', reason: '参数格式不正确' };
  }
  const value = {};
  for (const [key, raw] of Object.entries(settings)) {
    if (key === 'use_speaker_boost') {
      if (typeof raw !== 'boolean') return { ok: false, field: key, reason: '参数格式不正确' };
      value[key] = raw;
      continue;
    }
    const range = VOICE_SETTING_RANGES[key];
    if (!range) return { ok: false, field: key, reason: '不支持的参数' };
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < range.min || raw > range.max) {
      return { ok: false, field: key, reason: `取值需在 ${range.min} 到 ${range.max} 之间` };
    }
    value[key] = raw;
  }
  return { ok: true, value };
}

// 校验生成请求。idempotencyKey 来自 Idempotency-Key 请求头
export function validateGenerateRequest(body, idempotencyKey) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: [{ field: 'body', reason: '请求体必须是 JSON 对象' }] };
  }

  const text = validateText(body.text);
  if (!text.ok) errors.push({ field: text.field, reason: text.reason });

  if (!isVoiceId(body.voiceId)) errors.push({ field: 'voiceId', reason: '音色 ID 无效' });
  if (!isAllowedModel(body.modelId)) errors.push({ field: 'modelId', reason: '不支持的模型' });

  const settings = validateVoiceSettings(body.settings);
  if (!settings.ok) errors.push({ field: settings.field === 'settings' ? 'settings' : `settings.${settings.field}`, reason: settings.reason });

  // 语速越慢音频越长：按“字数 ÷ 语速”限制，避免生成出超过音频大小上限、上游已计费却被拒收的内容
  if (text.ok && settings.ok && typeof settings.value.speed === 'number') {
    const limit = maxCharsForSpeed(settings.value.speed);
    if ([...text.value].length > limit) {
      errors.push({ field: 'text', reason: `当前语速下文本不能超过 ${limit} 字（语速越慢，可生成的文本越短）` });
    }
  }

  if (!isUuid(idempotencyKey)) {
    errors.push({ field: 'Idempotency-Key', reason: '缺少或无效的幂等键' });
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      text: text.value,
      voiceId: body.voiceId,
      modelId: body.modelId,
      settings: settings.value,
      idempotencyKey,
    },
  };
}

// Vercel 会解析 JSON 请求体；本地开发服务器也做了相同处理
export function readJsonBody(req) {
  const body = req.body;
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return null;
}

// 从动态路由取单个参数，兼容数组形式
export function getQueryParam(req, name) {
  const value = req.query?.[name];
  return Array.isArray(value) ? value[0] : value;
}
