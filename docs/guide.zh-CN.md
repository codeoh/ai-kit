# ai-kit 完整指南

> 语言：[English](./guide.md) | [简体中文](./guide.zh-CN.md)

这是完整的接入 walkthrough。消费方要做的事总共就是五个决定：

> 评审口径：任何需要读源码或问人才能做出的决定，都是设计缺陷。

| # | 你要决定的事 | 包内对应入口 |
|---|---|---|
| 1 | 怎么连模型？ | 三选一：`createOpenAiCompatibleTransport({ baseUrl, headers })` 直连任意 OpenAI 兼容端点（OpenAI / DeepSeek / Moonshot / Ollama / vLLM…）；`createApiTransport(send)` 走你的后端代理；或自己实现 `AiTransport`。包永不存储 key——key 放哪由你决定 |
| 2 | 结果存哪里？ | `createMemoryStore()`（默认/测试）或 `createLocalStorageStore(prefix?)`（浏览器持久化） |
| 3 | AI 做什么、返回什么？ | `defineAiScene({ id, output, prompt })` —— 约 40 行 |
| 4 | 你的字段什么含义？ | `DataProfile` 档案文件，放在**你自己的**仓库（`profiles/<entity>.json`） |
| 5 | 质量怎么保证？ | 七条强制不变量（不可关）+ `runCases` golden eval（零 token） |

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
    { "name": "id", "meaning": "工单唯一 id，refs 的唯一合法取值", "authoritative": true },
    { "name": "title", "meaning": "工单标题" },
    { "name": "body", "meaning": "工单正文，可能是英文" },
    { "name": "status", "meaning": "工单状态", "dict": "open | pending | closed" },
    { "name": "team", "meaning": "所属团队名，归组键", "authoritative": true },
    { "name": "assignee", "meaning": "负责人人名，专有名词保护对象", "authoritative": true, "pii": true },
    { "name": "slaHours", "meaning": "解决 SLA 小时数", "fallback": "列表接口不返回该字段，由客户端从 createdAt/resolvedAt 计算，禁止让模型猜数字" }
  ],
  "unavailable": ["跨系统客户身份关联"],
  "localeFacts": ["工单正文可能是英文，lang=zh 时必须译成中文"]
}
```

每种标注买到什么：

- `meaning` —— 注入该实体的每个 system prompt
- `authoritative` —— 标记 AI 归组/归因时应信任的字段
- `fallback` —— 告诉 AI（和你的归组代码）字段缺失时怎么办
- `pii` —— 预留：prompt 离开客户端前的脱敏策略
- `unavailable` —— 还不存在的能力，AI 永远不会拿它归因
- `localeFacts` —— AI 自己发现不了的环境事实

### 第 2 步：声明场景

一个 AI 功能 = 一份声明：

```ts
import { defineAiScene, validateDataProfile, type DataProfile } from "ai-kit";
import ticketProfileJson from "../profiles/ticket.json";

const ticketProfile: DataProfile = validateDataProfile(ticketProfileJson);

export const ticketSummary = defineAiScene({
  id: "ticket_summary",                          // 小写下划线
  output: { kind: "sections", sections: ["summary", "actions", "risks"] },
  prompt: { role: "你是支持团队助手。", task: "归纳给定的工单。" },
  profile: ticketProfile,
  cache: { ttlMs: 7 * 864e5, schemaVersion: 1 },
});
```

两种内置输出契约覆盖大多数单步场景：

- `sections` —— 分组列表：`Record<key, { text: string; refs: string[] }[]>`
- `dimensions` —— 评分：`Record<key, { score: number; reason: string; refs: string[] }>`

多轮对话**设计上不在范围内**。

### 第 3 步：接控制器并渲染

```ts
import { createApiTransport, createLocalStorageStore, createSceneController } from "ai-kit";

const ctrl = createSceneController({
  scene: ticketSummary,
  // 方式 A：直连——一行搞定，任意 OpenAI 兼容端点：
  // transport: createOpenAiCompatibleTransport({ baseUrl: "https://api.deepseek.com/v1", headers: { authorization: `Bearer ${key}` } })
  // 方式 B：走后端代理（多用户生产环境推荐，key 留在服务端）：
  transport: createApiTransport(async (req) => {
    const r = await fetch("/api/ai-chat", { method: "POST", body: JSON.stringify(req) }).then((x) => x.json());
    return { content: r.content, truncated: r.truncated };
  }),
  store: createLocalStorageStore("myapp:"),
  identity: () => user.id,                       // 只进缓存键，不进 prompt
  scope: () => teamName,                         // 只进缓存键
  lang: () => (locale === "zh-CN" ? "zh" : "en"), // 归一化是你的责任，包不做猜测
  records: () => normalizeRows(tickets),         // 空数组自动短路为 empty
  stats: computeStats,                           // 数字一律程序统计，禁止模型产出
});

ctrl.subscribe((state) => {
  // state.status: idle | empty | pending | ok | error
  if (state.status === "ok") render(state.result); // refs 渲染成可点角标溯源
});
ctrl.refresh();                                  // refresh(true) 绕过缓存强制重算
```

控制器白送的行为：

- **缓存优先**——键 = 身份 | 范围 | 内容哈希 | 语言 | schemaVersion；TTL 由场景声明
- **防抖合并**——密集的 refresh 合并成一次生成（默认 1500ms）
- **单在途**——过期生成直接作废，绝不覆盖新结果
- **失败不写缓存**——失败结果下次触发自动重试
- **软失败**——坏条目剔除、好条目保留；只有结构错误才整体报错

> 安全提示：直连方式会把 API key 暴露在客户端——本地工具、内网应用、原型没问题；多用户生产环境请改走后端代理。

### 第 4 步：上 golden eval 质量门禁

新建 `evals/ticketSummary.golden.test.ts`——真实数据快照 + 回放模型输出 + 断言：

```ts
import { runCases, assertLangIs, assertRefsSubset, assertCovers } from "ai-kit/eval";

const report = await runCases([
  {
    name: "中文模式输出中文 + 引用合法",
    lang: "zh",
    input: { records: snapshot },                 // 真实数据快照
    mockOutput: mockModelJson,                    // 回放模型输出，零 token
    asserts: [assertLangIs("zh"), assertRefsSubset(ids), assertCovers(["回滚"])],
  },
  // 软失败 / 结构错误 / 编造 id 等用例，见 evals/ticket.golden.test.ts
], { scene: ticketSummary });

expect(report.passed).toBe(report.total);         // 全绿 = 接入完成
```

内置断言助手：`assertLangIs`、`assertNounsVerbatim`、`assertRefsSubset`、`assertCovers`、`assertNoError`。从此改提示词、换模型，都是秒级回归。

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

- `DataProfile` 格式或输出契约变更 → **major**
- 新增 guards / 断言助手 → **minor**
- prompt 措辞变更 → **patch**，且发版前必须过 golden 门禁
