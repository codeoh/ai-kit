import type { DataProfile } from "./profile";

export type AiLang = "zh" | "en";

/**
 * 模型接缝：唯一约定。任何能"给提示词、回文本"的东西都能当 model——
 * openai/anthropic/ai SDK 的 client 各写 2 行适配，或直接用内置 openai()。
 */
export type Model = (req: { system: string; prompt: string }) => Promise<string>;

/** 归纳类条目 */
export interface SectionItem {
  text: string;
  refs: string[];
}
export type SectionsResult = Record<string, SectionItem[]>;

/** 评分类条目 */
export interface ScoreItem {
  score: number;
  reason: string;
  refs: string[];
}
export type ScoresResult = Record<string, ScoreItem>;

export type SceneResult = SectionsResult | ScoresResult;

export interface SceneLimits {
  /** 输入记录 JSON 的最大字符数，超出截断 */
  inputTruncate?: number;
  /** 单条文本最大长度 */
  itemMaxLen?: number;
  /** 单个段落最大条数 */
  maxItems?: number;
}

/** 声明一个 AI 场景：defineScene 的入参 */
export interface SceneOptions {
  /** 小写下划线 id，用于 eval 报告与调试；可省略 */
  id?: string;
  /** 本次任务的一句话描述（用户语言） */
  task: string;
  /** 模型扮演的角色；省略时由包给通用默认 */
  role?: string;
  /** 归纳类输出的段落键，如 ["summary", "actions", "risks"] */
  sections?: string[];
  /** 评分类输出的维度键，如 ["severity", "urgency"] */
  scores?: string[];
  /** 语义契约：字段含义、回退口径、locale 事实 */
  about?: DataProfile;
  limits?: SceneLimits;
  /** 追加规则（七条强制不变量之外的增量，不可用于关闭不变量） */
  extraRules?: string[];
}

/** defineScene 的返回值：声明一次，runScene 调用无数次 */
export interface Scene {
  id: string;
  task: string;
  role?: string;
  output: { kind: "sections"; keys: string[] } | { kind: "scores"; keys: string[] };
  limits?: SceneLimits;
  profile?: DataProfile;
  extraRules?: string[];
}

/** runScene 的入参 */
export interface RunInput {
  /** 模型接缝：任何 SDK 两行适配，或用内置 openai() */
  model: Model;
  /** 业务数据；每条须有 id 字段供 refs 引用 */
  records: unknown[];
  /** 输出语言；默认 "en" */
  lang?: AiLang;
  /** 程序统计（数字不经模型）；传 records => stats 的函数 */
  stats?: (records: unknown[]) => unknown;
  /** 校验失败喂回重试次数；默认 0 */
  retries?: number;
}
