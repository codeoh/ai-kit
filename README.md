# ai-kit

[![npm version](https://img.shields.io/npm/v/ai-kit.svg)](https://www.npmjs.com/package/ai-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

[English](./README.md) | [简体中文](./README.zh-CN.md)

ai-kit turns your business data into validated, citation-backed, structured AI output — summaries, scores, recommendations, extractions — on top of any OpenAI-compatible API.

You declare **what the AI should do** (a scene) and **what your data means** (a semantic contract). The kit assembles the prompt, calls the model, validates the output, and returns a typed result.

## The problem it solves

Calling the model is the easy part — `openai` or the `ai` SDK already do that well:

```ts
const res = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [...] });
const raw = res.choices[0].message.content; // a string. And then?
```

`raw` is a string. Everything that makes it *usable* is on you: parsing the JSON, checking the language, verifying that cited record ids actually exist, dropping malformed items, computing the numbers so the model can't invent them, caching per user, and re-checking all of it after every prompt tweak.

ai-kit does that whole layer:

```ts
import { defineAiScene, createOpenAiCompatibleTransport, runScene } from "ai-kit";

// 1. What the AI should do, and the shape of its output
const scene = defineAiScene({
  id: "ticket_summary",
  output: { kind: "sections", sections: ["summary", "actions", "risks"] },
  prompt: { role: "You are a support-team assistant.", task: "Summarize the given tickets." },
});

// 2. How to reach the model — any OpenAI-compatible endpoint
const transport = createOpenAiCompatibleTransport({
  baseUrl: "https://api.deepseek.com/v1",
  headers: { authorization: `Bearer ${process.env.API_KEY}` },
});

// 3. Business data in, structured result out
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

Every `text` is one sentence, in the requested language. Every `refs` entry is a real input id — fabricated ones are dropped. Numbers come from your code, not the model.

## What happens inside `runScene`

1. **Assemble the prompt** — role + task + seven mandatory invariants + your contract (field meanings, fallback rules, locale facts) + the records as JSON
2. **Call the transport** — the one you provided (direct or your own backend)
3. **Parse and validate** — extract the JSON, enforce the refs whitelist against input ids, drop malformed items (soft-fail), truncate over-length text
4. **Return a typed result** — `sections` or `dimensions`, malformed structure throws instead of passing garbage through

The seven invariants (output language, verbatim proper nouns, program-computed stats, refs whitelist, no fabrication, compact JSON, one sentence per item) are injected into every prompt and enforced again at parse time. You can add rules; you cannot remove these.

## Add quality gates (the real payoff)

Write golden cases — real data snapshots + replayed model outputs + assertions, zero tokens:

```ts
import { runCases, assertLangIs, assertRefsSubset, assertCovers } from "ai-kit/eval";

const report = await runCases([
  {
    name: "zh mode outputs Chinese + citations legal",
    lang: "zh",
    input: { records: snapshot },
    mockOutput: mockModelJson,
    asserts: [assertLangIs("zh"), assertRefsSubset(ids), assertCovers(["rollback"])],
  },
], { scene });
```

Run them in CI. From now on, every prompt tweak or model swap is a seconds-level regression.

## Building a UI?

`createSceneController` adds the app layer on top of `runScene`: cache keyed by identity + scope + content + language, debounce, single-flight, no-cache-on-fail, and a subscribable state machine (`idle | empty | pending | ok | error`). Framework-free — render `state.result` in Vue, React, or anything else. See the [guide](./docs/guide.md).

## Getting started

```bash
npm install ai-kit
```

Full walkthrough — contracts, controllers, evals: **[guide.md](./docs/guide.md)** · [简体中文](./docs/guide.zh-CN.md)

## Development

```bash
pnpm install
pnpm test       # 44 tests, including the 5-case golden gate
pnpm build      # tsdown: esm + cjs + d.ts
pnpm typecheck
```

No runtime dependencies. Node >= 18, browsers included.

## License

[MIT](./LICENSE)
