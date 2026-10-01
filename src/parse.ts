import { sanitizeDimensions, sanitizeSections, SceneStructureError } from "./guards";
import type { SceneDeclaration, SceneResult } from "./types";

/** 从模型原始输出里抠出 JSON：容忍 markdown 围栏与前后闲话 */
export function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* 继续尝试截取 */
  }
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {
      /* 继续尝试数组 */
    }
  }
  const ca = s.indexOf("[");
  const cb = s.lastIndexOf("]");
  if (ca >= 0 && cb > ca) {
    try {
      return JSON.parse(s.slice(ca, cb + 1));
    } catch {
      /* 放弃 */
    }
  }
  throw new SceneStructureError("模型输出中没有可解析的 JSON");
}

/** 解析 + guards 清洗的一条龙；结构错误整体抛出，单条问题软失败剔除 */
export function parseSceneOutput(
  scene: SceneDeclaration,
  raw: string,
  inputIds: ReadonlySet<string>,
): SceneResult {
  const json = extractJson(raw);
  if (scene.output.kind === "sections") {
    return sanitizeSections(json, scene.output.sections, inputIds, scene.limits);
  }
  return sanitizeDimensions(json, scene.output.dims, inputIds);
}
