// 限流
//
// 当前实现是【进程内、尽力而为】的固定窗口限流：只在单个 Serverless 实例的内存里计数。
// Vercel 会按需启动多个实例，实例之间不共享内存，所以它【不是】可靠的跨实例限流，
// 只能挡住单实例上的突发请求和误操作，不能作为费用控制的依据。
// 上线前必须换成共享存储（推荐 Upstash Redis，见 .env.example）：
//   key = `ratelimit:generate:${userId 或 IP}`，固定窗口或滑动窗口计数。
// 幂等键也需要共享存储：首次请求 SET NX 占位，重复请求返回已有结果或 IDEMPOTENCY_CONFLICT。

export const GENERATE_LIMIT = Object.freeze({ windowMs: 60_000, max: 5 });
const MAX_TRACKED_KEYS = 5000;

export function createInProcessLimiter({ windowMs = GENERATE_LIMIT.windowMs, max = GENERATE_LIMIT.max, now = () => Date.now() } = {}) {
  const buckets = new Map();

  function prune(time) {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= time) buckets.delete(key);
  }

  return {
    // reliable 恒为 false：调用方和文档都不能把它当作跨实例限流
    reliable: false,
    check(key) {
      const time = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= time) {
        if (buckets.size >= MAX_TRACKED_KEYS) prune(time);
        // 仍然满载（大量不同来源）时宁可拒绝，也不无限增长内存
        if (buckets.size >= MAX_TRACKED_KEYS) return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
        bucket = { count: 0, resetAt: time + windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= max) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - time) / 1000)) };
      bucket.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

let current = createInProcessLimiter();

export function getGenerateLimiter() {
  return current;
}

// 仅供测试注入
export function setGenerateLimiter(limiter) {
  current = limiter;
}

// 客户端标识：Vercel 会覆盖 x-forwarded-for / x-real-ip。没有用户体系前只能按 IP，
// 同一出口 IP 的用户会共享额度，伪造请求头也无法在 Vercel 之外保证可信。
export function getClientKey(req) {
  const realIp = req?.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim().slice(0, 64);
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim().slice(0, 64);
  return 'unknown';
}
