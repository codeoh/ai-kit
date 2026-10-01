import { SceneStructureError } from "./guards";
import { parseSceneOutput } from "./parse";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { normalizeScene } from "./declare";
import { TruncatedOutputError } from "./model";
import type { Model, RunInput, Scene, SceneOptions, SceneResult } from "./types";

/** 声明一次：校验入参，返回可反复调用的场景声明 */
export function defineScene(opts: SceneOptions): Scene {
  return normalizeScene(opts);
}

/**
 * 调用：业务数据进，结构化结果出。
 * 内部管线：拼 prompt（不变量+契约）→ 调 model → 解析校验（refs 白名单/软失败）→ 类型化结果。
 * retries > 0 时，结构错误/截断会把错误信息喂回模型重试（网络错误不重试）。
 */
export async function runScene<T extends SceneResult = SceneResult>(
  scene: Scene,
  input: RunInput,
): Promise<T> {
  const lang = input.lang ?? "en";
  const retries = input.retries ?? 0;
  const inputIds = new Set<string>();
  for (const r of input.records) {
    const id = (r as Record<string, unknown>)?.id;
    if (typeof id === "string") inputIds.add(id);
  }
  const system = buildSystemPrompt(scene, lang);
  const user = buildUserPrompt(scene, input.records, input.stats?.(input.records));

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const prompt =
      attempt === 0 ? user : `${user}\n\n[Previous attempt failed: ${lastError}. Fix the problem and output the JSON again.]`;
    try {
      const text = await input.model({ system, prompt });
      return parseSceneOutput(scene, text, inputIds) as T;
    } catch (e) {
      const retryable = e instanceof SceneStructureError || e instanceof TruncatedOutputError;
      if (!retryable || attempt === retries) throw e;
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  /* 不可达：循环内要么返回要么抛出 */
  throw new SceneStructureError(lastError);
}
