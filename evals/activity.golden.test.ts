import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertCovers,
  assertLangIs,
  assertNoError,
  assertNounsVerbatim,
  assertRefsSubset,
  runCases,
} from "../src/eval";
import { SceneStructureError, validateDataProfile, type SceneDeclaration } from "../src";
import type { DataProfile } from "../src";

// ---- 契约：从仓库文件加载并校验（CI 同款路径）----
const profile: DataProfile = validateDataProfile(
  JSON.parse(readFileSync(new URL("../profiles/activity.json", import.meta.url), "utf-8")),
);

const activityScene: SceneDeclaration = {
  id: "activity_summary",
  output: { kind: "sections", sections: ["work", "support", "plan"] },
  prompt: { role: "你是销售团队周报助手。", task: "按三段归纳该客户的全部活动记录。" },
  profile,
  limits: { itemMaxLen: 120, maxItems: 10 },
};

const bantScene: SceneDeclaration = {
  id: "lead_bant",
  output: { kind: "dimensions", dims: ["budget", "authority", "need", "timeline"] },
  prompt: { role: "你是线索评估助手。", task: "按 BANT 四维评估该线索。" },
  profile,
};

// ---- fixture：真实数据形态的快照（含英文周报原文，这是踩过坑的场景）----
const records = [
  {
    id: "a1",
    title: "Weekly report",
    content: "RFP submitted for VVDN project; bid review scheduled on Friday.",
    type: 1,
    status: 2,
    customerName: "华为技术",
    ownerName: "张三",
  },
  {
    id: "a2",
    title: "技术交流",
    content: "与客户平台部完成第二轮技术交流，客户关注交付周期与售后响应。",
    type: 2,
    status: 2,
    customerName: "华为技术",
    ownerName: "张三",
  },
  {
    id: "a3",
    title: "商务跟进",
    content: "客户预算已在 Q4 立项，等待采购流程启动。",
    type: 3,
    status: 1,
    customerName: "华为技术",
    ownerName: "李四",
  },
];
const ids = ["a1", "a2", "a3"];

describe("activity golden eval（M1' 验收门禁）", () => {
  it("5 条 golden case 全绿", async () => {
    const report = await runCases(
      [
        {
          name: "1. 中文模式输出中文 + 专有名词逐字保留 + 要点覆盖",
          lang: "zh",
          scene: activityScene,
          input: { records },
          mockOutput: JSON.stringify({
            work: [
              { text: "VVDN 项目已提交 RFP，周五完成投标评审。", refs: ["a1"] },
              { text: "客户平台部完成第二轮技术交流，聚焦交付周期。", refs: ["a2"] },
            ],
            support: [{ text: "张三负责本周客户跟进。", refs: ["a1", "a2"] }],
            plan: [{ text: "等待采购流程启动后推进商务环节。", refs: ["a3"] }],
          }),
          asserts: [
            assertLangIs("zh"),
            assertNounsVerbatim(["VVDN", "RFP"]),
            assertRefsSubset(ids),
            assertCovers(["投标"]),
          ],
        },
        {
          name: "2. 引用白名单：编造 id 被剔除，合法 id 保留",
          lang: "zh",
          scene: activityScene,
          input: { records },
          mockOutput: JSON.stringify({
            work: [{ text: "客户推进正常。", refs: ["a1", "fake-id-9"] }],
            support: [],
            plan: [],
          }),
          asserts: [
            assertRefsSubset(ids),
            ({ result }) => {
              const r = result as Record<string, { text: string; refs: string[] }[]>;
              expect(r.work[0]?.refs).toEqual(["a1"]);
            },
          ],
        },
        {
          name: "3. 软失败：坏条目剔除，合格条目保留",
          lang: "zh",
          scene: activityScene,
          input: { records },
          mockOutput: JSON.stringify({
            work: [
              { text: "", refs: ["a1"] },
              "这不是对象",
              { text: "预算已在 Q4 立项，等待采购启动。", refs: ["a3"] },
            ],
            support: [],
            plan: [],
          }),
          asserts: [
            assertNoError(),
            ({ result }) => {
              const r = result as Record<string, { text: string; refs: string[] }[]>;
              expect(r.work).toHaveLength(1);
              expect(r.work[0]?.text).toContain("Q4");
              expect(r.work[0]?.refs).toEqual(["a3"]);
            },
          ],
        },
        {
          name: "4. 结构错误：非 JSON 输出整体报错（SceneStructureError）",
          lang: "zh",
          scene: activityScene,
          input: { records },
          mockOutput: "抱歉，我无法完成这个任务。",
          asserts: [
            ({ error }) => {
              expect(error).toBeInstanceOf(SceneStructureError);
            },
          ],
        },
        {
          name: "5. 评分类输出：BANT 维度评分与理由、refs 白名单",
          lang: "zh",
          scene: bantScene,
          input: { records },
          mockOutput: JSON.stringify({
            budget: { score: 4, reason: "客户预算已在 Q4 立项。", refs: ["a3"] },
            authority: { score: 3, reason: "张三为真实负责人。", refs: ["a1"] },
            need: { score: 4, reason: "客户关注交付周期与售后响应。", refs: ["a2"] },
            timeline: { score: 3, reason: "等待采购流程启动。", refs: ["a3"] },
          }),
          asserts: [
            assertNoError(),
            assertRefsSubset(ids),
            ({ result }) => {
              const r = result as Record<string, { score: number }>;
              expect(r.budget?.score).toBe(4);
              expect(r.timeline?.score).toBe(3);
            },
            assertCovers(["预算"]),
          ],
        },
      ],
      { scene: activityScene },
    );

    const failed = report.results.filter((r) => !r.ok);
    if (failed.length) {
      console.error("golden 失败明细:", JSON.stringify(failed, null, 2));
    }
    expect(report.total).toBe(5);
    expect(report.passed).toBe(5);
  });
});

