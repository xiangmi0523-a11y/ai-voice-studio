// 公开音色允许列表：PUBLIC_VOICE_IDS（逗号分隔的 ElevenLabs voice_id，仅服务端环境变量）。
//
// 这是“可展示”和“可生成”共用的唯一策略：只有写在这里、并且在 ElevenLabs 账号中真实存在的
// 音色，才会出现在 /api/voices，也才允许被 /api/generate 使用。
// 失败关闭：未配置、为空或任何一项格式不合法时，一律视为“不公开任何音色”，
// 绝不会回退为公开账号里的全部音色。

import { isKnownDemoVoiceId } from './demo-voices.js';
import { isVoiceId } from './validation.js';

export const MAX_PUBLIC_VOICES = 50;

// 返回 { ok, ids: Set, reason }。ok 为 false 时 ids 一定是空集合。
export function parsePublicVoiceIds(raw) {
  const none = (reason) => ({ ok: false, ids: new Set(), reason });
  if (typeof raw !== 'string' || !raw.trim()) return none('unset');

  const tokens = raw.split(',').map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return none('unset');
  if (tokens.length > MAX_PUBLIC_VOICES) return none('too_many');
  if (tokens.some((t) => !isVoiceId(t) || isKnownDemoVoiceId(t))) return none('invalid');
  return { ok: true, ids: new Set(tokens), reason: null };
}
