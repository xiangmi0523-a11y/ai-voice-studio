// 幂等：尽力而为的“进程内”去重，不是可靠的跨实例去重。
//
// 事实：
// * ElevenLabs 的文字转语音接口没有文档化的幂等键或请求去重机制（只有尽力而为的 seed，不能防重复计费）。
// * 当前项目没有共享存储（Upstash Redis / 数据库均未接入），所以无法可靠地去重。
// * Vercel 会按需启动多个实例，内存互不相通。同一个键的两次请求如果落到不同实例，这里完全看不到。
//
// 因此这里只做最低限度的保护，并且只在“同一个实例”内生效：
// * 同一个键的请求仍在处理 → 拒绝第二个（409），避免并发双击在同一实例上发出两次计费请求；
// * 同一个键已经发出过上游请求且结果未知/已完成 → 拒绝再次发出（409），要求用户明确确认后用新键重新生成；
// * 同一个键搭配了不同内容 → 拒绝（409）。
// 这里只保存键、内容指纹（SHA-256，不含文本）和状态，不保存文本或音频。
//
// 要真正可靠：用共享存储做 SET NX 占位（键 → processing），完成后写入结果引用；见 README“上线前待办”。

import { createHash } from 'node:crypto';

export const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const MAX_KEYS = 2000;

export const IdempotencyState = Object.freeze({
  NEW: 'new',
  IN_PROGRESS: 'in_progress',
  FINISHED: 'finished', // 已成功发出并得到结果（结果不保留，响应可能已丢失）
  UNKNOWN: 'unknown', // 上游请求已发出但结果未知（超时、网络中断、5xx 等），可能已计费
  MISMATCH: 'mismatch',
});

export function fingerprintOf({ text, voiceId, modelId, settings }) {
  return createHash('sha256').update(JSON.stringify([text, voiceId, modelId, settings ?? {}])).digest('hex');
}

export function createInProcessIdempotency({ now = () => Date.now(), ttlMs = IDEMPOTENCY_TTL_MS } = {}) {
  const entries = new Map();

  function prune(time) {
    for (const [key, entry] of entries) if (entry.expiresAt <= time) entries.delete(key);
    while (entries.size >= MAX_KEYS) entries.delete(entries.keys().next().value); // 容量到顶时淘汰最旧的
  }

  return {
    // 进程内、不可靠：调用方和文档都不能把它当作跨实例去重
    reliable: false,
    // 返回 NEW（并占位）或已存在的状态
    begin(key, fingerprint) {
      const time = now();
      const existing = entries.get(key);
      if (existing && existing.expiresAt > time) {
        if (existing.fingerprint !== fingerprint) return IdempotencyState.MISMATCH;
        return existing.state;
      }
      if (entries.size >= MAX_KEYS) prune(time);
      entries.set(key, { fingerprint, state: IdempotencyState.IN_PROGRESS, expiresAt: time + ttlMs });
      return IdempotencyState.NEW;
    },
    // 上游在生成前就拒绝（或根本没发出请求）：释放，允许用同一个键手动重试
    release(key) {
      entries.delete(key);
    },
    finish(key, state) {
      const entry = entries.get(key);
      if (entry) entry.state = state;
    },
  };
}

let current = createInProcessIdempotency();

export function getIdempotency() {
  return current;
}

// 仅供测试注入
export function setIdempotency(store) {
  current = store;
}
