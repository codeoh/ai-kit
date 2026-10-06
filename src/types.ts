import type { DataProfile } from "./profile";
import type { JsonSchemaNode } from "./schema";

export type AiLang = "zh" | "en";

/** 结构化输出的 schema：name 供 OpenAI 的 json_schema.name 用，node 是形状本身 */
export interface StructuredSchema {
  name: string;
  node: JsonSchemaNode;
}

/**
 * 模型接缝：唯一约定。任何能"给提示词、回文本"的东西都能当 model——
 * openai/anthropic/ai SDK 的 client 各写 2 行适配，或直接用内置 openai()。
 *
 * system 与 prompt 必填；signal 与 jsonSchema 可选，
 * 只解构前两个参数的老适配代码不用改。
 */
export interface ModelRequest {
  system: string;
  prompt: string;
  /** 中断信号。调用方取消时，内置 openai() 会真的停掉请求 */
  signal?: AbortSignal;
  /**
   * 由 runScene 从 scene 推导出的结构化输出形状。
   * 内置 openai() 在支持时用它约束输出；自写适配器可以忽略，退回纯提示词。
   */
  jsonSchema?: StructuredSchema;
}

export type Model = (req: ModelRequest) => Promise<string>;

/** 归纳类条目 */
export interface SectionItem {
  text: string;
  refs: string[];
  /** 本条有多少个引用因为不在输入里被剔除；>0 说明模型编了 id */
  droppedRefs?: number;
}
export type SectionsResult = Record<string, SectionItem[]>;

/**
 * 评分类条目。
 * score 为 null 表示模型没给出有效数字（缺失、类型错、非有限值），
 * 与"模型给了 0 分"是两回事——调用方要靠这个区分。
 */
export interface ScoreItem {
  score: number | null;
  reason: string;
  refs: string[];
  /** 本条有多少个引用因为不在输入里被剔除；>0 说明模型编了 id */
  droppedRefs?: number;
}
export type ScoresResult = Record<string, ScoreItem>;

export type SceneResult = SectionsResult | ScoresResult;

export interface SceneLimits {
  /** 输入记录的最大字符数，超出部分按记录整条丢弃（不会送出半截 JSON） */
  inputTruncate?: number;
  /** 单条文本最大长度 */
  itemMaxLen?: number;
  /** 单个段落最大条数 */
  maxItems?: number;
}

/** 声明一个 AI 场景：defineScene 的入参 */
export interface SceneOptions {
  /** 场景标识，用于 eval 报告、schema 命名与调试；省略时由 task 归一化 */
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
  /** 追加规则（7 条硬规则之外的增量，不可用于关闭它们） */
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
  /** 中断信号，透传给 model */
  signal?: AbortSignal;
}
