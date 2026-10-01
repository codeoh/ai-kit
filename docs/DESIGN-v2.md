# ai-kit API 设计稿 v2（重设计提案）

> 状态：**设计评审中，未动代码**。
> 背景：v1 API 被否——"又臭又长，完全不知道是干啥的"、"只能用 openai 类的"。本稿基于业界四个标杆库的 API 实测模式重新设计。

---

## 1. v1 错在哪（对照批评逐条认领）

| v1 设计 | 为什么错 |
|---|---|
| `createOpenAiCompatibleTransport` / `createApiTransport` / `AiTransport` | **发明了用户不需要的概念**。调模型这件事，openai/ai SDK/anthropic SDK 早已解决，用户手里已经有 client。我封装 HTTP 层，等于逼用户放弃熟悉的工具来学我的 |
| `createSceneController({ scene, transport, store, identity, scope, lang, records, stats, debounceMs })` | **一个工厂塞 9 个配置项**，其中 6 个是函数。第一次看根本不知道哪些必填、哪些能删 |
| `defineAiScene` / `runSceneOnce` / `runCases` 三套入口 | 名字长、动词乱、看不出关系 |
| 只支持 OpenAI 兼容端点 | 把"我公司的现状"（有后端代理）当成了通用约束 |

## 2. 四个标杆库教会我们的事（2026-10 实查）

### Vercel AI SDK —— model 是参数，不是 client

```ts
const { text } = await generateText({ model: "openai/gpt-5.2", prompt: "..." });
// 切换供应商 = 改一个字符串
const { object } = await generateObject({ model, schema: z.object({...}), prompt });
```

学到的：**一个动词一个函数**；model 是参数；结构化输出 = 函数 + schema 两件事。

### Instructor（Python）—— 接到用户已有的 client 上，只加一个参数

```python
client = instructor.from_openai(OpenAI())   # 用户自己的 client
user = client.chat.completions.create(..., response_model=User)  # 只多一个参数
```

学到的：**不替用户选连接方式**；校验失败把错误喂回模型重试（max_retries）是核心价值，不是附属品。

### zod —— 声明一次，parse 无数次

```ts
const user = z.object({ name: z.string() });
user.parse(data);
```

学到的：**小写工厂 + 单一方法**。没有 `createSchemaFactory`、没有 `SchemaParserFactory`。

### openai SDK —— 最小路径必须一眼看懂

```ts
const res = await client.chat.completions.create({ model, messages });
```

学到的：**从 import 到结果不能超过一屏**。

## 3. 设计原则（v2 的宪法）

1. **接缝是一个函数，不是一个接口**——模型调用怎么接，交给用户手里已有的 SDK
2. **声明一次，调用无数次**——zod 模式，`scene()` 工厂 + `.run()` 方法，就这两个动词
3. **数字段落 > 嵌套配置对象**——task 是字符串，sections 是字符串数组，别造 config 层级
4. **渐进披露**——最小用法 3 行；契约、eval、缓存都是可选项，不看文档也能先跑通

## 4. 新 API 全貌：核心导出只有 3 个

```ts
import { scene, openai, evaluate } from "ai-kit";
```

### 4.1 声明 + 调用（最小用法，一眼看完）

```ts
import { scene, openai } from "ai-kit";

// 声明一次：AI 做什么、输出什么
const summary = scene({
  task: "归纳这些工单，按三个部分输出",
  sections: ["summary", "actions", "risks"],   // 决定输出形状
});

// 调用无数次：给模型、给数据
const result = await summary.run({
  model: openai({ model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1", apiKey: process.env.API_KEY }),
  records: tickets,        // [{ id: "t1", title: "...", body: "...", ... }]
  lang: "zh",
});

// result = {
//   summary: [{ text: "Orion 提出重复发票 INV-88 的退款申请，周五升级通话。", refs: ["t1"] }],
//   actions: [{ text: "张三负责跟进本周工单。", refs: ["t1", "t2"] }],
//   risks:   [{ text: "staging 审批阻塞新成员接入。", refs: ["t3"] }]
// }
// —— refs 已对照输入 id 校验；数字来自你的代码；坏条目已剔除
```

对比 openai SDK 的心智成本：`client.chat.completions.create` 你已经很熟——`.run()` 一样熟，只是 `raw` 字符串换成了校验过的结构化结果。

### 4.2 任意 SDK 接入（回应"只能用 openai 类的咋办"）

**接缝只有一个函数**：`(req: { system: string; prompt: string }) => Promise<string>`。
你手里已有的任何 LLM SDK，2 行变成本库的 model：

```ts
// openai SDK（你已有的 client，原样用）
const model = async ({ system, prompt }) => {
  const r = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
  });
  return r.choices[0].message.content!;
};

// anthropic SDK
const model = async ({ system, prompt }) => {
  const r = await anthropic.messages.create({
    model: "claude-sonnet-4-5", max_tokens: 1024, system,
    messages: [{ role: "user", content: prompt }],
  });
  return r.content[0].text;
};

// Vercel ai SDK
import { generateText } from "ai";
const model = ({ system, prompt }) => generateText({ model: "openai/gpt-5.2", system, prompt }).then(r => r.text);

// 自己的后端
const model = async ({ system, prompt }) => {
  return fetch("/api/ai-chat", { method: "POST", body: JSON.stringify({ system, prompt }) })
    .then(r => r.json()).then(r => r.content);
};

// 本地 Ollama？openai() 帮助函数本身就支持：baseURL 指到 localhost 即可
```

没有 transport 接口、没有适配器注册、没有协议版本——**一个函数签名就是全部约定**。

### 4.3 语义契约（可选，但这是本库的灵魂）

契约不再叫 DataProfile、不再单独一个概念，就是场景的一个参数：

```ts
const summary = scene({
  task: "归纳这些工单",
  sections: ["summary", "actions", "risks"],
  about: {
    entity: "ticket",
    fields: [
      { name: "id", meaning: "工单唯一 id，refs 的唯一合法取值" },
      { name: "body", meaning: "工单正文，可能是英文" },
      { name: "slaHours", meaning: "解决 SLA 小时数",
        fallback: "列表接口不返回，客户端自己算，禁止让模型猜数字" },
    ],
    localeFacts: ["工单正文可能是英文，lang=zh 时必须译成中文"],
  },
});
```

`about` 里写什么，prompt 里就有什么——AI 理解你的数据的唯一渠道，也是记录踩坑伤疤的地方。

### 4.4 评分类场景

```ts
const triage = scene({
  task: "按四个维度评估工单的严重程度",
  scores: ["severity", "urgency", "effort", "risk"],   // 输出 {score, reason, refs}
});
```

两种输出形状覆盖 90% 单步场景，第三种走自定义 parse（进阶用法，不进 README 第一屏）。

### 4.5 质量门禁

```ts
import { evaluate } from "ai-kit/eval";

const report = await evaluate(summary, [
  {
    name: "中文输出 + 引用合法",
    lang: "zh",
    records: snapshot,
    mock: mockModelJson,                       // 回放，零 token
    assert: [lang("zh"), refs(ids), covers(["回滚"])],
  },
]);
```

### 4.6 自校验重试（从 instructor 学的，v1 砍掉现在请回来）

```ts
const result = await summary.run({ model, records, lang: "zh", retries: 2 });
// refs 不合法 / JSON 结构错误 → 把错误信息喂回模型重试，最多 2 次
```

instructor 的实践证明：**校验失败喂回重试不是锦上添花，是把"prompt 工程"变成"代码断言"的关键机制**。airun M1 里做过，这次以正确姿势回归。

## 5. v2 导出面（全部）

| 导出 | 用途 | 对应 v1 的什么 |
|---|---|---|
| `scene({...})` | 声明场景 | defineAiScene（改名+瘦身） |
| `scene.run({model, records, lang, retries?})` | 调用 | runSceneOnce + createSceneController 合并 |
| `openai({model, baseURL?, apiKey?})` | OpenAI 兼容模型帮助函数（fetch 实现，~20 行） | createOpenAiCompatibleTransport |
| `evaluate(scene, cases)` | 质量门禁 | runCases |
| `lang/refs/covers/nouns` 断言助手 | eval 用 | 原样 |

**v1 的 12 个导出 → v2 的 5 个。** 没了：AiTransport、createApiTransport、createSceneController、createMemoryStore、createLocalStorageStore、buildCacheKey、hashContent（缓存层见 §7 待定）。

## 6. 不变的东西（这些是对的，藏在幕后）

- 七条强制不变量（输出语言/专有名词/数字程序统计/refs 白名单/禁编造/紧凑 JSON/单句化）
- refs 白名单 + 软失败 + 截断
- 语义契约注入 prompt 的机制
- golden eval 离线回放（零 token）
- 缓存键设计（身份|范围|内容|语言|版本）——机制保留，入口重设计

## 7. 待你拍板的三个问题

1. **接缝形状**：`(req: { system, prompt }) => Promise<string>`（各 SDK 映射最自然，推荐）还是 `(prompt: string) => Promise<string>`（更简，但 system adherence 靠拼串）？
2. **缓存/控制层去哪**：a) v2 先砍掉，纯 run，缓存等真实需求回来；b) 做成 `scene.cached({ store, ttl })` 可组合 wrapper。我倾向 a——先把核心打磨到"一眼会用"，缓存是第二个故事
3. **命名**：`scene()` + `.run()`（zod 风，推荐）还是 `defineScene()` / `runScene()`（动词更显式）？

## 8. 迁移成本评估

核心管线（prompt 组装/guards/解析/eval）逻辑全部复用，重构量主要在：改名、合并入口、砍 transport 层、加 retries。估计一次改造 + 测试改名，一轮内完成。**在你确认设计之前不动代码。**
