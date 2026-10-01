import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  covers,
  evaluate,
  lang,
  noError,
  nouns,
  refs,
} from "../src/eval";
import { SceneStructureError, validateDataProfile, type DataProfile } from "../src";
import { defineScene, type Scene } from "../src";

// ---- Contract: loaded from repo file and validated (same path as CI) ----
const profile: DataProfile = validateDataProfile(
  JSON.parse(readFileSync(new URL("../profiles/ticket.json", import.meta.url), "utf-8")),
);

const ticketSummary: Scene = defineScene({
  id: "ticket_summary",
  task: "Summarize the given support tickets.",
  sections: ["summary", "actions", "risks"],
  about: profile,
});

const ticketTriage: Scene = defineScene({
  id: "ticket_triage",
  task: "Score the given tickets on the four dimensions.",
  scores: ["severity", "urgency", "effort", "risk"],
  about: profile,
});

// ---- Fixture: realistic snapshot mixing English and Chinese bodies (the classic pitfall) ----
const tickets = [
  {
    id: "t1",
    title: "Billing dispute",
    body: "Customer Orion Corp requests a refund for duplicate invoice INV-88; escalation call scheduled Friday.",
    status: "open",
    team: "Platform",
    assignee: "Zhang San",
  },
  {
    id: "t2",
    title: "部署回滚",
    body: "周四晚发布后接口超时，已执行回滚，观察指标平稳。",
    status: "closed",
    team: "Platform",
    assignee: "Zhang San",
  },
  {
    id: "t3",
    title: "Access request",
    body: "New teammate needs staging access; waiting for security approval.",
    status: "pending",
    team: "Infra",
    assignee: "Li Si",
  },
];
const ids = ["t1", "t2", "t3"];

describe("ticket golden eval (acceptance gate)", () => {
  it("5 golden cases all green", async () => {
    const report = await evaluate(ticketSummary, [
      {
        name: "1. zh mode outputs Chinese + proper nouns kept verbatim + key point covered",
        lang: "zh",
        records: tickets,
        mock: JSON.stringify({
          summary: [
            { text: "Orion 公司就重复发票 INV-88 提出退款申请，周五安排升级通话。", refs: ["t1"] },
            { text: "周四发布出现接口超时，已执行回滚并观察。", refs: ["t2"] },
          ],
          actions: [{ text: "张三负责本周工单跟进。", refs: ["t1", "t2"] }],
          risks: [{ text: "staging 权限审批仍在等待，可能阻塞新成员接入。", refs: ["t3"] }],
        }),
        assert: [
          lang("zh"),
          nouns(["Orion", "INV-88"]),
          refs(ids),
          covers(["回滚"]),
        ],
      },
      {
        name: "2. refs whitelist: fabricated id dropped, legal id kept",
        lang: "zh",
        records: tickets,
        mock: JSON.stringify({
          summary: [{ text: "Tickets moving normally.", refs: ["t1", "fake-id-9"] }],
          actions: [],
          risks: [],
        }),
        assert: [
          refs(ids),
          ({ result }) => {
            const r = result as Record<string, { text: string; refs: string[] }[]>;
            expect(r.summary[0]?.refs).toEqual(["t1"]);
          },
        ],
      },
      {
        name: "3. soft-fail: bad items dropped, good items kept",
        lang: "zh",
        records: tickets,
        mock: JSON.stringify({
          summary: [
            { text: "", refs: ["t1"] },
            "not an object",
            { text: "工单已回滚并观察指标。", refs: ["t2"] },
          ],
          actions: [],
          risks: [],
        }),
        assert: [
          noError(),
          ({ result }) => {
            const r = result as Record<string, { text: string; refs: string[] }[]>;
            expect(r.summary).toHaveLength(1);
            expect(r.summary[0]?.text).toContain("回滚");
            expect(r.summary[0]?.refs).toEqual(["t2"]);
          },
        ],
      },
      {
        name: "4. structure error: non-JSON output fails as a whole (SceneStructureError)",
        lang: "zh",
        records: tickets,
        mock: "Sorry, I cannot complete this task.",
        assert: [
          ({ error }) => {
            expect(error).toBeInstanceOf(SceneStructureError);
          },
        ],
      },
    ]);

    const triageReport = await evaluate(ticketTriage, [
      {
        name: "5. dimensions output: triage scores with reasons and refs whitelist",
        lang: "zh",
        records: tickets,
        mock: JSON.stringify({
          severity: { score: 4, reason: "重复发票涉及退款。", refs: ["t1"] },
          urgency: { score: 3, reason: "周五安排升级通话。", refs: ["t1"] },
          effort: { score: 2, reason: "回滚已完成。", refs: ["t2"] },
          risk: { score: 3, reason: "staging 审批阻塞新成员。", refs: ["t3"] },
        }),
        assert: [
          noError(),
          refs(ids),
          ({ result }) => {
            const r = result as Record<string, { score: number }>;
            expect(r.severity?.score).toBe(4);
            expect(r.risk?.score).toBe(3);
          },
          covers(["退款"]),
        ],
      },
    ]);

    const all = [...report.results, ...triageReport.results];
    const failed = all.filter((r) => !r.ok);
    if (failed.length) {
      console.error("golden failures:", JSON.stringify(failed, null, 2));
    }
    expect(report.total + triageReport.total).toBe(5);
    expect(report.passed + triageReport.passed).toBe(5);
  });
});
