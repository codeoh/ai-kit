import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt, defineScene, validateDataProfile } from "../src";
import type { Scene } from "../src";
import ticketProfileJson from "../profiles/ticket.json";

const scene: Scene = defineScene({
  id: "ticket_summary",
  task: "Summarize the given tickets.",
  sections: ["summary", "actions", "risks"],
  about: validateDataProfile(ticketProfileJson),
});

describe("buildSystemPrompt", () => {
  it("包含七条硬规则（zh）", () => {
    const s = buildSystemPrompt(scene, "zh");
    for (const kw of ["输出语言", "专有名词", "统计数字", "refs", "空数组", "紧凑 JSON", "一句话"]) {
      expect(s).toContain(kw);
    }
  });
  it("七条规则随lang 切换成英文", () => {
    const s = buildSystemPrompt(scene, "en");
    expect(s).toContain("Output language must be English");
    expect(s).toContain("Proper nouns");
    expect(s).toContain("program-computed");
    expect(s).toContain("refs");
  });
  it("英文提示词里不再夹中文（实测曾有 213 个中文字符）", () => {
    const s = buildSystemPrompt(scene, "en");
    const cjk = s.match(/[\u4e00-\u9fa5]/g) ?? [];
    expect(cjk.length).toBe(0);
  });
  it("注入语义契约（含缺失回退口径）", () => {
    const s = buildSystemPrompt(scene, "zh");
    expect(s).toContain("数据语义档案 · 实体：ticket");
    expect(s).toContain("compute it from createdAt/resolvedAt");
    expect(s).toContain("未上线能力");
  });
  it("输出契约会列出声明的段落键", () => {
    expect(buildSystemPrompt(scene, "zh")).toContain('["summary","actions","risks"]');
    expect(buildSystemPrompt(scene, "en")).toContain('["summary","actions","risks"]');
  });
});

describe("buildUserPrompt", () => {
  it("包含记录 JSON 与 id 说明", () => {
    const u = buildUserPrompt(scene, [{ id: "t1", title: "t" }], undefined, "zh");
    expect(u).toContain("唯一合法取值");
    expect(u).toContain('"t1"');
  });
  it("缺省 lang 为 en", () => {
    const u = buildUserPrompt(scene, [{ id: "t1", title: "t" }]);
    expect(u).toContain("the id field is the only legal value for refs");
  });
  it("超长时按记录整条丢弃，标注还剩多少条", () => {
    const records = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, blob: "x".repeat(1000) }));
    const u = buildUserPrompt(scene, records, undefined, "zh");
    expect(u).toContain("未纳入");
    expect(u).toContain("请勿推测");
  });
  it("裁剪后送出的仍然是合法 JSON（早期按字符硬切会送出坏 JSON）", () => {
    const records = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, body: "x".repeat(1000) }));
    const u = buildUserPrompt(scene, records, undefined, "zh");
    const start = u.indexOf("：\n") + 2;
    const end = u.indexOf("\n\n注意");
    const json = u.slice(start, end);
    expect(() => JSON.parse(json)).not.toThrow();
    // 且送出的记录必须是完整记录，不是半截
    const parsed = JSON.parse(json) as Array<{ id: string; body: string }>;
    expect(parsed.every((r) => r.body.length === 1000)).toBe(true);
  });
  it("stats 附程序统计块", () => {
    const u = buildUserPrompt(scene, [{ id: "t1" }], { total: 3 }, "zh");
    expect(u).toContain("禁止改写");
    expect(u).toContain('{"total":3}');
  });
});
