// DELETE /api/history/:id — 删除一条历史记录及其音频
//
// 第二阶段：只能删除属于当前用户的记录，同时删除私有桶中的音频文件。
import { allowMethods, ErrorCodes, sendError, sendNotImplemented, withErrorBoundary } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { getQueryParam, isUuid } from '../../lib/validation.js';

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['DELETE'], requestId)) return;

  if (!isUuid(getQueryParam(req, 'id'))) {
    sendError(res, ErrorCodes.VALIDATION_ERROR, {
      requestId,
      details: { errors: [{ field: 'id', reason: '记录 ID 无效' }] },
    });
    return;
  }

  sendNotImplemented(res, { requestId, feature: 'history.delete' });
}, logger);
