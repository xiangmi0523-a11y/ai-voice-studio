// DELETE /api/favorites/:voiceId — 取消收藏
import { allowMethods, ErrorCodes, sendError, sendNotImplemented, withErrorBoundary } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { getQueryParam, isVoiceId } from '../../lib/validation.js';

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['DELETE'], requestId)) return;

  if (!isVoiceId(getQueryParam(req, 'voiceId'))) {
    sendError(res, ErrorCodes.VALIDATION_ERROR, {
      requestId,
      details: { errors: [{ field: 'voiceId', reason: '音色 ID 无效' }] },
    });
    return;
  }

  sendNotImplemented(res, { requestId, feature: 'favorites.remove' });
}, logger);
