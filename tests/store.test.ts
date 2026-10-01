import { afterEach, describe, expect, it } from "vitest";
import { buildCacheKey, hashContent } from "../src/cacheKey";
import { createLocalStorageStore, createMemoryStore, readEnvelope, writeEnvelope } from "../src/store";

describe("hashContent / buildCacheKey", () => {
  it("同内容同哈希，不同内容不同哈希", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
  it("键包含身份/范围/语言/schema 版本", () => {
    const key = buildCacheKey({
      sceneId: "s1",
      identity: "u1",
      scope: "华为",
      contentHash: "abcd1234",
      lang: "zh",
      schemaVersion: 2,
    });
    expect(key).toBe("ai:s1:u1:华为:abcd1234:zh:v2");
  });
});

describe("memory store", () => {
  it("set/get/del 与信封过期", async () => {
    const store = createMemoryStore();
    await writeEnvelope(store, "k1", { a: 1 }, 60_000, 1);
    expect(await readEnvelope(store, "k1")).toEqual({ a: 1 });
    await writeEnvelope(store, "k2", { a: 2 }, -1, 1); // 立即过期
    expect(await readEnvelope(store, "k2")).toBeNull();
  });
  it("损坏信封返回 null", async () => {
    const store = createMemoryStore();
    await store.set("bad", "{not json");
    expect(await readEnvelope(store, "bad")).toBeNull();
  });
});

describe("localStorage store", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it("持久化到 localStorage，带 prefix 隔离", async () => {
    const backing = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const store = createLocalStorageStore("test:");
    await store.set("k", "v");
    expect(backing.get("test:k")).toBe("v");
    expect(await store.get("k")).toBe("v");
    await store.del("k");
    expect(await store.get("k")).toBeNull();
  });

  it("无 localStorage 环境静默降级", async () => {
    const store = createLocalStorageStore();
    await store.set("k", "v");
    expect(await store.get("k")).toBeNull();
  });
});
