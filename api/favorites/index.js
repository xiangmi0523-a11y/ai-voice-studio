// GET  /api/favorites — 当前用户收藏的音色
// POST /api/favorites — 收藏音色，请求体 { voiceId, voiceName }
//
// 第二阶段：写入 voice_favorites，(user_id, voice_id) 主键保证不重复收藏。
import { allowMethods, ErrorCodes, sendError, sendNotImplemented, withErrorBoundary } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { isVoiceId, readJsonBody } from '../../lib/validation.js';

export const MAX_VOICE_NAME_LENGTH = 100;

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['GET', 'POST'], requestId)) return;

  if (req.method === 'GET') {
    sendNotImplemented(res, { requestId, feature: 'favorites.list' });
    return;
  }

  const body = readJsonBody(req);
  const errors = [];
  if (!isVoiceId(body?.voiceId)) errors.push({ field: 'voiceId', reason: '音色 ID 无效' });
  const name = body?.voiceName;
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_VOICE_NAME_LENGTH) {
    errors.push({ field: 'voiceName', reason: '音色名称无效' });
  }
  if (errors.length) {
    sendError(res, ErrorCodes.VALIDATION_ERROR, { requestId, details: { errors } });
    return;
  }

  sendNotImplemented(res, { requestId, feature: 'favorites.add' });
}, logger);
