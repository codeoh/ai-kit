# ai-kit

**把 AI 以"类型化函数"的方式嵌进你的产品，而不是聊天。**

`ai-kit` 是一个零依赖、框架无关的 TypeScript 运行时，服务一类**不是聊天机器人**的 AI 功能：单步、结构化输出、强校验的调用——摘要、评分、推荐、抽取。你声明三样东西：**场景**（AI 做什么）、**语义契约**（你的数据是什么意思）、**golden eval**（质量怎么门禁），包负责整条管线：prompt 组装、模型调用、防幻觉 guards、缓存、软失败、回归测试。

[English](./README.md)

## 为什么不直接调 LLM SDK？

因为每个嵌入式 AI 功能都在重复交同样的四笔税：

| 税 | 表现 | ai-kit 的答案 |
|---|---|---|
| 契约发现 | 接口不返回归组字段；locale 码静默失效 | **语义契约**（DataProfile）：回退规则 + 环境事实，注入 prompt |
| Prompt 调试循环 | 改提示词 → 刷新页面 → 肉眼看输出，每轮几分钟 | **Golden eval**：回放式断言，每轮几秒，零 token |
| 幻觉 | 编造数字、编造引用 | **七条强制不变量**：程序统计、refs 白名单、专有名词逐字保留、软失败… |
| 管道重写 | 每个功能重写缓存/防抖/abort/重试 | **场景控制器**：缓存优先、防抖合并、单在途、失败不写缓存 |

## 五个决定（接入的全部）

> 评审口径：任何消费方需要读源码或问人才能做出的决定，都是设计缺陷。

| # | 你要决定的事 | 包内对应入口 |
|---|---|---|
| 1 | 怎么连模型？ | `createApiTransport(send)` —— 映射到你的后端代理；**包永不持有 API key** |
| 2 | 结果存哪里？ | `createMemoryStore()` 或 `createLocalStorageStore(prefix?)` |
| 3 | AI 做什么、返回什么？ | `defineAiScene({ id, output, prompt })` —— ~40 行声明 |
| 4 | 你的字段什么含义？ | `DataProfile` 档案文件，放在**你自己的**仓库（`profiles/<entity>.json`） |
| 5 | 质量怎么保证？ | 七条强制不变量（不可关）+ `runCases` golden eval（零 token） |

## 安装

```bash
npm install ai-kit
```

Node >= 18；浏览器与 Node 均可运行；含 TypeScript 类型。

## 快速开始

**1. 声明语义契约** —— AI 必须理解的数据语义：

```jsonc
// profiles/ticket.json
{
  "entity": "ticket",
  "fields": [
    { "name": "id", "meaning": "工单唯一 id，refs 的唯一合法取值", "authoritative": true },
    { "name": "body", "meaning": "工单正文，可能是英文" },
    { "name": "team", "meaning": "所属团队名，归组键", "authoritative": true },
    { "name": "slaHours", "meaning": "解决 SLA 小时数",
      "fallback": "列表接口不返回该字段，由客户端从时间戳计算，禁止让模型猜数字" }
  ],
  "localeFacts": ["工单正文可能是英文，lang=zh 时必须译成中文"]
}
```

**2. 声明场景** —— 一个 AI 功能 = 一份声明：

```ts
import { defineAiScene, validateDataProfile } from "ai-kit";
import ticketProfile from "./profiles/ticket.json";

export const ticketSummary = defineAiScene({
  id: "ticket_summary",
  output: { kind: "sections", sections: ["summary", "actions", "risks"] },
  prompt: { role: "你是支持团队助手。", task: "归纳给定的工单。" },
  profile: validateDataProfile(ticketProfile),
  cache: { ttlMs: 7 * 864e5, schemaVersion: 1 },
});
```

两种内置输出契约覆盖大多数单步场景：`sections`（分组 `{text, refs}[]`）与 `dimensions`（`{score, reason, refs}`）。多轮对话**设计上不在范围内**。

**3. 把控制器接进你的 UI**（任意框架，包不含 UI）：

```ts
import { createApiTransport, createLocalStorageStore, createSceneController } from "ai-kit";

const ctrl = createSceneController({
  scene: ticketSummary,
  transport: createApiTransport(async (req) => {
    // 你的后端代理：鉴权、模型 key、审计全在服务端
    const r = await fetch("/api/ai-chat", { method: "POST", body: JSON.stringify(req) }).then((x) => x.json());
    return { content: r.content, truncated: r.truncated };
  }),
  store: createLocalStorageStore("myapp:"),
  identity: () => user.id,                     // 只进缓存键，不进 prompt
  scope: () => teamName,                       // 只进缓存键
  lang: () => (locale === "zh-CN" ? "zh" : "en"), // 归一化是你的责任，包不做猜测
  records: () => tickets,                      // 空数组自动短路为 empty
  stats: computeStats,                         // 数字一律程序统计，禁止模型产出
});

ctrl.subscribe((state) => {
  // state.status: idle | empty | pending | ok | error
  if (state.status === "ok") render(state.result); // refs 渲染成可点角标溯源
});
ctrl.refresh();                                // refresh(true) 绕过缓存强制重算
```

**4. 上 golden eval 质量门禁** —— 真实数据快照 + 回放模型输出 + 断言，零 token，进 CI：

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
  // 软失败 / 结构错误 / 编造 id 等用例，见 evals/ticket.golden.test.ts
], { scene: ticketSummary });

expect(report.passed).toBe(report.total); // 全绿 = 接入完成
```

从此改提示词、换模型，都是秒级回归，而不是刷新页面碰运气。

## 七条强制不变量

注入每个 system prompt，并在解析层再次强制；消费方只能增量添加规则，不能关闭：

1. 输出语言 = `lang`，与输入原文语言无关（含明确的翻译要求）
2. 专有名词（人名、产品名、单号、数字）逐字保留
3. 统计数字绝不由模型产出——只能引用程序统计结果
4. `refs` 只能引用输入记录 id（白名单强制，编造 id 剔除）
5. 无内容输出空数组，禁止编造
6. 只输出一个紧凑 JSON 对象
7. 每条一句话，不带序号

## 与 MCP 的关系

共享资产只有一份：语义契约。`ai-kit` 把契约注入 prompt；MCP Server（你的下一阶段）把同一份文件挂成 resource、把场景声明挂成 tool。纪律：**契约永远是独立数据文件，不许和组件代码焊死。**

## 开发

```bash
pnpm install
pnpm test       # 39 个测试，含 5 条 golden 门禁
pnpm build      # tsup: esm + cjs + d.ts
pnpm typecheck
```

## 许可

[MIT](./LICENSE)
