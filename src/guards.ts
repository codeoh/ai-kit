import type { ScoreItem, SectionItem } from "./types";

/** 输出整体结构不合法（非 JSON 对象）——与"单条坏"的软失败区分开 */
export class SceneStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneStructureError";
  }
}

/** 显式类型收窄（教训：unknown 收窄后回调隐式 any） */
export function toRefIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * 引用白名单：不在输入里的 id 直接剔除。
 * 同时返回被剔除的个数——早期实现只剔除不留痕，结果是
 * "销毁了证据、保留了幻觉本身"：一条内容全编造、refs 全是假 id 的结论，
 * 返回成{ text, refs: [] }，和"合法的无引用条目"结构上完全一样，调用方看不出来。
 * droppedRefs > 0 就是"模型编了 id"的信号。
 */
export function filterRefIds(ids: string[], inputIds: ReadonlySet<string>): string[] {
  return ids.filter((id) => inputIds.has(id));
}

export function countDroppedRefs(ids: string[], inputIds: ReadonlySet<string>): number {
  let dropped = 0;
  for (const id of ids) if (!inputIds.has(id)) dropped += 1;
  return dropped;
}

export interface GuardLimits {
  itemMaxLen: number;
  maxItems: number;
}

export function resolveLimits(limits?: { itemMaxLen?: number; maxItems?: number }): GuardLimits {
  return { itemMaxLen: limits?.itemMaxLen ?? 120, maxItems: limits?.maxItems ?? 10 };
}

/**
 * sections 软失败清洗：只读声明的段落键；坏条目剔除、合法条目保留；
 * refs 白名单过滤并记录剔除数；文本截断；条数封顶。
 * 仅整体非对象时抛 SceneStructureError——这一行为与结构化约束强度无关。
 */
export function sanitizeSections(
  parsed: unknown,
  sections: string[],
  inputIds: ReadonlySet<string>,
  limits?: { itemMaxLen?: number; maxItems?: number },
): Record<string, SectionItem[]> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SceneStructureError("模型输出不是 JSON 对象");
  }
  const obj = parsed as Record<string, unknown>;
  const { itemMaxLen, maxItems } = resolveLimits(limits);
  const out: Record<string, SectionItem[]> = {};
  for (const key of sections) {
    const rawArr = obj[key];
    const items: SectionItem[] = [];
    if (Array.isArray(rawArr)) {
      for (const it of rawArr) {
        if (!it || typeof it !== "object" || Array.isArray(it)) continue;
        const raw = it as Record<string, unknown>;
        const rawText = raw.text;
        if (typeof rawText !== "string") continue;
        const text = rawText.trim();
        if (!text) continue;
        const rawRefs = toRefIds(raw.refs);
        const refs = filterRefIds(rawRefs, inputIds);
        const item: SectionItem = { text: text.slice(0, itemMaxLen), refs };
        const dropped = countDroppedRefs(rawRefs, inputIds);
        if (dropped > 0) item.droppedRefs = dropped;
        items.push(item);
        if (items.length >= maxItems) break;
      }
    }
    out[key] = items;
  }
  return out;
}

/**
 * scores 清洗：reason 必须是字符串；refs 白名单过滤并记录剔除数。
 *
 * score 的处理变了：早期实现把非法值（字符串 "4"、null、NaN）静默当0，
 * 而 0 在评分语义里往往是"无关/无风险"——语义错误的低分被伪装成正常零分。
 * 现在非法或缺失一律返回 null，"模型给了 0 分"和"没给有效分"可以区分开。
 */
export function sanitizeDimensions(
  parsed: unknown,
  dims: string[],
  inputIds: ReadonlySet<string>,
): Record<string, ScoreItem> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SceneStructureError("模型输出不是 JSON 对象");
  }
  const obj = parsed as Record<string, unknown>;
  const out: Record<string, ScoreItem> = {};
  for (const key of dims) {
    const raw = obj[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      out[key] = { score: null, reason: "", refs: [] };
      continue;
    }
    const o = raw as Record<string, unknown>;
    const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : null;
    const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 300) : "";
    const rawRefs = toRefIds(o.refs);
    const item: ScoreItem = { score, reason, refs: filterRefIds(rawRefs, inputIds) };
    const dropped = countDroppedRefs(rawRefs, inputIds);
    if (dropped > 0) item.droppedRefs = dropped;
    out[key] = item;
  }
  return out;
}
