// GET /api/history — 当前用户的生成历史（分页）
//
// 第二阶段：校验身份后按 user_id 查询 generation_history，
// 并依赖 RLS 作为第二道防线。
import { allowMethods, ErrorCodes, sendError, sendNotImplemented, withErrorBoundary } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { getQueryParam } from '../../lib/validation.js';

export const MAX_PAGE_SIZE = 50;

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['GET'], requestId)) return;

  const limitParam = getQueryParam(req, 'limit');
  if (limitParam !== undefined) {
    const limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      sendError(res, ErrorCodes.VALIDATION_ERROR, {
        requestId,
        details: { errors: [{ field: 'limit', reason: `需为 1 到 ${MAX_PAGE_SIZE} 的整数` }] },
      });
      return;
    }
  }

  sendNotImplemented(res, { requestId, feature: 'history' });
}, logger);
