import type { DataProfile } from "./profile";

export type AiLang = "zh" | "en";

/** 归纳类输出：段落 -> 条目列表 */
export interface SectionItem {
  text: string;
  refs: string[];
}
export type SectionsResult = Record<string, SectionItem[]>;

/** 评分/维度类输出：维度 -> 评分项 */
export interface DimensionItem {
  score: number;
  reason: string;
  refs: string[];
}
export type DimensionsResult = Record<string, DimensionItem>;

export type SceneResult = SectionsResult | DimensionsResult;

export interface SectionsOutputDecl {
  kind: "sections";
  sections: string[];
}
export interface DimensionsOutputDecl {
  kind: "dimensions";
  dims: string[];
}
export type OutputDecl = SectionsOutputDecl | DimensionsOutputDecl;

export interface SceneLimits {
  /** 输入记录 JSON 的最大字符数，超出截断 */
  inputTruncate?: number;
  /** 单条文本最大长度 */
  itemMaxLen?: number;
  /** 单个段落最大条数 */
  maxItems?: number;
}

export interface SceneDeclaration {
  /** 小写下划线，如 customer_dynamics */
  id: string;
  output: OutputDecl;
  prompt: {
    role: string;
    task: string;
    extraRules?: string[];
  };
  profile?: DataProfile;
  limits?: SceneLimits;
  cache?: {
    ttlMs: number;
    schemaVersion?: number;
  };
}
