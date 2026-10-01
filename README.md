# ai-kit

"业务数据 → LLM → 结构化输出"类 AI 场景的前端运行时。按《业务系统与 AI 能力结合方案（sdmc-crm 实践版）》总纲的 P0 范围实现：**契约 + 场景运行时 + eval**，MCP 出口留到 P2。

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

## 消费方接入（目标形态）

```ts
import { createApiTransport, createLocalStorageStore, createSceneController } from "ai-kit";

const ctrl = createSceneController({
  scene: customerDynamics,          // 场景声明：output + prompt + profile + cache
  transport: createApiTransport(sendToBackendProxy),
  store: createLocalStorageStore(),
  identity: () => userStore.loginName,
  scope: () => customerName,
  lang: () => (locale === "en-US" ? "en" : "zh"),
  records: () => normalizeRows(timelineList),
  stats: programComputeStats,       // 数字一律程序统计
});
ctrl.subscribe(render);             // 消费方自写渲染（Vue 组件留在业务仓库）
ctrl.refresh();
```

## 与 MCP 的关系

共享资产只有一份：语义契约。ai-kit 读契约拼 prompt；将来 MCP Server 把同一份契约挂成 resources、场景声明挂成 tools。纪律：**契约永远是独立数据文件，不许和组件逻辑焊死**。

## 后续（P1/P2）

- P1：契约补 customer/lead/opportunity；CI 加"契约字段 vs 后端 DTO"diff 防腐烂；接第一个真实新场景，验收 ≤0.5 天 / ≤100 行
- P2：MCP Server（鉴权/权限裁剪/draft+confirm/审计，经验回收自 airun M1）；airun 已归档（tag archive-m1），不迁移代码
