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
  it("包含七条不变量", () => {
    const s = buildSystemPrompt(scene, "zh");
    for (const kw of ["输出语言", "专有名词", "统计数字", "refs", "空数组", "紧凑 JSON", "一句话"]) {
      expect(s).toContain(kw);
    }
  });
  it("语言规则随 lang 变化", () => {
    expect(buildSystemPrompt(scene, "zh")).toContain("输出语言必须是中文");
    expect(buildSystemPrompt(scene, "en")).toContain("输出语言必须是English");
  });
  it("注入语义契约（含缺失回退口径）", () => {
    const s = buildSystemPrompt(scene, "zh");
    expect(s).toContain("数据语义档案 · 实体：ticket");
    expect(s).toContain("compute it from createdAt/resolvedAt");
    expect(s).toContain("未上线能力");
  });
  it("输出契约会列出声明的段落键", () => {
    expect(buildSystemPrompt(scene, "zh")).toContain('["summary","actions","risks"]');
  });
});

describe("buildUserPrompt", () => {
  it("包含记录 JSON 与 id 说明", () => {
    const u = buildUserPrompt(scene, [{ id: "t1", title: "t" }]);
    expect(u).toContain("唯一合法取值");
    expect(u).toContain('"t1"');
  });
  it("超过 inputTruncate 截断并标注", () => {
    const u = buildUserPrompt(scene, [{ id: "t1", blob: "x".repeat(25000) }]);
    expect(u).toContain("[已截断]");
  });
  it("stats 附程序统计块", () => {
    const u = buildUserPrompt(scene, [{ id: "t1" }], { total: 3 });
    expect(u).toContain("禁止改写");
    expect(u).toContain('{"total":3}');
  });
});
