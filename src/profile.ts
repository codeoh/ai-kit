/** 语义档案字段：包零业务概念，实体语义由消费方声明 */
export interface DataProfileField {
  name: string;
  /** 一句话含义，注入 prompt */
  meaning: string;
  /** 字典编码说明（消费方自己的字典体系） */
  dict?: string;
  /** 是否权威字段（如真实执行人、归组依据） */
  authoritative?: boolean;
  /** 缺失回退口径说明 */
  fallback?: string;
  /** 敏感字段：送模型前可按策略脱敏（预留） */
  pii?: boolean;
}

export interface DataProfile {
  entity: string;
  fields: DataProfileField[];
  /** 未上线能力禁用清单（防 AI 据此归因） */
  unavailable?: string[];
  /** 语言/环境事实（如 "locale 仅 zh-CN/en-US"） */
  localeFacts?: string[];
}

export class ProfileError extends Error {
  constructor(message: string) {
    super(`DataProfile 校验失败: ${message}`);
    this.name = "ProfileError";
  }
}

/** 校验并归一化消费方声明的档案文件；供 CI 校验契约文件 */
export function validateDataProfile(raw: unknown): DataProfile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProfileError("根节点必须是对象");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.entity !== "string" || !r.entity) {
    throw new ProfileError("entity 必须是非空字符串");
  }
  if (!Array.isArray(r.fields) || r.fields.length === 0) {
    throw new ProfileError("fields 必须是非空数组");
  }
  const fields: DataProfileField[] = r.fields.map((f, i) => {
    if (!f || typeof f !== "object") throw new ProfileError(`fields[${i}] 必须是对象`);
    const fo = f as Record<string, unknown>;
    if (typeof fo.name !== "string" || !fo.name) throw new ProfileError(`fields[${i}].name 必须是非空字符串`);
    if (typeof fo.meaning !== "string" || !fo.meaning) throw new ProfileError(`fields[${i}].meaning 必须是非空字符串`);
    const field: DataProfileField = { name: fo.name, meaning: fo.meaning };
    if (typeof fo.dict === "string") field.dict = fo.dict;
    if (typeof fo.authoritative === "boolean") field.authoritative = fo.authoritative;
    if (typeof fo.fallback === "string") field.fallback = fo.fallback;
    if (typeof fo.pii === "boolean") field.pii = fo.pii;
    return field;
  });
  const unavailable = Array.isArray(r.unavailable) ? r.unavailable.filter((s): s is string => typeof s === "string") : [];
  const localeFacts = Array.isArray(r.localeFacts) ? r.localeFacts.filter((s): s is string => typeof s === "string") : [];
  return { entity: r.entity, fields, unavailable, localeFacts };
}

/** 把档案渲染成可注入 system prompt 的文本块 */
export function profileToPromptBlock(p: DataProfile): string {
  const lines: string[] = [`【数据语义档案 · 实体：${p.entity}】`];
  for (const f of p.fields) {
    let line = `- ${f.name}: ${f.meaning}`;
    if (f.dict) line += `（字典: ${f.dict}）`;
    if (f.authoritative) line += "（权威字段）";
    if (f.pii) line += "（敏感字段）";
    if (f.fallback) line += `；缺失回退: ${f.fallback}`;
    lines.push(line);
  }
  if (p.unavailable && p.unavailable.length) {
    lines.push(`- 未上线能力（禁止据此归因或建议）: ${p.unavailable.join("、")}`);
  }
  if (p.localeFacts && p.localeFacts.length) {
    lines.push(`- 语言/环境事实: ${p.localeFacts.join("；")}`);
  }
  return lines.join("\n");
}
