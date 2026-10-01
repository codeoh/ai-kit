import { describe, expect, it } from "vitest";
import { defineAiScene } from "../src";

describe("defineAiScene", () => {
  it("原样返回声明，类型收口", () => {
    const scene = defineAiScene({
      id: "demo",
      output: { kind: "sections", sections: ["work"] },
      prompt: { role: "r", task: "t" },
    });
    expect(scene.id).toBe("demo");
  });
});
