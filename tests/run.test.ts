import { describe, expect, it } from "vitest";
import { defineScene, runScene, SceneStructureError } from "../src";
import type { Model } from "../src";

const scene = defineScene({
  id: "ticket_summary",
  task: "Summarize the given tickets.",
  sections: ["summary", "actions", "risks"],
});

const tickets = [{ id: "t1", title: "Billing dispute", body: "refund" }];
const goodOutput = JSON.stringify({ summary: [{ text: "ok", refs: ["t1"] }], actions: [], risks: [] });

function modelReturning(outputs: string[]): Model {
  let i = 0;
  return async () => {
    const c = outputs[i] ?? "";
    i += 1;
    return c;
  };
}

describe("defineScene", () => {
  it("校验入参：task 必填", () => {
    expect(() => defineScene({ sections: ["a"] } as never)).toThrow(TypeError);
  });
  it("sections 与 scores 二选一", () => {
    expect(() => defineScene({ task: "t", sections: ["a"], scores: ["b"] })).toThrow(TypeError);
    expect(() => defineScene({ task: "t" })).toThrow(TypeError);
  });
  it("归一化：sections 转成内部 output 声明", () => {
    const s = defineScene({ id: "demo", task: "t", sections: ["work"] });
    expect(s.output).toEqual({ kind: "sections", keys: ["work"] });
  });
});

describe("runScene", () => {
  it("组装 prompt 并解析输出", async () => {
    const seen: Array<{ system: string; prompt: string }> = [];
    const model: Model = async (req) => {
      seen.push(req);
      return goodOutput;
    };
    const r = await runScene(scene, { model, records: tickets, lang: "zh" });
    expect(r.summary).toEqual([{ text: "ok", refs: ["t1"] }]);
    expect(seen[0]?.system).toContain("输出语言必须是中文");
    expect(seen[0]?.prompt).toContain("t1");
  });

  it("lang 缺省为 en", async () => {
    const model: Model = async (req) => {
      expect(req.system).toContain("Output language must be English");
      return JSON.stringify({ summary: [{ text: "ok", refs: ["t1"] }], actions: [], risks: [] });
    };
    await runScene(scene, { model, records: tickets });
  });

  it("refs 白名单：编造 id 剔除", async () => {
    const bad = JSON.stringify({
      summary: [{ text: "ok", refs: ["t1", "fake"] }],
      actions: [],
      risks: [],
    });
    const r = (await runScene(scene, { model: modelReturning([bad]), records: tickets })) as import("../src").SectionsResult;
    expect(r.summary[0]?.refs).toEqual(["t1"]);
  });

  it("retries：结构错误喂回重试后成功", async () => {
    const bad = "抱歉，我无法输出 JSON。";
    const calls: string[] = [];
    const model: Model = async (req) => {
      calls.push(req.prompt);
      return calls.length === 1 ? bad : goodOutput;
    };
    const r = await runScene(scene, { model, records: tickets, retries: 1 });
    expect(r.summary).toHaveLength(1);
    expect(calls[1]).toContain("Previous attempt failed");
  });

  it("retries 耗尽后抛最后的错误", async () => {
    const model = modelReturning(["no json", "still no json"]);
    await expect(runScene(scene, { model, records: tickets, retries: 1 })).rejects.toBeInstanceOf(
      SceneStructureError,
    );
  });

  it("网络错误不参与重试，直接抛出", async () => {
    let calls = 0;
    const model: Model = async () => {
      calls += 1;
      throw new Error("network down");
    };
    await expect(runScene(scene, { model, records: tickets, retries: 3 })).rejects.toThrow(
      "network down",
    );
    expect(calls).toBe(1);
  });

  it("裸 Model 下截断输出表现为 SceneStructureError（openai 帮助函数则抛 TruncatedOutputError）", async () => {
    const model = modelReturning(['{"summary":[{"te']);
    await expect(runScene(scene, { model, records: tickets })).rejects.toBeInstanceOf(
      SceneStructureError,
    );
  });

  it("scores 场景输出评分类结果", async () => {
    const triage = defineScene({
      task: "Triage tickets.",
      scores: ["severity", "urgency"],
    });
    const model = modelReturning([
      JSON.stringify({
        severity: { score: 4, reason: "refund involved", refs: ["t1"] },
        urgency: { score: 3, reason: "friday call", refs: ["t1"] },
      }),
    ]);
    const r = await runScene(triage, { model, records: tickets });
    expect(r.severity).toEqual({ score: 4, reason: "refund involved", refs: ["t1"] });
  });
});
