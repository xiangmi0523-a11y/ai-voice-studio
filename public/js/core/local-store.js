// localStorage 安全封装：隐私模式或存储被禁用时不抛错，退化为内存存储

export function createLocalStore(backend = globalThis.localStorage) {
  const memory = new Map();

  function safeBackend() {
    try {
      return backend ?? null;
    } catch {
      return null;
    }
  }

  return {
    read(key, fallback) {
      try {
        const raw = safeBackend()?.getItem(key);
        if (raw === null || raw === undefined) return memory.has(key) ? memory.get(key) : fallback;
        return JSON.parse(raw);
      } catch {
        return memory.has(key) ? memory.get(key) : fallback;
      }
    },
    write(key, value) {
      memory.set(key, value);
      try {
        safeBackend()?.setItem(key, JSON.stringify(value));
      } catch {
        /* 存储不可用时只保留在内存中 */
      }
    },
    remove(key) {
      memory.delete(key);
      try {
        safeBackend()?.removeItem(key);
      } catch {
        /* 忽略 */
      }
    },
  };
}
