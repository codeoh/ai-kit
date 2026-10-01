import type { AiTransport } from "../transport";
import type { SceneDeclaration, SceneResult } from "../types";
import { runScene } from "../scene";
import { createMockTransport } from "../transport";

export interface GoldenCase {
  name: string;
  lang: "zh" | "en";
  /** 本条使用的场景声明；缺省用 opts.scene */
  scene?: SceneDeclaration;
  input: { records: unknown[] };
  /** 离线层：回放模型输出，测解析/校验/降级链路，零 token */
  mockOutput?: string;
  /** 断言失败时 throw，即计为该条失败 */
  asserts: Array<(ctx: GoldenContext) => void>;
}

export interface GoldenContext {
  result?: unknown;
  error?: Error;
  input: { records: unknown[] };
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

function collectItems(result: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (!result || typeof result !== "object") return out;
  for (const v of Object.values(result)) {
    // sections：值是条目数组；dimensions：值是单个条目对象
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
    const t = item.text;
    const r = item.reason;
    if (typeof t === "string") out.push(t);
    if (typeof r === "string") out.push(r);
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

const CJK = /[\u4e00-\u9fa5]/;

export function assertLangIs(lang: "zh" | "en") {
  return ({ result }: GoldenContext): void => {
    const texts = collectTexts(result).filter((t) => t.length > 0);
    if (texts.length === 0) return;
    if (lang === "zh") {
      const bad = texts.filter((t) => !CJK.test(t));
      if (bad.length) throw new Error(`期望中文输出，但存在无中文的文本: ${bad[0]}`);
    } else {
      const bad = texts.filter((t) => CJK.test(t));
      if (bad.length) throw new Error(`期望英文输出，但存在中文文本: ${bad[0]}`);
    }
  };
}

export function assertNounsVerbatim(nouns: string[]) {
  return ({ result }: GoldenContext): void => {
    const all = collectTexts(result).join("\n");
    for (const n of nouns) {
      if (!all.includes(n)) throw new Error(`专有名词未逐字保留: ${n}`);
    }
  };
}

export function assertRefsSubset(ids: string[]) {
  const set = new Set(ids);
  return ({ result }: GoldenContext): void => {
    const refs = collectRefs(result);
    const illegal = refs.filter((r) => !set.has(r));
    if (illegal.length) throw new Error(`存在编造的引用 id: ${illegal.join(",")}`);
  };
}

export function assertCovers(keywords: string[]) {
  return ({ result }: GoldenContext): void => {
    const all = collectTexts(result).join("\n");
    for (const k of keywords) {
      if (!all.includes(k)) throw new Error(`要点未覆盖: ${k}`);
    }
  };
}

export function assertNoError() {
  return ({ error }: GoldenContext): void => {
    if (error) throw new Error(`意外报错: ${error.message}`);
  };
}

export interface RunCasesOptions {
  /** 各条缺省使用的场景声明 */
  scene?: SceneDeclaration;
  /** 缺省用 case.mockOutput 构造 mock transport */
  transport?: (c: GoldenCase) => AiTransport;
}

/** 离线 eval：逐条回放 -> 断言，产出报告；零 token，CI 每次提交可跑 */
export async function runCases(cases: GoldenCase[], opts: RunCasesOptions = {}): Promise<EvalReport> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const scene = c.scene ?? opts.scene;
    if (!scene) throw new Error(`golden case "${c.name}" 缺少 scene`);
    const transport = opts.transport ? opts.transport(c) : createMockTransport([c.mockOutput ?? ""]);
    const ctx: GoldenContext = { input: c.input };
    try {
      ctx.result = await runScene<SceneResult>(scene, transport, {
        lang: c.lang,
        records: c.input.records,
      });
    } catch (e) {
      ctx.error = e instanceof Error ? e : new Error(String(e));
    }
    const failures: string[] = [];
    for (const a of c.asserts) {
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
