import type { Scene, SceneOptions } from "./types";

/**
 * 缺省 id 归一化。早期实现是 task.slice(0, 24)，实测中文 task 得到
 * "归纳客户活动周报，输出三段。"、带标点的英文 task 得到
 * "Summarize: A/B testing r"——都不是合法标识符，而 id 会用于
 * eval 报告与 json_schema.name。
 */
function normalizeId(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "scene";
}

/** declareScene 的实现细节：校验入参并归一化为内部 Scene */
export function normalizeScene(opts: SceneOptions): Scene {
  if (!opts.task || typeof opts.task !== "string") {
    throw new TypeError('defineScene: "task" 是必填的一句话描述');
  }
  const hasSections = Array.isArray(opts.sections) && opts.sections.length > 0;
  const hasScores = Array.isArray(opts.scores) && opts.scores.length > 0;
  if (hasSections && hasScores) {
    throw new TypeError("defineScene: sections 与 scores 只能二选一");
  }
  if (!hasSections && !hasScores) {
    throw new TypeError('defineScene: 需要提供 sections（如 ["summary", "actions"]）或 scores（如 ["severity"]）');
  }
  const keys = [...(opts.sections ?? []), ...(opts.scores ?? [])];
  for (const key of keys) {
    if (typeof key !== "string" || !key) {
      throw new TypeError("defineScene: sections/scores 的键必须是非空字符串");
    }
  }
  // 重复键会静默覆盖，声明期就该拦下来
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup !== undefined) {
    throw new TypeError(`defineScene: 输出键 "${dup}" 重复了`);
  }
  return {
    id: normalizeId(opts.id ?? opts.task),
    task: opts.task,
    role: opts.role,
    output: hasSections
      ? { kind: "sections", keys: opts.sections! }
      : { kind: "scores", keys: opts.scores! },
    limits: opts.limits,
    profile: opts.about,
    extraRules: opts.extraRules,
  };
}
