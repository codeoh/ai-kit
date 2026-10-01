import { describe, expect, it, vi } from "vitest";
import { createSceneController, runScene, type SceneState } from "../src/scene";
import { createMemoryStore } from "../src/store";
import { createMockTransport, type AiTransport } from "../src/transport";
import type { SectionsResult } from "../src/types";

const scene = {
  id: "activity_summary",
  output: { kind: "sections" as const, sections: ["work"] },
  prompt: { role: "r", task: "t" },
  cache: { ttlMs: 60_000, schemaVersion: 1 },
};

const goodOutput = JSON.stringify({ work: [{ text: "ok", refs: ["a1"] }] });
const records = [{ id: "a1", title: "t" }];

function waitUntil<T>(fn: () => T, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        const v = fn();
        if (v) return resolve(v);
      } catch {
        /* retry */
      }
      if (Date.now() - start > timeoutMs) return reject(new Error("waitUntil timeout"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function mockTransport(outputs: string[]): AiTransport {
  return createMockTransport(outputs);
}

describe("runScene", () => {
  it("组装 prompt 并解析输出", async () => {
    const seen: string[] = [];
    const transport: AiTransport = {
      async complete(req) {
        seen.push(req.system, req.user);
        return { content: goodOutput };
      },
    };
    const r = await runScene<SectionsResult>(scene, transport, {
      lang: "zh",
      records,
    });
    expect(r.work).toEqual([{ text: "ok", refs: ["a1"] }]);
    expect(seen[0]).toContain("输出语言必须是中文");
    expect(seen[1]).toContain("a1");
  });
});

describe("createSceneController", () => {
  it("空输入短路为 empty，不调模型", async () => {
    const transport = mockTransport([goodOutput]);
    const spy = vi.spyOn(transport, "complete");
    const ctrl = createSceneController<SectionsResult>({
      scene,
      transport,
      store: createMemoryStore(),
      identity: () => "u1",
      scope: () => "华为",
      lang: () => "zh",
      records: () => [],
      debounceMs: 0,
    });
    ctrl.refresh();
    await vi.waitFor(() => expect(ctrl.get().status).toBe("empty"));
    expect(spy).not.toHaveBeenCalled();
    ctrl.dispose();
  });

  it("未命中 -> pending -> ok，并写入缓存；二次刷新命中缓存", async () => {
    const transport = mockTransport([goodOutput]);
    const store = createMemoryStore();
    const ctrl = createSceneController<SectionsResult>({
      scene,
      transport,
      store,
      identity: () => "u1",
      scope: () => "华为",
      lang: () => "zh",
      records: () => records,
      debounceMs: 0,
    });
    ctrl.refresh();
    await vi.waitFor(() => expect(ctrl.get().status).toBe("ok"));
    expect((ctrl.get() as SceneState<SectionsResult>).fromCache).toBe(false);

    const ctrl2 = createSceneController<SectionsResult>({
      scene,
      transport: mockTransport([]), // 若走模型会得到空输出
      store,
      identity: () => "u1",
      scope: () => "华为",
      lang: () => "zh",
      records: () => records,
      debounceMs: 0,
    });
    ctrl2.refresh();
    await vi.waitFor(() => expect(ctrl2.get().status).toBe("ok"));
    expect((ctrl2.get() as SceneState<SectionsResult>).fromCache).toBe(true);
    expect((ctrl2.get() as SceneState<SectionsResult>).result).toEqual(ctrl.get().result);
    ctrl.dispose();
    ctrl2.dispose();
  });

  it("force 绕过缓存重新生成", async () => {
    const transport = mockTransport([goodOutput, goodOutput]);
    const store = createMemoryStore();
    const ctrl = createSceneController<SectionsResult>({
      scene,
      transport,
      store,
      identity: () => "u1",
      scope: () => "华为",
      lang: () => "zh",
      records: () => records,
      debounceMs: 0,
    });
    ctrl.refresh();
    await waitUntil(() => ctrl.get().status === "ok" && ctrl.get());
    ctrl.refresh(true);
    await vi.waitFor(() => {
      const s = ctrl.get();
      return s.status === "ok" && s.fromCache === false && s;
    });
    ctrl.dispose();
  });

  it("失败不写缓存：模型报错后 store 保持为空，状态 error", async () => {
    const transport: AiTransport = {
      async complete() {
        throw new Error("llm down");
      },
    };
    const store = createMemoryStore();
    const ctrl = createSceneController<SectionsResult>({
      scene,
      transport,
      store,
      identity: () => "u1",
      scope: () => "华为",
      lang: () => "zh",
      records: () => records,
      debounceMs: 0,
    });
    ctrl.refresh();
    await vi.waitFor(() => expect(ctrl.get().status).toBe("error"));
    expect((ctrl.get() as SceneState<SectionsResult>).error).toContain("llm down");
    // store 中没有该场景任何键
    const before = await store.get("ai:activity_summary:u1:华为");
    expect(before).toBeNull();
    ctrl.dispose();
  });

  it("subscribe 收到状态变更，dispose 后不再刷新", async () => {
    const transport = mockTransport([goodOutput]);
    const ctrl = createSceneController<SectionsResult>({
      scene,
      transport,
      store: createMemoryStore(),
      identity: () => "u1",
      scope: () => "华为",
      lang: () => "zh",
      records: () => records,
      debounceMs: 0,
    });
    const statuses: string[] = [];
    const unsub = ctrl.subscribe((s) => statuses.push(s.status));
    ctrl.refresh();
    await vi.waitFor(() => expect(ctrl.get().status).toBe("ok"));
    unsub();
    ctrl.dispose();
    ctrl.refresh(); // 已 dispose，不应有任何动作
    expect(statuses).toContain("pending");
    expect(statuses).toContain("ok");
  });

  it("防抖合并：多次 refresh 只触发一次生成", async () => {
    vi.useFakeTimers();
    const transport = mockTransport([goodOutput]);
    const spy = vi.spyOn(transport, "complete");
    const ctrl = createSceneController<SectionsResult>({
      scene,
      transport,
      store: createMemoryStore(),
      identity: () => "u1",
      scope: () => "华为",
      lang: () => "zh",
      records: () => records,
      debounceMs: 1500,
    });
    ctrl.refresh();
    ctrl.refresh();
    ctrl.refresh();
    await vi.advanceTimersByTimeAsync(1600);
    expect(spy).toHaveBeenCalledTimes(1);
    ctrl.dispose();
    vi.useRealTimers();
  });
});
