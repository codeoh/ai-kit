# ai-kit [![npm](https://img.shields.io/npm/v/ai-kit.svg)](https://www.npmjs.com/package/ai-kit) [![node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE) [![typescript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

[English](./README.md) | [简体中文](./README.zh-CN.md)

把业务数据变成**带引用、可校验的结构化 AI 输出**——摘要、评分、推荐、抽取。任意模型、任意你已经在用的 SDK 都能接。

调模型本身两行就够，但拿到的那是个字符串，往下全是活：抠 JSON、验语言、核对模型引用的记录 id 是否真实存在、丢掉格式错误的条目、数字改成代码算、每次改 prompt 全部重验。ai-kit 就是这一整层。

## Getting Started

```bash
npm install ai-kit
```

完整图文步骤见 **[完整指南](./docs/guide.zh-CN.md)**。

## 30 秒上手

```ts
import { defineScene, openai, runScene } from "ai-kit";

const summary = defineScene({
  task: "归纳这些支持工单。",
  sections: ["summary", "actions", "risks"],   // 决定输出结构
});

const result = await runScene(summary, {
  model: openai({ model: "deepseek-chat", baseURL: "...", apiKey: "..." }),
  records: tickets,        // [{ id: "t1", title: "Billing dispute", ... }]
  lang: "zh",
});

result.summary;   // [{ text: "Orion 提出重复发票 INV-88 的退款申请。", refs: ["t1"] }]
```

## 它能干什么

| 能力              | 说明                                                         |
| --------------- | ---------------------------------------------------------- |
| 归纳 / 摘要 / 推荐    | `sections: ["summary", "actions", "risks"]`——按你指定的段落输出条目列表 |
| 评分 / 打标 / 抽取    | `scores: ["severity", "urgency"]`——按维度给出分数、理由和引用           |
| 输出语言跟着你走        | `lang: "zh"` 时英文原文会被翻译成中文，专有名词原样保留                         |
| 每条结论带引用         | `refs` 只能引用真实存在的记录 id，编造的直接剔除，前端可做成可点角标溯源                  |
| 数字不交给模型         | 数量、金额、时间由你的代码统计后传进去，模型只负责措辞                                |
| 格式错误不拖垮整体       | 坏条目丢掉、好条目保留；只有整体结构不对才报错                                    |
| 校验失败让模型自己改      | `retries: 1`——把错误信息喂回模型重试一遍                                |
| 改 prompt 后自动查退化 | 把一次真实输出录下来当基准，之后每次改动自动重跑检查                                 |

## 一个真实功能，从头到尾

CRM 的「客户动态摘要」：把一个客户最近的销售活动记录，归纳成三段结构化摘要，显示在客户详情页。这是真实跑通的第一个场景。

**1. 把业务口径写进契约**（这一步是后面所有质量的源头）

```jsonc
// profiles/customer.json
{
  "entity": "customer_activity",
  "fields": [
    { "name": "customerName", "meaning": "客户名称，按客户归组用这个", "authoritative": true },
    { "name": "customerCode", "meaning": "客户编码",
      "fallback": "列表接口不返回该字段，恒为空；归组一律用 customerName" },
    { "name": "content", "meaning": "活动内容/周报原文，可能是英文" },
    { "name": "ownerName", "meaning": "真实负责人人名，保持原文写法", "pii": true }
  ],
  "localeFacts": [
    "全局 locale 仅 zh-CN / en-US",
    "活动 content 可能是英文周报，lang=zh 时必须译成中文"
  ]
}
```

上面那两行 `fallback` 和 `localeFacts`，是真实事故的产物：接口不返回 `customerCode` 导致按客户分组恒为空、功能对用户完全不可达；周报原文是英文，把中文输出整个带偏。写进契约，模型第一次就绕开了。

**2. 声明场景**

```ts
const activitySummary = defineScene({
  task: "把该客户的全部销售活动归纳成三段：本周工作、需要的支持、下一步计划。",
  sections: ["work", "support", "plan"],
  about: customerProfile,     // 上面的契约
});
```

**3. 给数据**

```ts
const records = [
  { id: "a1", customerName: "星辰科技", ownerName: "张三",
    content: "Weekly report: submitted the RFP for the Orion project; bid review on Friday." },
  { id: "a2", customerName: "星辰科技", ownerName: "张三",
    content: "与客户平台部完成第二轮技术交流，客户关注交付周期与售后响应。" },
  { id: "a3", customerName: "星辰科技", ownerName: "李四",
    content: "客户预算已在 Q4 立项，等待采购流程启动。" },
];

const result = await runScene(activitySummary, {
  model: openai({ model: "deepseek-chat", baseURL: "...", apiKey: "..." }),
  records,
  lang: "zh",
  stats: computeStats,     // 活动条数、类型分布：程序算好传进去，模型不复述
  retries: 1,
});
```

**4. 拿到什么**

```ts
result.work;
// [
//   { text: "星辰科技的 Orion 项目已提交 RFP，周五进行投标评审。", refs: ["a1"] },
//   { text: "与客户平台部完成第二轮技术交流，聚焦交付周期。", refs: ["a2"] },
// ]
result.support;
// [{ text: "张三负责本周客户跟进。", refs: ["a1", "a2"] }]
result.plan;
// [{ text: "等待采购流程启动后推进商务环节。", refs: ["a3"] }]
```

三条中文、专有名词 `RFP`/`Orion` 原样保留、每条都能点回原始记录、英文周报被正确翻译。

**代价是多少**：第一个场景约 1.5 天（含摸清这些业务口径），之后每个新场景约 0.5 天——省下来的是重复的"改 prompt → 刷新页面 → 肉眼看输出"，以及每次都要重新确认一遍"模型有没有编东西"。

## 接任意模型

唯一约定：模型就是一个函数 `({ system, prompt }) => Promise<string>`。

```ts
// OpenAI 兼容（OpenAI / DeepSeek / Moonshot / Ollama / vLLM）——内置
const model = openai({ model: "deepseek-chat", baseURL: "...", apiKey: "..." });

// Anthropic——两行包装你现有的 client
const model2 = async ({ system, prompt }) => {
  const r = await anthropic.messages.create({
    model: "claude-sonnet-4-5", max_tokens: 1024, system,
    messages: [{ role: "user", content: prompt }],
  });
  return r.content[0].text;
};

// 你自己的后端
const model3 = ({ system, prompt }) =>
  fetch("/api/ai-chat", { method: "POST", body: JSON.stringify({ system, prompt }) })
    .then((r) => r.json()).then((r) => r.content);
```

**为什么只内置 openai()？** "OpenAI 兼容格式"是行业事实标准，一份实现覆盖 OpenAI、DeepSeek、Moonshot、Ollama、vLLM 等几十家；Anthropic 是单独一家。两种接法都只要两行，内置更多只会让模型矩阵变成维护负担——那是 ai-sdk 的地盘。

## 改 prompt 后怎么保证不退化

把一次真实输出**录下来**当基准，之后每次改动自动重跑并检查，不调用真实模型、零 token 成本、几秒出结果，直接进 CI：

```ts
import { evaluate, lang, refs, covers } from "ai-kit/eval";

const report = await evaluate(activitySummary, [
  {
    name: "中文模式输出中文 + 引用合法 + 要点覆盖",
    records: realTickets,
    mock: savedModelOutput,          // 当时录下的那次输出
    assert: [lang("zh"), refs(allIds), covers(["RFP"])],
  },
]);
```

## Development

```bash
pnpm install
pnpm test       # 41 个测试，含 5 条质量基准用例
pnpm build      # tsdown: esm + cjs + d.ts
pnpm typecheck
```

无运行时依赖。Node >= 18，浏览器可用。

## License

[MIT](./LICENSE)
