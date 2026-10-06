import { describe, expect, it } from "vitest";
import { extractJson, parseSceneOutput } from "../src/parse";
import { defineScene } from "../src";
import { countDroppedRefs, filterRefIds, sanitizeDimensions, sanitizeSections, SceneStructureError, toRefIds } from "../src/guards";

const ids = new Set(["t1", "t2", "t3"]);

const scene = defineScene({
  id: "demo",
  task: "t",
  sections: ["summary", "risks"],
});

describe("extractJson", () => {
  it("解析纯 JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("容忍 markdown 围栏", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("容忍前后闲话", () => {
    expect(extractJson('好的，以下是结果：{"a":1} 请查收')).toEqual({ a: 1 });
  });
  it("无 JSON 时抛结构错误", () => {
    expect(() => extractJson("抱歉，我无法完成")).toThrow(SceneStructureError);
  });
});

describe("sanitizeSections", () => {
  it("非对象整体抛 SceneStructureError", () => {
    expect(() => sanitizeSections([1, 2], ["work"], ids)).toThrow(SceneStructureError);
    expect(() => sanitizeSections("text", ["work"], ids)).toThrow(SceneStructureError);
  });
  it("软失败：坏条目剔除，好条目保留", () => {
    const out = sanitizeSections(
      { work: [null, "str", { text: "", refs: [] }, { refs: ["t1"] }, { text: "  正常  ", refs: ["t2"] }] },
      ["work"],
      ids,
    );
    expect(out.work).toEqual([{ text: "正常", refs: ["t2"] }]);
  });
  it("refs 白名单：编造 id 剔除，合法保留", () => {
    const out = sanitizeSections(
      { work: [{ text: "t", refs: ["t1", "fake-9", 42, "t3"] }] },
      ["work"],
      ids,
    );
    expect(out.work[0]?.refs).toEqual(["t1", "t3"]);
  });
  it("未声明的段落键被丢弃；声明键缺失给空数组", () => {
    const out = sanitizeSections({ extra: [{ text: "x", refs: [] }] }, ["work", "plan"], ids);
    expect(out).toEqual({ work: [], plan: [] });
  });
  it("itemMaxLen 截断、maxItems 封顶", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ text: `t${i}${"x".repeat(200)}`, refs: [] }));
    const out = sanitizeSections({ work: items }, ["work"], ids, { itemMaxLen: 10, maxItems: 2 });
    expect(out.work).toHaveLength(2);
    expect(out.work[0]?.text).toHaveLength(10);
  });
});

describe("sanitizeDimensions", () => {
  it("非法 score 归 null（早期静默变0，会把语义错误的低分伪装成正常零分）", () => {
    const out = sanitizeDimensions(
      { budget: { score: Number.NaN, reason: "r", refs: ["fake"] }, need: "bad" },
      ["budget", "authority", "need"],
      ids,
    );
    expect(out.budget).toEqual({ score: null, reason: "r", refs: [], droppedRefs: 1 });
    expect(out.authority).toEqual({ score: null, reason: "", refs: [] });
    expect(out.need).toEqual({ score: null, reason: "", refs: [] });
  });
  it("字符串数字也归 null，不当0 分处理", () => {
    const out = sanitizeDimensions({ sev: { score: "4" } }, ["sev"], ids);
    expect(out.sev.score).toBeNull();
  });
  it("合法的 0 分要原样保留，与 null 可区分", () => {
    const out = sanitizeDimensions({ sev: { score: 0, reason: "无风险" } }, ["sev"], ids);
    expect(out.sev.score).toBe(0);
  });
  it("记录被剔除的引用数，>0 说明模型编了 id", () => {
    const out = sanitizeDimensions(
      { sev: { score: 3, reason: "r", refs: ["t1", "ghost1", "ghost2"] } },
      ["sev"],
      ids,
    );
    expect(out.sev.refs).toEqual(["t1"]);
    expect(out.sev.droppedRefs).toBe(2);
  });
});

describe("parseSceneOutput", () => {
  it("按场景输出声明解析", () => {
    const raw = JSON.stringify({ summary: [{ text: "ok", refs: ["t1"] }], risks: [] });
    const out = parseSceneOutput(scene, raw, ids);
    expect(out.summary).toEqual([{ text: "ok", refs: ["t1"] }]);
  });
});

describe("helpers", () => {
  it("toRefIds 只收字符串", () => {
    expect(toRefIds(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(toRefIds("nope")).toEqual([]);
  });
  it("filterRefIds 按白名单过滤", () => {
    expect(filterRefIds(["t1", "x", "t2"], ids)).toEqual(["t1", "t2"]);
  });
  it("countDroppedRefs 数出编造的 id 个数", () => {
    expect(countDroppedRefs(["t1", "x", "t2", "y"], ids)).toBe(2);
    expect(countDroppedRefs(["t1", "t2"], ids)).toBe(0);
  });
});
