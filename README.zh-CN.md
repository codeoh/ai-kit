<div align="center">

# ai-kit

**把 AI 以“类型化函数”的方式嵌进你的产品，而不是聊天。**

[![npm version](https://img.shields.io/npm/v/ai-kit.svg)](https://www.npmjs.com/package/ai-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

[English](./README.md) | [简体中文](./README.zh-CN.md)

</div>

ai-kit 是一个零依赖、框架无关的 TypeScript 运行时，服务一类**不是聊天机器人**的 AI 功能——摘要、评分、推荐、抽取：单步调用、结构化输出。

你只描述 *AI 要做什么* 和 *你的数据是什么意思*，管线剩下的部分全由包托管：prompt 组装、模型调用、防幻觉校验、缓存、回归测试。

## 一分钟看懂

```ts
import { defineAiScene, createOpenAiCompatibleTransport, createSceneController } from "ai-kit";

// 1. 声明 AI 要做什么
const scene = defineAiScene({
  id: "ticket_summary",
  output: { kind: "sections", sections: ["summary", "actions", "risks"] },
  prompt: { role: "你是支持团队助手。", task: "归纳给定的工单。" },
});

// 2. 接上模型、缓存、身份、语言
const ctrl = createSceneController({
  scene,
  transport: createOpenAiCompatibleTransport({
    baseUrl: "https://api.deepseek.com/v1",
    headers: { authorization: `Bearer ${KEY}` },
  }),
  store: createMemoryStore(),
  identity: () => user.id,   // 只进缓存键，不进 prompt
  scope: () => teamName,
  lang: () => "zh",
  records: () => tickets,
});

// 3. 渲染——强类型、带引用溯源的输出
ctrl.subscribe((state) => {
  if (state.status === "ok") render(state.result);
});
ctrl.refresh();
```

输出里的每个论断都带 `refs` 指回输入记录；数字由你的代码计算，模型只负责措辞；坏条目被剔除，好条目照常展示。

## 为什么是 ai-kit？

- **语义契约**——字段含义、缺失回退、locale 事实注入 prompt，让 AI 真正理解你的数据，而不是靠猜
- **七条强制不变量**——在 prompt 和解析两层强制执行的防幻觉 guards；消费方只能加规则，不能删
- **Golden eval**——零 token 的回放式质量门禁；改提示词、换模型都是秒级回归，不用刷新页面碰运气
- **管道内置**——按身份+范围+内容+语言做键的缓存、防抖、单在途、软失败：每个 AI 功能都要重写一遍的代码，这里只写一次

## 快速开始

```bash
npm install ai-kit
```

1. **描述你的数据**——写一份 `DataProfile` 文件：字段含义、回退口径、PII
2. **声明场景**——`defineAiScene({ id, output, prompt, profile })`，约 40 行
3. **接上控制器**——`createSceneController({ scene, transport, store, ... })`，任意框架渲染
4. **上质量门禁**——用 `runCases` 加 golden case，跑进 CI

完整图文步骤：**[完整指南](./docs/guide.zh-CN.md)**

## 连接任意模型

任何 OpenAI 兼容端点开箱即用——OpenAI、DeepSeek、Moonshot、Ollama、vLLM：

```ts
createOpenAiCompatibleTransport({ baseUrl: "https://api.deepseek.com/v1", headers: { authorization: `Bearer ${key}` } })
```

希望 key 留在自己服务器？用 `createApiTransport(send)` 走你的后端代理，或者自己实现只有一个方法的 `AiTransport` 接口。

## 文档

- [完整指南（中文）](./docs/guide.zh-CN.md) · [Full guide (English)](./docs/guide.md)
- [七条强制不变量](./docs/guide.zh-CN.md#七条强制不变量)

## 开发

```bash
pnpm install
pnpm test       # 44 个测试，含 5 条 golden 门禁
pnpm build      # tsdown: esm + cjs + d.ts
pnpm typecheck
```

## 许可

[MIT](./LICENSE)
