import { buildCacheKey, hashContent } from "./cacheKey";
import { parseSceneOutput } from "./parse";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { readEnvelope, writeEnvelope, type AiCacheStore } from "./store";
import type { AiTransport } from "./transport";
import type { SceneDeclaration, SceneResult } from "./types";

/** 场景声明入口：类型收口用，让"新增一个 AI 场景"从这一行开始 */
export function defineAiScene(d: SceneDeclaration): SceneDeclaration {
  return d;
}

/** 单次执行（纯路径）：prompt 组装 -> transport -> 解析+guards。eval 与控制器共用 */
export async function runSceneOnce<T extends SceneResult>(
  scene: SceneDeclaration,
  transport: AiTransport,
  input: { lang: "zh" | "en"; records: unknown[]; stats?: unknown },
): Promise<T> {
  const inputIds = new Set<string>();
  for (const r of input.records) {
    const id = (r as Record<string, unknown>)?.id;
    if (typeof id === "string") inputIds.add(id);
  }
  const res = await transport.complete({
    system: buildSystemPrompt(scene, input.lang),
    user: buildUserPrompt(scene, input.records, input.stats),
  });
  return parseSceneOutput(scene, res.content, inputIds) as T;
}

export type SceneStatus = "idle" | "empty" | "pending" | "ok" | "error";

export interface SceneState<T> {
  status: SceneStatus;
  result?: T;
  fromCache?: boolean;
  error?: string;
}

export interface SceneControllerConfig<T extends SceneResult> {
  scene: SceneDeclaration;
  transport: AiTransport;
  store: AiCacheStore;
  /** 登录人（缓存键用，不进 prompt） */
  identity: () => string;
  /** 范围名（客户名等） */
  scope: () => string;
  lang: () => "zh" | "en";
  /** 输入快照；返回空数组时控制器短路为 empty */
  records: () => unknown[];
  /** 程序统计（数字不经 LLM） */
  stats?: (records: unknown[]) => unknown;
  /** 默认 1500ms 防抖合并；测试可传 0 */
  debounceMs?: number;
}

export interface SceneController<T extends SceneResult> {
  get(): SceneState<T>;
  subscribe(fn: (s: SceneState<T>) => void): () => void;
  /** force=true 绕过缓存强制重算（对应前端刷新图标） */
  refresh(force?: boolean): void;
  dispose(): void;
}

/**
 * 控制器（缓存优先 -> 未命中生成 -> 失败不写缓存）。
 * 并发策略：防抖合并 + 单在途（旧结果作废，不覆盖新写）。
 * AbortSignal 支持在 transport 层传入；此处用代次号作废陈旧结果。
 */
export function createSceneController<T extends SceneResult>(
  cfg: SceneControllerConfig<T>,
): SceneController<T> {
  const { scene, transport, store, identity, scope, lang, records, stats } = cfg;
  const debounceMs = cfg.debounceMs ?? 1500;
  const schemaVersion = scene.cache?.schemaVersion ?? 1;

  let state: SceneState<T> = { status: "idle" };
  const listeners = new Set<(s: SceneState<T>) => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let run = 0;
  let disposed = false;

  function set(next: SceneState<T>): void {
    state = next;
    for (const fn of listeners) fn(state);
  }

  async function generateNow(force: boolean): Promise<void> {
    const recs = records();
    if (recs.length === 0) {
      set({ status: "empty" });
      return;
    }
    const key = buildCacheKey({
      sceneId: scene.id,
      identity: identity(),
      scope: scope(),
      contentHash: hashContent(JSON.stringify(recs)),
      lang: lang(),
      schemaVersion,
    });
    if (!force) {
      const cached = await readEnvelope<T>(store, key);
      if (disposed) return;
      if (cached !== null) {
        set({ status: "ok", result: cached, fromCache: true });
        return;
      }
    }
    const myRun = ++run;
    set({ status: "pending" });
    try {
      const result = await runSceneOnce<T>(scene, transport, {
        lang: lang(),
        records: recs,
        stats: stats?.(recs),
      });
      if (disposed || myRun !== run) return; // 陈旧结果作废，不覆盖新写
      set({ status: "ok", result, fromCache: false });
      if (scene.cache?.ttlMs) {
        await writeEnvelope(store, key, result, scene.cache.ttlMs, schemaVersion);
      }
    } catch (e) {
      if (disposed || myRun !== run) return;
      // 失败不写缓存，下次触发自动重试
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  function refresh(force = false): void {
    if (disposed) return;
    if (debounceMs > 0) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void generateNow(force);
      }, debounceMs);
    } else {
      void generateNow(force);
    }
  }

  return {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    refresh,
    dispose() {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      listeners.clear();
    },
  };
}
