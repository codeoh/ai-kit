# ai-kit 完整指南

> 语言：[English](./guide.md) | [简体中文](./guide.zh-CN.md)

完整的接入 walkthrough。公共 API 一共 4 个函数：

| 导出 | 用途 |
|---|---|
| `defineScene({...})` | 声明一次：AI 做什么、输出什么形状、可选契约 |
| `runScene(scene, { model, records, lang, retries? })` | 调用：数据进，校验过的结果出 |
| `openai({ model, baseURL?, apiKey? })` | 内置模型帮助函数，任意 OpenAI 兼容端点 |
| `evaluate(scene, cases)` | 质量回归测试：录一次真实输出当基准（来自 `ai-kit/eval`） |

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

`runScene` 内部做的事：

- **Prompt 组装**——角色 + 任务 + 7 条硬规则 + 你的字段说明 + 记录数据
- **结构化输出**——输出形状从你的声明自动推导，端点支持时发JSON schema过去，不支持会自动降级（见下）
- **refs 白名单**——不在输入里的 id 被剔除，剔除的个数记在 `droppedRefs`上，你能区分「没有出处」和「编造出处」
- **软失败**——坏条目剔除、好条目保留；只有结构错误才整体抛出
- **自校验重试**——`retries > 0` 时，校验错误喂回模型修正重试

### 第 4 步之二：你的端点支持到哪一档

输出形状在端点允许的范围内被强制，不允许的地方绕过去。三档，按顺序尝试一次，之后记住：

| 档位 | 发什么 | 你能保证什么 |
|---|---|---|
| 1 | `json_schema` + `strict` | 形状和类型由模型自己保证。只有这一档才可能彻底不出现结构错误 |
| 2 | `json_object` | 输出是合法 JSON。字段名和类型仍然靠提示词约束 |
| 3 | 不发额外字段 | 输出形状完全靠提示词 |

DeepSeek 在第 2 档（不支持 `json_schema`），OpenAI 在第 1 档。你不用选——第一次调用时探测一次，之后直接走已知可用那档。

注意第 2、3 档仍然需要解析层，所以形状不对依然可能抛 `SceneStructureError`。这是预期的，`retries` 就是为这种情况准备的。

如果你的网关会拦截不认识的请求字段，可以整条链关掉：

```ts
openai({ model: "gpt-4o-mini", structured: false })   // 永远不发 response_format
```

### 第 4 步之三：中途取消

传 `signal`，请求会真的停——内置 `openai()` 把它透传给 `fetch`。不会返回半截结果，调用直接 reject。

```ts
const ctrl = new AbortController();
button.onclick = () => ctrl.abort();

await runScene(ticketSummary, { model, records, signal: ctrl.signal });
```

被取消的调用不会重试，哪怕设了 `retries`——取消是你的决定，不是一次需要恢复的失败。

### 第 5 步：用基准用例锁住质量

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

## 那 7 条硬规则

注入每个 system prompt，按 `lang` 给中文或英文版本。消费方只能通过 `extraRules` 增量添加，不能关闭。

七条里**只有第 4 条在代码层被强制**：refs 白名单。其余六条活在提示词里，而提示词不是保证——模型照样可能违反。如果这件事对你的场景要紧，自己校验，或者干脆在代码里算。

1. 输出语言 = `lang`，与输入原文语言无关（含明确的翻译要求）
2. 专有名词（人名、产品名、单号、数字）逐字保留
3. 统计数字不由模型计算——只能引用你的 `stats` 函数算出来的
4. `refs` 只能引用输入记录 id ← **只有这条在代码里强制**
5. 无内容输出空数组
6. 只输出一个紧凑 JSON 对象
7. 每条一句话，不带序号

## 评分为什么会出现 `null`

`score` 的类型是 `number | null`。`null` 表示模型没给出可用的数字（缺失、类型错、NaN），真实的 `0` 仍然是 `0`。

这个区分要紧：0-5 的严重度里，`0` 是个真实答案，把类型错误悄悄变成 `0`，看起来像一个自信的低分，其实模型什么都没说。

```ts
if (result.severity.score === null) {
  // 模型没回答这个维度
}
```

## 与 MCP 的关系

共享资产只有一份：语义契约。`ai-kit` 把契约注入 prompt；MCP Server 可以把同一份文件挂成 resource、把场景声明挂成 tool。纪律：**契约永远是独立数据文件，不许和组件代码焊死。**

## 版本策略

- `about` 契约格式或输出形状变更 → **major**
- 新增断言助手 / guards → **minor**
- prompt 措辞变更 → **patch**，且发版前必须跑过基准用例
