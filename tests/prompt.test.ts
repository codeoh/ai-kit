import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../src/prompt";
import { validateDataProfile, type SceneDeclaration } from "../src";
import activityProfile from "../profiles/ticket.json";

const scene: SceneDeclaration = {
  id: "activity_summary",
  output: { kind: "sections", sections: ["work", "support", "plan"] },
  prompt: { role: "你是销售团队周报助手。", task: "按三段归纳该客户的全部活动记录。" },
  profile: validateDataProfile(activityProfile),
};

describe("buildSystemPrompt", () => {
  it("包含七条不变量", () => {
    const s = buildSystemPrompt(scene, "zh");
    for (const kw of ["输出语言", "专有名词", "统计数字", "refs", "空数组", "紧凑 JSON", "一句话"]) {
      expect(s).toContain(kw);
    }
  });
  it("语言规则随 lang 变化", () => {
    expect(buildSystemPrompt(scene, "zh")).toContain("输出语言必须是中文");
    expect(buildSystemPrompt(scene, "en")).toContain("输出语言必须是英文");
  });
  it("注入语义档案（含缺失回退口径）", () => {
    const s = buildSystemPrompt(scene, "zh");
    expect(s).toContain("数据语义档案 · 实体：ticket");
    expect(s).toContain("compute it from createdAt/resolvedAt");
    expect(s).toContain("未上线能力");
  });
  it("输出契约会列出声明的段落键", () => {
    expect(buildSystemPrompt(scene, "zh")).toContain('["work","support","plan"]');
  });
});

describe("buildUserPrompt", () => {
  it("包含记录 JSON 与 id 说明", () => {
    const u = buildUserPrompt(scene, [{ id: "a1", title: "t" }]);
    expect(u).toContain("唯一合法取值");
    expect(u).toContain('"a1"');
  });
  it("超过 inputTruncate 截断并标注", () => {
    const u = buildUserPrompt(scene, [{ id: "a1", blob: "x".repeat(25000) }]);
    expect(u).toContain("[已截断]");
  });
  it("stats 附程序统计块", () => {
    const u = buildUserPrompt(scene, [{ id: "a1" }], { total: 3 });
    expect(u).toContain("禁止改写");
    expect(u).toContain('{"total":3}');
  });
});
