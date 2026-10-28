// 统一的接口返回格式
//
// 成功：{ ok: true,  data: ...,  requestId }
// 失败：{ ok: false, error: { code, message, details? }, requestId }
//
// code 是给程序判断用的稳定错误码；message 是给用户看的中文提示。

import { randomUUID } from 'node:crypto';

export const ErrorCodes = Object.freeze({
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  STORAGE_ERROR: 'STORAGE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

const DEFAULT_MESSAGES = Object.freeze({
  NOT_IMPLEMENTED: '该功能尚未接入，将在后续阶段开放。',
  METHOD_NOT_ALLOWED: '不支持的请求方式。',
  VALIDATION_ERROR: '请求内容不符合要求，请检查后重试。',
  UNAUTHORIZED: '请先登录。',
  FORBIDDEN: '没有权限访问该内容。',
  NOT_FOUND: '内容不存在或已被删除。',
  RATE_LIMITED: '操作过于频繁，请稍后再试。',
  IDEMPOTENCY_CONFLICT: '相同请求正在处理中，请勿重复提交。',
  UPSTREAM_ERROR: '语音服务暂时不可用，请稍后重试。',
  UPSTREAM_TIMEOUT: '语音生成超时，请稍后重试。',
  STORAGE_ERROR: '音频保存失败，请稍后重试。',
  INTERNAL_ERROR: '服务出现问题，请稍后重试。',
});

const STATUS_BY_CODE = Object.freeze({
  NOT_IMPLEMENTED: 501,
  METHOD_NOT_ALLOWED: 405,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  UPSTREAM_ERROR: 502,
  UPSTREAM_TIMEOUT: 504,
  STORAGE_ERROR: 500,
  INTERNAL_ERROR: 500,
});

export function getRequestId(req) {
  const fromHeader = req?.headers?.['x-vercel-id'];
  return typeof fromHeader === 'string' && fromHeader.length <= 128 ? fromHeader : randomUUID();
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function sendSuccess(res, data, { status = 200, requestId } = {}) {
  send(res, status, { ok: true, data, requestId });
}

export function sendError(res, code, { message, details, requestId, status } = {}) {
  const error = { code, message: message || DEFAULT_MESSAGES[code] || DEFAULT_MESSAGES.INTERNAL_ERROR };
  if (details !== undefined) error.details = details;
  send(res, status || STATUS_BY_CODE[code] || 500, { ok: false, error, requestId });
}

// 方法校验：不在允许列表时直接返回 405，并返回 false
export function allowMethods(req, res, methods, requestId) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  sendError(res, ErrorCodes.METHOD_NOT_ALLOWED, { requestId });
  return false;
}

// 第一阶段的统一占位响应
export function sendNotImplemented(res, { requestId, feature }) {
  sendError(res, ErrorCodes.NOT_IMPLEMENTED, { requestId, details: { feature, stage: 'framework' } });
}

// 包装处理函数：兜底捕获异常，避免把内部错误细节返回给前端
export function withErrorBoundary(handler, logger) {
  return async function wrapped(req, res) {
    const requestId = getRequestId(req);
    try {
      await handler(req, res, { requestId });
    } catch (err) {
      logger?.error('unhandled_error', { requestId, error: err });
      if (!res.headersSent) sendError(res, ErrorCodes.INTERNAL_ERROR, { requestId });
    }
  };
}
