import type { MarketCache } from "./types.ts";

/** In-process TTL cache. Time source is injectable for tests. */
export function memoryCache(nowMs: () => number = () => Date.now()): MarketCache {
  const store = new Map<string, { value: unknown; expires: number }>();
  return {
    async get(ns, key) {
      const k = `${ns}\u0000${key}`;
      const hit = store.get(k);
      if (!hit) return null;
      if (hit.expires <= nowMs()) {
        store.delete(k);
        return null;
      }
      return hit.value;
    },
    async set(ns, key, value, ttlSeconds) {
      store.set(`${ns}\u0000${key}`, { value, expires: nowMs() + ttlSeconds * 1000 });
    },
  };
}
