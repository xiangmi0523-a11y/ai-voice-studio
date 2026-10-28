// GET /api/health — 返回后端是否可达及当前阶段，不暴露任何配置值
import { APP_STAGE, APP_VERSION, getServerEnvStatus } from '../lib/config.js';
import { allowMethods, sendSuccess, withErrorBoundary } from '../lib/http.js';
import { logger } from '../lib/logger.js';

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['GET'], requestId)) return;
  const env = getServerEnvStatus();
  sendSuccess(
    res,
    {
      stage: APP_STAGE,
      version: APP_VERSION,
      features: {
        voices: false,
        generate: false,
        history: false,
        favorites: false,
        audio: false,
        auth: false,
      },
      // 仅布尔值，用于设置页展示“是否已配置”，不含任何密钥内容
      configured: env,
    },
    { requestId },
  );
}, logger);
