import { describe, expect, it } from "vitest";
import { ProfileError, profileToPromptBlock, validateDataProfile } from "../src/profile";

const ok = {
  entity: "activity",
  fields: [
    { name: "id", meaning: "唯一 id" },
    { name: "customerName", meaning: "客户名", authoritative: true, fallback: "缺失用名称匹配" },
    { name: "ownerName", meaning: "负责人", pii: true },
  ],
  unavailable: ["跨系统出货关联"],
  localeFacts: ["locale 仅 zh-CN/en-US"],
};

describe("validateDataProfile", () => {
  it("合法档案通过并归一化", () => {
    const p = validateDataProfile(ok);
    expect(p.entity).toBe("activity");
    expect(p.fields).toHaveLength(3);
    expect(p.fields[0]?.name).toBe("id");
    expect(p.unavailable).toEqual(["跨系统出货关联"]);
  });
  it("缺 entity / fields 抛 ProfileError", () => {
    expect(() => validateDataProfile({})).toThrow(ProfileError);
    expect(() => validateDataProfile({ entity: "a", fields: [] })).toThrow(ProfileError);
    expect(() => validateDataProfile(null)).toThrow(ProfileError);
  });
  it("字段缺 name/meaning 抛 ProfileError 且带位置", () => {
    expect(() => validateDataProfile({ entity: "a", fields: [{ meaning: "x" }] })).toThrow("fields[0]");
  });
  it("多余字段被丢弃（strict 白名单）", () => {
    const p = validateDataProfile({
      entity: "a",
      fields: [{ name: "f", meaning: "m", hack: true }],
    });
    expect(Object.keys(p.fields[0] ?? {})).toEqual(["name", "meaning"]);
  });
});

describe("profileToPromptBlock", () => {
  it("渲染字段含义、回退、PII、未上线能力、语言事实", () => {
    const block = profileToPromptBlock(validateDataProfile(ok));
    expect(block).toContain("实体：activity");
    expect(block).toContain("缺失回退: 缺失用名称匹配");
    expect(block).toContain("（敏感字段）");
    expect(block).toContain("未上线能力");
    expect(block).toContain("locale 仅 zh-CN/en-US");
  });
});
