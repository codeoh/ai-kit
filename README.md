# ai-kit

"业务数据 → LLM → 结构化输出"类 AI 场景的前端运行时。按《业务系统与 AI 能力结合方案（sdmc-crm 实践版）》总纲的 P0 范围实现：**契约 + 场景运行时 + eval**，MCP 出口留到 P2。

## 五个决定（消费方接入全景）

> 评审口径：任何需要读源码或问人才能做出的决定，都是设计缺陷。

| # | 你要决定的事 | 包内对应入口 |
|---|---|---|
| 1 | 怎么连模型？ | `createApiTransport(send)` —— 给一个映射到自家后端代理的函数；key 永不进前端 |
| 2 | 结果存哪里？ | `createMemoryStore()`（默认/测试）或 `createLocalStorageStore(prefix?)`（浏览器持久化） |
| 3 | AI 做什么、输出什么结构？ | `defineAiScene({ id, output, prompt })` —— ~40 行声明 |
| 4 | 业务字段什么含义、缺失怎么回退？ | `DataProfile` 档案文件（你仓库里维护，如 `profiles/<entity>.json`） |
| 5 | 输出质量怎么保证？ | 七条不变量自动强制（不可关）+ golden eval（`runCases`，零 token） |

五个决定做完，接入即完成。下面是完整 walkthrough。

## 定位

- **单包单入口**，零运行时依赖，零框架（Vue/React 无关），零业务概念
- 跑在浏览器内被业务前端 import；模型调用走后端包装接口，**包永不持有 key**
- 覆盖"单步、结构化输出、强校验"场景（归纳 / 评分）；对话流、多步 agent **不在范围内**

## M1' 完成范围（2026-10-01）

| 模块 | 内容 |
|---|---|
| `src/scene.ts` | `defineAiScene` 场景声明 + `createSceneController`（缓存优先/防抖合并/单在途作废/失败不写缓存/空输入短路）+ `runSceneOnce` 纯路径 |
| `src/guards.ts` | refs 白名单、软失败（剔单条保其余）、截断、条数封顶、结构错误整体抛 |
| `src/prompt.ts` | 七条强制不变量注入 + 语义档案注入 + 程序统计块（数字不经 LLM） |
| `src/parse.ts` | JSON 抽取（容忍围栏/闲话）+ sections/dimensions 两类输出契约解析 |
| `src/transport.ts` | `createApiTransport`（包装接口）+ `createMockTransport`（eval 离线回放，概念继承自 airun） |
| `src/store.ts` | memory / localStorage 两种缓存后端 + 统一信封 `{v, expireAt, data}` |
| `src/cacheKey.ts` | 缓存键 = 登录人\|范围\|内容哈希\|语言\|schemaVersion |
| `src/profile.ts` | DataProfile 语义档案 + 校验器 + prompt 注入器 |
| `src/eval/` | golden case runner + 断言助手（零 token 离线层） |
| `profiles/activity.json` | 第一份语义契约（数据语义 + 使用语义：回退口径/locale 事实/已知缺陷） |
| `evals/activity.golden.test.ts` | 5 条 golden case = M1' 验收门禁 |

## 验收结果

- `pnpm test`：**38/38 全绿**（含 5 条 golden case）
- `pnpm typecheck`：TS strict 0 错误

## 消费方接入（完整 walkthrough，~30 分钟）

**第 0 步：包怎么进你的项目。** 当前为 workspace 源码直供（vite 直接编译 TS），三种方式任选：把 `ai-kit/` 放进你的 pnpm workspace 并 `"ai-kit": "workspace:*"`；或直接拷贝 `src/` 目录；发布私有 registry 后改 `npm install`。

**第 1 步：写语义档案（决定 4）。** 新建 `profiles/customer.json`，回答"AI 要理解什么"：

```json
{
  "entity": "customer",
  "fields": [
    { "name": "customerName", "meaning": "客户名称，归组权威字段", "authoritative": true },
    { "name": "customerCode", "meaning": "客户编码",
      "fallback": "列表接口不返回该字段，归组一律用 customerName" },
    { "name": "contactList", "meaning": "联系人", "pii": true }
  ],
  "localeFacts": ["全局 locale 仅 zh-CN / en-US"]
}
```

**第 2 步：声明场景（决定 3）。** 一个新 AI 场景 = 一份声明：

```ts
import { defineAiScene, validateDataProfile, type DataProfile } from "ai-kit";
import customerProfileJson from "../profiles/customer.json";

const customerProfile: DataProfile = validateDataProfile(customerProfileJson);

export const customerDynamics = defineAiScene({
  id: "customer_dynamics",                      // 小写下划线
  output: { kind: "sections", sections: ["work", "support", "plan"] },
  prompt: { role: "你是销售团队周报助手。", task: "按三段归纳该客户的全部活动记录。" },
  profile: customerProfile,
  cache: { ttlMs: 7 * 864e5, schemaVersion: 1 },
});
```

**第 3 步：接控制器（决定 1/2）并渲染。**

```ts
import { createApiTransport, createLocalStorageStore, createSceneController } from "ai-kit";

const ctrl = createSceneController({
  scene: customerDynamics,
  transport: createApiTransport(async (req) => {
    // 映射到自家后端代理：鉴权/模型 key/审计全在服务端
    const r = await fetch("/api/ai-chat", { method: "POST", body: JSON.stringify(req) })
      .then((x) => x.json());
    return { content: r.content, truncated: r.truncated };
  }),
  store: createLocalStorageStore("myapp:"),
  identity: () => userStore.loginName,            // 只进缓存键，不进 prompt
  scope: () => customerName,                      // 范围名，进缓存键
  lang: () => (locale === "en-US" ? "en" : "zh"), // 归一化是消费方责任，包不做猜测
  records: () => normalizeRows(timelineList),     // 输入快照；空数组自动短路为 empty
  stats: computeStats,                            // 数字一律程序统计，防编造
});

ctrl.subscribe((s) => {
  // s.status: idle | empty | pending | ok | error；ok 时 s.result = { work: [{text, refs}] }
  if (s.status === "ok") render(s.result);        // refs 渲染成可点角标 → 逐条溯源
});
ctrl.refresh();                                   // force=true 绕过缓存强制重算
```

**第 4 步：给场景上质量门禁（决定 5）。** 新建 `evals/customerDynamics.golden.test.ts`，5 条左右真实数据快照 + 断言：

```ts
import { runCases, assertLangIs, assertRefsSubset, assertCovers } from "ai-kit/eval";

const report = await runCases([
  {
    name: "中文模式输出中文 + 引用合法",
    lang: "zh",
    input: { records: snapshot },                 // 真实数据快照
    mockOutput: mockModelJson,                    // 回放模型输出，零 token
    asserts: [assertLangIs("zh"), assertRefsSubset(ids), assertCovers(["投标"])],
  },
  // ...软失败 / 结构错误 / 编造 id 被剔除等 case，参考 evals/activity.golden.test.ts
], { scene: customerDynamics });
expect(report.passed).toBe(report.total);         // 全绿才算接入完成
```

之后改提示词、换模型，跑 `pnpm test` 秒级回归——这就是把"改提示词→刷新页面→肉眼看过"的分钟级循环压到秒级的开关。

## 与 MCP 的关系

共享资产只有一份：语义契约。ai-kit 读契约拼 prompt；将来 MCP Server 把同一份契约挂成 resources、场景声明挂成 tools。纪律：**契约永远是独立数据文件，不许和组件逻辑焊死**。

## 后续（P1/P2）

- P1：契约补 customer/lead/opportunity；CI 加"契约字段 vs 后端 DTO"diff 防腐烂；接第一个真实新场景，验收 ≤0.5 天 / ≤100 行
- P2：MCP Server（鉴权/权限裁剪/draft+confirm/审计，经验回收自 airun M1）；airun 已归档（tag archive-m1），不迁移代码
