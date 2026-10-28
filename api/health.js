// GET /api/health — 返回后端是否可达及当前阶段，不暴露任何配置值
import { APP_STAGE, APP_VERSION, getServerEnvStatus } from '../lib/config.js';
import { allowMethods, sendSuccess, withErrorBoundary } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { parsePublicVoiceIds } from '../lib/public-voices.js';

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['GET'], requestId)) return;
  const env = getServerEnvStatus();
  const publicVoicesConfigured = parsePublicVoiceIds(process.env.PUBLIC_VOICE_IDS).ok;
  sendSuccess(
    res,
    {
      stage: APP_STAGE,
      version: APP_VERSION,
      features: {
        // 音色列表依赖服务端已配置 ELEVENLABS_API_KEY；生成仍未接入
        voices: env.elevenLabsConfigured && publicVoicesConfigured,
        generate: env.elevenLabsConfigured && publicVoicesConfigured,
        history: false,
        favorites: false,
        audio: false,
        auth: false,
      },
      // 仅布尔值，用于设置页展示“是否已配置”，不含任何密钥内容
      configured: { ...env, publicVoicesConfigured },
    },
    { requestId },
  );
}, logger);
