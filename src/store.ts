export interface AiCacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

/** 内存 store：默认；SSR / 测试 / eval / 无持久化需求 */
export function createMemoryStore(): AiCacheStore {
  const m = new Map<string, string>();
  return {
    async get(k) {
      return m.get(k) ?? null;
    },
    async set(k, v) {
      m.set(k, v);
    },
    async del(k) {
      m.delete(k);
    },
  };
}

/**
 * localStorage store：浏览器持久化；隐私模式/配额异常静默降级为不可用。
 * prefix 用于多应用共用同一 localStorage 时隔离命名空间。
 */
export function createLocalStorageStore(prefix = "ai-kit:"): AiCacheStore {
  const hasLS = typeof localStorage !== "undefined";
  return {
    async get(k) {
      if (!hasLS) return null;
      try {
        return localStorage.getItem(prefix + k);
      } catch {
        return null;
      }
    },
    async set(k, v) {
      if (!hasLS) return;
      try {
        localStorage.setItem(prefix + k, v);
      } catch {
        /* 配额/隐私模式：静默放弃持久化 */
      }
    },
    async del(k) {
      if (!hasLS) return;
      try {
        localStorage.removeItem(prefix + k);
      } catch {
        /* ignore */
      }
    },
  };
}

/** 缓存信封：跨后端统一格式，后端只存取不透明字符串 */
export interface CacheEnvelope<T> {
  v: number;
  expireAt: number;
  data: T;
}

export async function writeEnvelope<T>(
  store: AiCacheStore,
  key: string,
  data: T,
  ttlMs: number,
  schemaVersion: number,
): Promise<void> {
  const envelope: CacheEnvelope<T> = { v: schemaVersion, expireAt: Date.now() + ttlMs, data };
  await store.set(key, JSON.stringify(envelope));
}

export async function readEnvelope<T>(store: AiCacheStore, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as CacheEnvelope<T>;
    if (typeof env.expireAt !== "number" || env.expireAt <= Date.now()) {
      void store.del(key);
      return null;
    }
    return env.data;
  } catch {
    void store.del(key);
    return null;
  }
}
