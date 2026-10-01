import type { Scene, SceneOptions } from "./types";

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
  for (const key of [...(opts.sections ?? []), ...(opts.scores ?? [])]) {
    if (typeof key !== "string" || !key) {
      throw new TypeError("defineScene: sections/scores 的键必须是非空字符串");
    }
  }
  return {
    id: opts.id ?? opts.task.slice(0, 24),
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
