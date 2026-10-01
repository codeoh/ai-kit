# ai-kit 完整指南

> 语言：[English](./guide.md) | [简体中文](./guide.zh-CN.md)

完整的接入 walkthrough。公共 API 一共 4 个函数：

| 导出 | 用途 |
|---|---|
| `defineScene({...})` | 声明一次：AI 做什么、输出什么形状、可选契约 |
| `runScene(scene, { model, records, lang, retries? })` | 调用：数据进，校验过的结果出 |
| `openai({ model, baseURL?, apiKey? })` | 内置模型帮助函数，任意 OpenAI 兼容端点 |
| `evaluate(scene, cases)` | golden case 质量门禁（来自 `ai-kit/eval`） |

模型本身是唯一约定：一个函数 `({ system, prompt }) => Promise<string>`。任何 SDK 两行适配。

## 接入步骤（约 30 分钟）

### 第 0 步：安装

```bash
npm install ai-kit
```

Node >= 18；浏览器与 Node 均可运行；含 TypeScript 类型。

### 第 1 步：声明语义契约

新建 `profiles/ticket.json`——这是在教 AI 理解你的数据：

```json
{
  "entity": "ticket",
  "fields": [
    { "name": "id", "meaning": "工单唯一 id，refs 的唯一合法取值" },
    { "name": "title", "meaning": "工单标题" },
    { "name": "body", "meaning": "工单正文，可能是英文" },
    { "name": "status", "meaning": "工单状态", "dict": "open | pending | closed" },
    { "name": "team", "meaning": "所属团队名，归组键" },
    { "name": "assignee", "meaning": "负责人人名，专有名词保护对象", "pii": true },
    { "name": "slaHours", "meaning": "解决 SLA 小时数", "fallback": "列表接口不返回该字段，由客户端从 createdAt/resolvedAt 计算，禁止让模型猜数字" }
  ],
  "unavailable": ["跨系统客户身份关联"],
  "localeFacts": ["工单正文可能是英文，lang=zh 时必须译成中文"]
}
```

每种标注买到什么：

- `meaning` —— 注入该场景的每个 system prompt
- `fallback` —— 告诉 AI 字段缺失时怎么办
- `pii` —— 预留：prompt 离开你的代码前的脱敏策略
- `unavailable` —— 还不存在的能力，AI 永远不会拿它归因
- `localeFacts` —— AI 自己发现不了的环境事实

### 第 2 步：声明场景

一个 AI 功能 = 一份声明：

```ts
import { defineScene, validateDataProfile, type DataProfile } from "ai-kit";
import ticketProfileJson from "../profiles/ticket.json";

const ticketProfile: DataProfile = validateDataProfile(ticketProfileJson);

export const ticketSummary = defineScene({
  id: "ticket_summary",
  task: "归纳这些支持工单。",
  sections: ["summary", "actions", "risks"],
  about: ticketProfile,
});
```

两种输出形状覆盖大多数单步场景：

- `sections: ["summary", "actions", "risks"]` → `Record<key, { text: string; refs: string[] }[]>`
- `scores: ["severity", "urgency"]` → `Record<key, { score: number; reason: string; refs: string[] }>`

多轮对话**设计上不在范围内**。

### 第 3 步：选择模型

OpenAI 兼容端点（OpenAI、DeepSeek、Moonshot、Ollama、vLLM）开箱即用：

```ts
import { openai } from "ai-kit";

const model = openai({
  model: "deepseek-chat",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.API_KEY,
});
```

其他任何 SDK——两行包装你自己的 client：

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

// Vercel ai SDK：
import { generateText } from "ai";
const model2 = ({ system, prompt }) =>
  generateText({ model: "openai/gpt-5.2", system, prompt }).then((r) => r.text);

// 你自己的后端：
const model3 = ({ system, prompt }) =>
  fetch("/api/ai-chat", { method: "POST", body: JSON.stringify({ system, prompt }) })
    .then((r) => r.json())
    .then((r) => r.content);
```

> 安全提示：在浏览器里直连会把 API key 暴露在客户端——本地工具、内网应用、原型没问题；多用户生产环境请路由到自己的后端。

### 第 4 步：调用

```ts
import { runScene } from "ai-kit";

const result = await runScene(ticketSummary, {
  model,
  records: tickets,                 // 每条记录需要 id 供 refs 引用
  lang: "zh",                       // 默认 "en"
  stats: computeStats,              // 数字由代码计算，模型只管措辞
  retries: 1,                       // 校验失败 → 错误喂回模型重试一次
});
```

`runScene` 内部白送的东西：

- **Prompt 组装**——角色 + 任务 + 七条强制不变量 + 你的契约 + 记录数据
- **refs 白名单**——编造的引用 id 对照输入 id 集被剔除
- **软失败**——坏条目剔除、好条目保留；只有结构错误才整体抛出
- **自校验重试**——`retries > 0` 时，校验错误喂回模型修正重试

### 第 5 步：上 golden 门禁

```ts
import { evaluate, lang, refs, covers } from "ai-kit/eval";

const report = await evaluate(ticketSummary, [
  {
    name: "中文模式输出中文 + 引用合法",
    lang: "zh",
    records: snapshot,                // 真实数据快照
    mock: mockModelJson,              // 回放模型输出，零 token
    assert: [lang("zh"), refs(ids), covers(["回滚"])],
  },
  // 软失败 / 结构错误 / 编造 id 等用例，见 evals/ticket.golden.test.ts
]);
```

跑进 CI（`pnpm test`）。从此改提示词、换模型，都是秒级回归。

内置断言助手：`lang`、`nouns`、`refs`、`covers`、`noError`。

## 七条强制不变量

注入每个 system prompt，并在解析层再次强制；消费方只能通过 `extraRules` 增量添加，不能关闭：

1. 输出语言 = `lang`，与输入原文语言无关（含明确的翻译要求）
2. 专有名词（人名、产品名、单号、数字）逐字保留
3. 统计数字绝不由模型产出——只能引用程序统计结果
4. `refs` 只能引用输入记录 id（白名单强制，编造 id 剔除）
5. 无内容输出空数组，禁止编造
6. 只输出一个紧凑 JSON 对象
7. 每条一句话，不带序号

## 与 MCP 的关系

共享资产只有一份：语义契约。`ai-kit` 把契约注入 prompt；MCP Server 可以把同一份文件挂成 resource、把场景声明挂成 tool。纪律：**契约永远是独立数据文件，不许和组件代码焊死。**

## 版本策略

- `about` 契约格式或输出形状变更 → **major**
- 新增断言助手 / guards → **minor**
- prompt 措辞变更 → **patch**，且发版前必须过 golden 门禁
