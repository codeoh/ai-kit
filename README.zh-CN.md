# ai-kit

[![npm version](https://img.shields.io/npm/v/ai-kit.svg)](https://www.npmjs.com/package/ai-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

[English](./README.md) | [简体中文](./README.zh-CN.md)

ai-kit 把你的业务数据变成**经校验、带引用溯源的结构化 AI 输出**——摘要、评分、推荐、抽取——跑在任意 OpenAI 兼容 API 之上。

你声明 **AI 要做什么**（场景）和 **你的数据是什么意思**（语义契约），包负责拼 prompt、调模型、校验输出，返回类型化结果。

## 它解决什么问题

调模型是容易的部分——`openai` 和 `ai` SDK 已经做得很好：

```ts
const res = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [...] });
const raw = res.choices[0].message.content; // 一个字符串。然后呢？
```

`raw` 是个字符串。要让它**可用**，这些活都归你：解析 JSON、检查输出语言、核对引用的记录 id 是否真实存在、剔除坏条目、把数字改成程序计算以防模型编造、按用户做缓存，以及每次改完提示词把这些全部重新验证一遍。

ai-kit 承包了这一整层：

```ts
import { defineAiScene, createOpenAiCompatibleTransport, runScene } from "ai-kit";

// 1. AI 做什么，输出什么结构
const scene = defineAiScene({
  id: "ticket_summary",
  output: { kind: "sections", sections: ["summary", "actions", "risks"] },
  prompt: { role: "你是支持团队助手。", task: "归纳给定的工单。" },
});

// 2. 怎么连模型——任意 OpenAI 兼容端点
const transport = createOpenAiCompatibleTransport({
  baseUrl: "https://api.deepseek.com/v1",
  headers: { authorization: `Bearer ${process.env.API_KEY}` },
});

// 3. 业务数据进，结构化结果出
const result = await runScene(scene, transport, {
  lang: "zh",
  records: tickets, // [{ id: "t1", title: "Billing dispute", body: "...", ... }]
});

// result = {
//   summary: [{ text: "Orion 提出重复发票 INV-88 的退款申请，周五升级通话。", refs: ["t1"] }],
//   actions: [{ text: "张三负责跟进本周工单。", refs: ["t1", "t2"] }],
//   risks:   [{ text: "staging 权限审批阻塞新成员接入。", refs: ["t3"] }]
// }
```

每条 `text` 是一句话、语言符合 `lang`；每条 `refs` 都是真实存在的输入 id——编造的直接剔除；数字来自你的代码，不来自模型。

## `runScene` 内部发生了什么

1. **拼 prompt**——角色 + 任务 + 七条强制不变量 + 你的契约（字段含义、回退口径、locale 事实）+ 记录 JSON
2. **调 transport**——你提供的那个（直连或自己的后端）
3. **解析并校验**——抠出 JSON、对照输入 id 强制 refs 白名单、剔除坏条目（软失败）、超长文本截断
4. **返回类型化结果**——`sections` 或 `dimensions`；结构整体不对就抛错，不让垃圾流过去

七条不变量（输出语言、专有名词逐字保留、数字程序统计、refs 白名单、禁止编造、紧凑 JSON、每条一句话）注入每个 prompt，并在解析层再次强制。你可以加规则，不能删。

## 上质量门禁（真正的回报）

写 golden case——真实数据快照 + 回放模型输出 + 断言，零 token：

```ts
import { runCases, assertLangIs, assertRefsSubset, assertCovers } from "ai-kit/eval";

const report = await runCases([
  {
    name: "中文模式输出中文 + 引用合法",
    lang: "zh",
    input: { records: snapshot },
    mockOutput: mockModelJson,
    asserts: [assertLangIs("zh"), assertRefsSubset(ids), assertCovers(["回滚"])],
  },
], { scene });
```

跑进 CI。从此改提示词、换模型，都是秒级回归。

## 要做 UI？

`createSceneController` 在 `runScene` 之上加应用层：按身份+范围+内容+语言做键的缓存、防抖、单在途、失败不写缓存，外加一个可订阅的状态机（`idle | empty | pending | ok | error`）。不含框架——`state.result` 用 Vue、React 或任何东西渲染。见[完整指南](./docs/guide.zh-CN.md)。

## 快速开始

```bash
npm install ai-kit
```

完整 walkthrough——契约、控制器、eval：**[guide.zh-CN.md](./docs/guide.zh-CN.md)** · [English](./docs/guide.md)

## 开发

```bash
pnpm install
pnpm test       # 44 个测试，含 5 条 golden 门禁
pnpm build      # tsdown: esm + cjs + d.ts
pnpm typecheck
```

无运行时依赖。Node >= 18，浏览器可用。

## 许可

[MIT](./LICENSE)
