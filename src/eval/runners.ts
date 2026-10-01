import type { AiLang, Model, Scene, SceneResult } from "../types";
import { runScene } from "../runScene";
import { TruncatedOutputError } from "../model";

export interface GoldenCase {
  name: string;
  /** 缺省 "en" */
  lang?: AiLang;
  records: unknown[];
  /** 回放的模型输出（字符串或按调用次序的数组），零 token */
  mock: string | string[];
  /** 断言；失败时 throw 即计为该条失败 */
  assert: Array<(ctx: GoldenContext) => void>;
}

export interface GoldenContext {
  result?: SceneResult;
  error?: Error;
  records: unknown[];
}

export interface CaseResult {
  name: string;
  ok: boolean;
  failures: string[];
}

export interface EvalReport {
  total: number;
  passed: number;
  results: CaseResult[];
}

export function mockModel(mock: string | string[]): Model {
  let i = 0;
  return async () => {
    if (Array.isArray(mock)) {
      const content = mock[i] ?? "";
      i += 1;
      return content;
    }
    return mock;
  };
}

const CJK = /[\u4e00-\u9fa5]/;

function collectItems(result: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (!result || typeof result !== "object") return out;
  for (const v of Object.values(result)) {
    // sections：值是条目数组；scores：值是单个条目对象
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object") out.push(item as Record<string, unknown>);
      }
    } else if (v && typeof v === "object") {
      out.push(v as Record<string, unknown>);
    }
  }
  return out;
}

function collectTexts(result: unknown): string[] {
  const out: string[] = [];
  for (const item of collectItems(result)) {
    if (typeof item.text === "string") out.push(item.text);
    if (typeof item.reason === "string") out.push(item.reason);
  }
  return out;
}

function collectRefs(result: unknown): string[] {
  const out: string[] = [];
  for (const item of collectItems(result)) {
    if (Array.isArray(item.refs)) out.push(...(item.refs as string[]));
  }
  return out;
}

/** 断言：输出语言正确 */
export function lang(expected: AiLang) {
  return ({ result }: GoldenContext): void => {
    const texts = collectTexts(result).filter((t) => t.length > 0);
    if (texts.length === 0) return;
    if (expected === "zh") {
      const bad = texts.filter((t) => !CJK.test(t));
      if (bad.length) throw new Error(`期望中文输出，但存在无中文的文本: ${bad[0]}`);
    } else {
      const bad = texts.filter((t) => CJK.test(t));
      if (bad.length) throw new Error(`期望英文输出，但存在中文文本: ${bad[0]}`);
    }
  };
}

/** 断言：专有名词逐字保留 */
export function nouns(list: string[]) {
  return ({ result }: GoldenContext): void => {
    const all = collectTexts(result).join("\n");
    for (const n of list) {
      if (!all.includes(n)) throw new Error(`专有名词未逐字保留: ${n}`);
    }
  };
}

/** 断言：refs 全部在白名单内 */
export function refs(ids: string[]) {
  const set = new Set(ids);
  return ({ result }: GoldenContext): void => {
    const illegal = collectRefs(result).filter((r) => !set.has(r));
    if (illegal.length) throw new Error(`存在编造的引用 id: ${illegal.join(",")}`);
  };
}

/** 断言：要点覆盖 */
export function covers(keywords: string[]) {
  return ({ result }: GoldenContext): void => {
    const all = collectTexts(result).join("\n");
    for (const k of keywords) {
      if (!all.includes(k)) throw new Error(`要点未覆盖: ${k}`);
    }
  };
}

/** 断言：没有意外报错 */
export function noError() {
  return ({ error }: GoldenContext): void => {
    if (error) throw new Error(`意外报错: ${error.message}`);
  };
}

/**
 * 离线 eval：逐条回放 -> 断言 -> 报告。零 token，CI 每次提交可跑。
 */
export async function evaluate(
  scene: Scene,
  cases: GoldenCase[],
  opts: { model?: Model } = {},
): Promise<EvalReport> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const model: Model = opts.model ?? mockModel(c.mock);
    const ctx: GoldenContext = { records: c.records };
    try {
      ctx.result = await runScene<SceneResult>(scene, {
        model,
        records: c.records,
        lang: c.lang ?? "en",
      });
    } catch (e) {
      ctx.error = e instanceof Error ? e : new Error(String(e));
    }
    const failures: string[] = [];
    for (const a of c.assert) {
      try {
        a(ctx);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }
    results.push({ name: c.name, ok: failures.length === 0, failures });
  }
  return { total: cases.length, passed: results.filter((r) => r.ok).length, results };
}

export { TruncatedOutputError };
