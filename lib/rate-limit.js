// 共享限流（第二阶段接入）
//
// Serverless 实例之间不共享内存，进程内 Map 无法可靠限流。
// 计划使用共享存储（推荐 Upstash Redis，或 Supabase 中的计数表）实现：
//   key = `ratelimit:generate:${userId}`，固定窗口或滑动窗口计数
// 同一个 store 也用于幂等键：`idem:${userId}:${idempotencyKey}`，
// 首次请求 SET NX 占位，重复请求直接返回已有结果或 IDEMPOTENCY_CONFLICT。
//
// 第一阶段只定义接口，不做任何限流，调用方需检查 enforced 字段。

export const GENERATE_LIMIT = Object.freeze({ windowSeconds: 60, maxRequests: 5 });

export async function checkRateLimit(_scope, _userId) {
  return { enforced: false, allowed: true };
}
