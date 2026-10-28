// GET /api/voices — 音色列表
//
// 第二阶段：服务端用 ELEVENLABS_API_KEY 拉取音色列表并缓存，
// 只返回前端需要的字段（id、名称、简介、标签、试听链接）。
import { allowMethods, sendNotImplemented, withErrorBoundary } from '../lib/http.js';
import { logger } from '../lib/logger.js';

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['GET'], requestId)) return;
  sendNotImplemented(res, { requestId, feature: 'voices' });
}, logger);
