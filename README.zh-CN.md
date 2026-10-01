# ai-kit

[![npm version](https://img.shields.io/npm/v/ai-kit.svg)](https://www.npmjs.com/package/ai-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

[English](./README.md) | [简体中文](./README.zh-CN.md)

ai-kit 把你的业务数据变成**经校验、带引用溯源的结构化 AI 输出**——摘要、评分、推荐、抽取——**任意模型、任意你已有的 SDK** 都能接。

你声明 **AI 要做什么**（`defineScene`）和 **你的数据是什么意思**（`about` 契约），`runScene` 负责拼 prompt、调你的模型函数、校验输出，返回类型化结果。

## 它解决什么问题

调模型是容易的部分——`openai` 和 `ai` SDK 已经做得很好：

```ts
const res = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [...] });
const raw = res.choices[0].message.content; // 一个字符串。然后呢？
```

`raw` 是个字符串。要让它**可用**，这些活都归你：解析 JSON、检查输出语言、核对引用的记录 id 是否真实存在、剔除坏条目、把数字改成程序计算以防模型编造，以及每次改完提示词把这些全部重新验证一遍。

ai-kit 就是这一整层：

```ts
import { defineScene, openai, runScene } from "ai-kit";

// 1. AI 做什么，输出什么结构
const summary = defineScene({
  task: "归纳这些支持工单。",
  sections: ["summary", "actions", "risks"],
});

// 2. 数据进，校验过的结果出
const result = await runScene(summary, {
  model: openai({ model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1", apiKey: process.env.API_KEY }),
  records: tickets, // [{ id: "t1", title: "Billing dispute", ... }]
  lang: "zh",
  retries: 1, // 校验失败会把错误喂回模型重试一次
});

// result = {
//   summary: [{ text: "Orion 提出重复发票 INV-88 的退款申请，周五升级通话。", refs: ["t1"] }],
//   actions: [{ text: "张三负责跟进本周工单。", refs: ["t1", "t2"] }],
//   risks:   [{ text: "staging 审批阻塞新成员接入。", refs: ["t3"] }]
// }
```

每条 `text` 是一句话、语言符合 `lang`；每条 `refs` 都是真实存在的输入 id——编造的剔除、坏条目移除、好条目保留。

## 任意模型，任意 SDK

唯一的约定是一个函数：`({ system, prompt }) => Promise<string>`。

- **OpenAI 兼容**（OpenAI、DeepSeek、Moonshot、Ollama、vLLM）——内置：`openai({ model, baseURL?, apiKey? })`
- **其他任何 SDK**——两行包装你自己的 client：

```ts
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic();

const model = async ({ system, prompt }) => {
  const r = await anthropic.messages.create({
    model: "claude-sonnet-4-5", max_tokens: 1024, system,
    messages: [{ role: "user", content: prompt }],
  });
  return r.content[0].text;
};
```

包永不存储 key，不封装你没要求的 HTTP，也不关心你选了哪个 SDK。

## `runScene` 内部发生了什么

1. **拼 prompt**——角色 + 任务 + 七条强制不变量 + 你的 `about` 契约（字段含义、回退口径、locale 事实）+ 记录 JSON
2. **调用你的模型函数**
3. **解析并校验**——抠出 JSON、对照输入 id 强制 refs 白名单、剔除坏条目（软失败）、超长截断
4. **返回类型化结果**——sections 或 scores；结构整体错误就抛出（或用 `retries` 把错误喂回模型重试）

七条不变量（输出语言、专有名词逐字保留、数字程序统计、refs 白名单、禁止编造、紧凑 JSON、每条一句话）注入每个 prompt，并在解析层再次强制。你可以加规则，不能删。

## 上质量门禁（真正的回报）

写 golden case——真实数据快照 + 回放模型输出 + 断言，零 token：

```ts
import { evaluate, lang, refs, covers } from "ai-kit/eval";

const report = await evaluate(summary, [
  {
    name: "中文模式输出中文 + 引用合法",
    lang: "zh",
    records: snapshot,
    mock: mockModelJson,
    assert: [lang("zh"), refs(ids), covers(["回滚"])],
  },
]);
```

跑进 CI。从此改提示词、换模型，都是秒级回归。

## 快速开始

```bash
npm install ai-kit
```

完整 walkthrough——契约、输出形状、eval、retries：**[guide.zh-CN.md](./docs/guide.zh-CN.md)** · [English](./docs/guide.md)

## 开发

```bash
pnpm install
pnpm test       # 41 个测试，含 5 条 golden 门禁
pnpm build      # tsdown: esm + cjs + d.ts
pnpm typecheck
```

无运行时依赖。Node >= 18，浏览器可用。

## 许可

[MIT](./LICENSE)
