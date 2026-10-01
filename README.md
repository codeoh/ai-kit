# ai-kit

[![npm version](https://img.shields.io/npm/v/ai-kit.svg)](https://www.npmjs.com/package/ai-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

[English](./README.md) | [简体中文](./README.zh-CN.md)

ai-kit turns your business data into validated, citation-backed, structured AI output — summaries, scores, recommendations, extractions — over **any** model, through **any** SDK you already use.

You declare **what the AI should do** (`defineScene`) and **what your data means** (the `about` contract). `runScene` assembles the prompt, calls your model function, validates the output, and returns a typed result.

## The problem it solves

Calling the model is the easy part — `openai` or the `ai` SDK already do that well:

```ts
const res = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [...] });
const raw = res.choices[0].message.content; // a string. And then?
```

`raw` is a string. Everything that makes it *usable* is on you: parsing the JSON, checking the language, verifying that cited record ids actually exist, dropping malformed items, computing the numbers so the model can't invent them, and re-checking all of it after every prompt tweak.

ai-kit is that whole layer:

```ts
import { defineScene, openai, runScene } from "ai-kit";

// 1. What the AI should do, and the shape of its output
const summary = defineScene({
  task: "Summarize the given support tickets.",
  sections: ["summary", "actions", "risks"],
});

// 2. Data in, validated result out
const result = await runScene(summary, {
  model: openai({ model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1", apiKey: process.env.API_KEY }),
  records: tickets, // [{ id: "t1", title: "Billing dispute", ... }]
  lang: "zh",
  retries: 1, // validation failures are fed back to the model once
});

// result = {
//   summary: [{ text: "Orion 提出重复发票 INV-88 的退款申请，周五升级通话。", refs: ["t1"] }],
//   actions: [{ text: "张三负责跟进本周工单。", refs: ["t1", "t2"] }],
//   risks:   [{ text: "staging 审批阻塞新成员接入。", refs: ["t3"] }]
// }
```

Every `text` is one sentence, in the requested language. Every `refs` entry is a real input id — fabricated ones are dropped, malformed items are removed, the rest survives.

## Any model, any SDK

The only convention is one function: `({ system, prompt }) => Promise<string>`.

- **OpenAI-compatible** (OpenAI, DeepSeek, Moonshot, Ollama, vLLM) — built in: `openai({ model, baseURL?, apiKey? })`
- **Any other SDK** — wrap your client in two lines:

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
```

The kit never stores keys, never wraps HTTP you didn't ask for, and never cares which SDK you picked.

## What happens inside `runScene`

1. **Assemble the prompt** — role + task + seven mandatory invariants + your `about` contract (field meanings, fallback rules, locale facts) + the records as JSON
2. **Call your model function**
3. **Parse and validate** — extract the JSON, enforce the refs whitelist against input ids, drop malformed items (soft-fail), truncate over-length text
4. **Return a typed result** — sections or scores; on structural failure, throw (or feed the error back and retry with `retries`)

The seven invariants (output language, verbatim proper nouns, program-computed stats, refs whitelist, no fabrication, compact JSON, one sentence per item) are injected into every prompt and enforced again at parse time. You can add rules; you cannot remove these.

## Add quality gates (the real payoff)

Write golden cases — real data snapshots + replayed model outputs + assertions, zero tokens:

```ts
import { evaluate, lang, refs, covers } from "ai-kit/eval";

const report = await evaluate(summary, [
  {
    name: "zh mode outputs Chinese + citations legal",
    lang: "zh",
    records: snapshot,
    mock: mockModelJson,
    assert: [lang("zh"), refs(ids), covers(["rollback"])],
  },
]);
```

Run them in CI. From now on, every prompt tweak or model swap is a seconds-level regression.

## Getting started

```bash
npm install ai-kit
```

Full walkthrough — contracts, output kinds, evals, retries: **[guide.md](./docs/guide.md)** · [简体中文](./docs/guide.zh-CN.md)

## Development

```bash
pnpm install
pnpm test       # 41 tests, including the 5-case golden gate
pnpm build      # tsdown: esm + cjs + d.ts
pnpm typecheck
```

No runtime dependencies. Node >= 18, browsers included.

## License

[MIT](./LICENSE)
