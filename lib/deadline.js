// 请求总时间预算。目录拉取、上游 TTS 都从同一个预算中扣除。

let clock = () => Date.now();

// 仅供测试注入时钟
export function setClock(fn) {
  clock = fn || (() => Date.now());
}

export function createDeadline(budgetMs) {
  const startedAt = clock();
  return {
    elapsedMs: () => clock() - startedAt,
    remainingMs: () => Math.max(0, budgetMs - (clock() - startedAt)),
  };
}
