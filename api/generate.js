// POST /api/generate — 生成语音
//
// 请求头：Authorization: Bearer <token>，Idempotency-Key: <uuid>
// 请求体：{ text, voiceId, modelId, settings }
//
// 第二阶段处理顺序：
// 1. 校验输入（本阶段已实现）
// 2. 校验用户身份 lib/auth.js
// 3. 共享限流 + 幂等占位 lib/rate-limit.js
// 4. 写入 generation_history（status = processing）
// 5. 带超时调用 ElevenLabs（密钥只在服务端读取）
// 6. 上传到私有桶 lib/storage.js，更新记录为 succeeded / failed
// 7. 返回记录 id，前端再通过 GET /api/audio/:id 获取签名链接
import { allowMethods, ErrorCodes, sendError, sendNotImplemented, withErrorBoundary } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { readJsonBody, validateGenerateRequest } from '../lib/validation.js';

export default withErrorBoundary(async (req, res, { requestId }) => {
  if (!allowMethods(req, res, ['POST'], requestId)) return;

  const body = readJsonBody(req);
  const result = validateGenerateRequest(body, req.headers['idempotency-key']);
  if (!result.ok) {
    sendError(res, ErrorCodes.VALIDATION_ERROR, { requestId, details: { errors: result.errors } });
    return;
  }

  sendNotImplemented(res, { requestId, feature: 'generate' });
}, logger);
