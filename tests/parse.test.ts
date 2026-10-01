import { describe, expect, it } from "vitest";
import { extractJson, parseSceneOutput } from "../src/parse";
import { filterRefIds, sanitizeDimensions, sanitizeSections, SceneStructureError, toRefIds } from "../src/guards";

const ids = new Set(["a1", "a2", "a3"]);

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
      { work: [null, "str", { text: "", refs: [] }, { refs: ["a1"] }, { text: "  正常  ", refs: ["a2"] }] },
      ["work"],
      ids,
    );
    expect(out.work).toEqual([{ text: "正常", refs: ["a2"] }]);
  });
  it("refs 白名单：编造 id 剔除，合法保留", () => {
    const out = sanitizeSections(
      { work: [{ text: "t", refs: ["a1", "fake-9", 42, "a3"] }] },
      ["work"],
      ids,
    );
    expect(out.work[0]?.refs).toEqual(["a1", "a3"]);
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
  it("缺维度给空壳占位，score 非数字归 0，refs 白名单", () => {
    const out = sanitizeDimensions(
      { budget: { score: Number.NaN, reason: "r", refs: ["fake"] }, need: "bad" },
      ["budget", "authority", "need"],
      ids,
    );
    expect(out.budget).toEqual({ score: 0, reason: "r", refs: [] });
    expect(out.authority).toEqual({ score: 0, reason: "", refs: [] });
    expect(out.need).toEqual({ score: 0, reason: "", refs: [] });
  });
});

describe("helpers", () => {
  it("toRefIds 只收字符串", () => {
    expect(toRefIds(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(toRefIds("nope")).toEqual([]);
  });
  it("filterRefIds 按白名单过滤", () => {
    expect(filterRefIds(["a1", "x", "a2"], ids)).toEqual(["a1", "a2"]);
  });
});
