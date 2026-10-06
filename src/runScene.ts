import { SceneStructureError } from "./guards";
import { parseSceneOutput } from "./parse";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import { normalizeScene } from "./declare";
import { TruncatedOutputError } from "./model";
import { sceneToJsonSchema, schemaName } from "./schema";
import type { Model, RunInput, Scene, SceneOptions, SceneResult } from "./types";

/** 声明一次：校验入参，返回可反复调用的场景声明 */
export function defineScene(opts: SceneOptions): Scene {
  return normalizeScene(opts);
}

/**
 * 调用：业务数据进，结构化结果出。
 * 内部管线：拼 prompt（规则 + 契约）→ 调 model（带上推导出的 schema）→ 解析校验
 * （refs 白名单 / 软失败）→ 结构化结果。
 * retries > 0 时，结构错误/截断会把错误信息喂回模型重试（网络错误、中断不重试）。
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
  const user = buildUserPrompt(scene, input.records, input.stats?.(input.records), lang);
  // schema 从 scene 推导，消费方不用手写；自写适配器可以忽略它退回纯提示词
  const jsonSchema = { name: schemaName(scene), node: sceneToJsonSchema(scene) };

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const prompt =
      attempt === 0
        ? user
        : lang === "zh"
          ? `${user}\n\n[上一次尝试失败：${lastError}。请修正问题后重新输出 JSON，务必比上一次更短。]`
          : `${user}\n\n[Previous attempt failed: ${lastError}. Fix it and output the JSON again, shorter than before.]`;
    try {
      const text = await input.model({ system, prompt, signal: input.signal, jsonSchema });
      return parseSceneOutput(scene, text, inputIds) as T;
    } catch (e) {
      // 中断是调用方的意图，不该被当成"再试一次"
      if (input.signal?.aborted) throw e;
      const retryable = e instanceof SceneStructureError || e instanceof TruncatedOutputError;
      if (!retryable || attempt === retries) throw e;
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  /* 不可达：循环内要么返回要么抛出 */
  throw new SceneStructureError(lastError);
}
