// GET /api/voices — 公开音色列表（来自 ElevenLabs，服务端短期缓存）
//
// 只返回 PUBLIC_VOICE_IDS 中显式公开、且在 ElevenLabs 中真实存在的音色（category 为 cloned 的一律排除），
// 并且只返回前端需要的字段：id、名称、简介、性别、语言、标签、试听链接。
// 未配置公开列表时返回空列表，不会回退为账号里的全部音色，也不会请求上游。
// 注意：当前没有用户登录，这是“服务端账号级”的音色访问，任何访问者看到的都是同一份公开列表。
import { allowMethods, sendSuccess, withErrorBoundary } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { CatalogFailure, getVoiceCatalog, sendCatalogFailure } from '../lib/voice-catalog.js';

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['GET'], requestId)) return;

  const catalog = await getVoiceCatalog().load();
  if (!catalog.ok) {
    if (catalog.code === CatalogFailure.NO_PUBLIC_VOICES) {
      sendSuccess(res, { voices: [], cached: false }, { requestId });
      return;
    }
    sendCatalogFailure(res, catalog, { requestId, feature: 'voices' });
    return;
  }
  sendSuccess(res, { voices: catalog.voices, cached: catalog.cached }, { requestId });
}, logger);
