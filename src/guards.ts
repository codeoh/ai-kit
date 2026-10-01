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

/** 引用白名单：非法 id 直接剔除（防编造溯源） */
export function filterRefIds(ids: string[], inputIds: ReadonlySet<string>): string[] {
  return ids.filter((id) => inputIds.has(id));
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
 * refs 白名单过滤；文本截断；条数封顶。仅整体非对象时抛 SceneStructureError。
 */
export function sanitizeSections(
  parsed: unknown,
  sections: string[],
  inputIds: ReadonlySet<string>,
  limits?: { itemMaxLen?: number; maxItems?: number },
): Record<string, { text: string; refs: string[] }[]> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SceneStructureError("模型输出不是 JSON 对象");
  }
  const obj = parsed as Record<string, unknown>;
  const { itemMaxLen, maxItems } = resolveLimits(limits);
  const out: Record<string, { text: string; refs: string[] }[]> = {};
  for (const key of sections) {
    const rawArr = obj[key];
    const items: { text: string; refs: string[] }[] = [];
    if (Array.isArray(rawArr)) {
      for (const it of rawArr) {
        if (!it || typeof it !== "object" || Array.isArray(it)) continue;
        const rawText = (it as Record<string, unknown>).text;
        if (typeof rawText !== "string") continue;
        const text = rawText.trim();
        if (!text) continue;
        const refs = filterRefIds(toRefIds((it as Record<string, unknown>).refs), inputIds);
        items.push({ text: text.slice(0, itemMaxLen), refs });
        if (items.length >= maxItems) break;
      }
    }
    out[key] = items;
  }
  return out;
}

/**
 * dimensions 清洗：score 非有限数字按缺失处理；reason 必须是字符串；
 * refs 白名单过滤。声明键缺失时给空壳占位，保证契约键完整。
 */
export function sanitizeDimensions(
  parsed: unknown,
  dims: string[],
  inputIds: ReadonlySet<string>,
): Record<string, { score: number; reason: string; refs: string[] }> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SceneStructureError("模型输出不是 JSON 对象");
  }
  const obj = parsed as Record<string, unknown>;
  const out: Record<string, { score: number; reason: string; refs: string[] }> = {};
  for (const key of dims) {
    const raw = obj[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      out[key] = { score: 0, reason: "", refs: [] };
      continue;
    }
    const o = raw as Record<string, unknown>;
    const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : 0;
    const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 300) : "";
    const refs = filterRefIds(toRefIds(o.refs), inputIds);
    out[key] = { score, reason, refs };
  }
  return out;
}
