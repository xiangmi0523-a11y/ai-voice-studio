// Supabase Storage 路径约定（第二阶段接入）
//
// 音频存放在私有桶中，路径只由服务端生成的 UUID 组成：
//   <user_id>/<generation_id>.mp3
// 前端永远拿不到桶的直接访问权，只能通过 GET /api/audio/:id 获取短期签名链接。

import { isUuid } from './validation.js';

export function buildAudioPath(userId, generationId) {
  if (!isUuid(userId) || !isUuid(generationId)) {
    throw new Error('buildAudioPath requires server-generated UUIDs');
  }
  return `${userId.toLowerCase()}/${generationId.toLowerCase()}.mp3`;
}

// 签名链接有效期（秒）
export const SIGNED_URL_TTL_SECONDS = 300;
