// GET /api/audio/:id — 获取某条生成记录的音频
//
// 第二阶段：校验该记录属于当前用户且 status = succeeded，
// 再为私有桶中的文件生成短期签名链接（lib/storage.js）。
// 路径只从数据库记录读取，不使用任何客户端传入的路径。
import { allowMethods, ErrorCodes, sendError, sendNotImplemented, withErrorBoundary } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { getQueryParam, isUuid } from '../../lib/validation.js';

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['GET'], requestId)) return;

  if (!isUuid(getQueryParam(req, 'id'))) {
    sendError(res, ErrorCodes.VALIDATION_ERROR, {
      requestId,
      details: { errors: [{ field: 'id', reason: '音频 ID 无效' }] },
    });
    return;
  }

  sendNotImplemented(res, { requestId, feature: 'audio' });
}, logger);
