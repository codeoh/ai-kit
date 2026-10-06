# ai-kit

[![npm version](https://img.shields.io/npm/v/ai-kit.svg)](https://www.npmjs.com/package/ai-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

[English](./README.md) | [简体中文](./README.zh-CN.md)

ai-kit 把你的业务数据变成**带引用、可校验的结构化 AI 输出**——摘要、评分、推荐、抽取。任意模型、任意你已经在用的 SDK 都能接。

你写两样东西：**AI 要做什么**（`defineScene`）和**你的字段是什么意思**（`about`）。剩下的交给 `runScene`。

## 30 秒上手

```ts
import { defineScene, openai, runScene } from "ai-kit";

// 1. AI 要做什么，输出什么样
const summary = defineScene({
  task: "归纳这些支持工单。",
  sections: ["summary", "actions", "risks"],   // 决定输出结构
});

// 2. 给数据，拿到结果
const result = await runScene(summary, {
  model: openai({ model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1", apiKey: process.env.API_KEY }),
  records: tickets,        // [{ id: "t1", title: "Billing dispute", ... }]
  lang: "zh",
});

// result = {
//   summary: [{ text: "Orion 提出重复发票 INV-88 的退款申请，周五升级通话。", refs: ["t1"] }],
//   actions: [{ text: "张三负责跟进本周工单。", refs: ["t1", "t2"] }],
//   risks:   [{ text: "staging 审批阻塞新成员接入。", refs: ["t3"] }]
// }
```

## 为什么需要它

调模型本身很简单，`openai` 或 `ai` SDK 两行就够：

```ts
const res = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [...] });
const raw = res.choices[0].message.content; // 一个字符串。然后呢？
```

麻烦的是 `raw` 之后的事：把 JSON 抠出来、确认输出语言对不对、核对模型引用的记录 id 是不是真存在、丢掉格式错误的条目、数字改成程序算好（防止模型编数）、按用户缓存……还有每次改完 prompt 把这些重新验证一遍。

ai-kit 就是这一整层。

## `runScene` 里发生了什么

1. **把提示词拼好**发给你的模型：角色 + 你写的任务 + 7 条硬规则 + 你的字段说明 + 这次的数据
2. **调用你的模型函数**
3. **检查模型输出**：把 JSON 抠出来、引用 id 对照原始数据、格式错误的条目丢掉、过长的截断
4. **返回结构化结果**；结构整体不对就报错（也可以让它自己改一遍重试）

那 7 条硬规则，每次请求都会带上，**你关不掉、也不需要关**：

| 规则 | 为什么要有 |
|---|---|
| 输出语言用你指定的（`lang`） | 英文原文把中文输出带偏，是最常见的坑 |
| 专有名词原样保留（人名、产品名、单号、数字） | `VVDN`、`RFP`、`INV-88` 被翻译改名，等于信息丢了 |
| 数字必须用你给的，不能自己算 | 模型编起数量和金额来毫无阻力 |
| 引用只能引用真实存在的记录 id | 模型会顺手编一个 id，点进去什么都没有 |
| 没内容就返回空数组 | 模型宁可编一段也不愿意说“没有” |
| 只输出 JSON | 混进一句解释就得额外处理 |
| 每条一句话，不带编号 | 渲染层不用再做清洗 |

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
```

**为什么只内置了 openai()？** 因为“OpenAI 兼容格式”是行业事实标准，一份实现覆盖 OpenAI、DeepSeek、Moonshot、Ollama、vLLM 等几十家；Anthropic 是单独一家。两种接法都只要两行，内置更多只会让模型矩阵变成我们的维护负担——那是 ai-sdk 的地盘。

## 质量回归测试（`evaluate`）

改完 prompt 或换了模型，怎么知道输出质量没退化？把一次真实输出**录下来**当基准，之后每次改动都自动重跑并检查：

```ts
import { evaluate, lang, refs, covers } from "ai-kit/eval";

const report = await evaluate(summary, [
  {
    name: "中文模式输出中文 + 引用合法",
    records: realTickets,     // 真实数据快照
    mock: savedModelOutput,   // 当时录下的模型输出
    assert: [lang("zh"), refs(allIds), covers(["回滚"])],
  },
]);
```

不调用真实模型、零 token 成本、几秒出结果，直接进 CI。这是把“改一句 prompt 要刷新页面肉眼看”变成秒级反馈的关键。

## 真实案例

我们自己的第一个场景（客户动态摘要）上线前调了 **8 轮、约 1.5 人日/轮**，一半时间花在模型看不到的坑上：

- 列表接口不返回 `customerCode`，按客户分组恒为空——**功能对用户完全不可达**，靠浏览器抓包才发现
- 全局 locale 是 `zh-CN/en-US`，代码里写 `=== "en"`，英文模式静默失效
- 周报原文是英文，中文模式下被“逐字保留”规则带偏，直接输出英文段落

换成 ai-kit 之后：

- 这些坑在第一天就写进了契约文件：`{ name: "customerCode", fallback: "该接口不返回，归组用 customerName" }`、locale 事实、专有名词保护
- 7 条硬规则自动进每次请求，编造的引用 id 被自动剔除
- 质量断言进 CI，改 prompt / 换模型后 10 秒知道有没有退化

结果是：首个场景约 1.5 天，之后每个新场景约 0.5 天——而且第二个场景开始不再重复踩上面的坑。

## 快速开始

```bash
npm install ai-kit
```

完整图文步骤：**[完整指南](./docs/guide.zh-CN.md)** · [English](./docs/guide.md)

## 开发

```bash
pnpm install
pnpm test       # 41 个测试，含 5 条质量基准用例
pnpm build      # tsdown: esm + cjs + d.ts
pnpm typecheck
```

无运行时依赖。Node >= 18，浏览器可用。

## 许可

[MIT](./LICENSE)
