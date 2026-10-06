# ai-kit

[![npm version](https://img.shields.io/npm/v/ai-kit.svg)](https://www.npmjs.com/package/ai-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

[English](./README.md) | [简体中文](./README.zh-CN.md)

ai-kit turns your business data into **structured AI output with citations you can check** — summaries, scores, recommendations, extractions. Any model, any SDK you already use.

You write two things: **what the AI should do** (`defineScene`) and **what your fields mean** (`about`). `runScene` does the rest.

## 30 seconds

```ts
import { defineScene, openai, runScene } from "ai-kit";

// 1. What the AI should do, and the shape of the output
const summary = defineScene({
  task: "Summarize the given support tickets.",
  sections: ["summary", "actions", "risks"],   // defines the output shape
});

// 2. Data in, result out
const result = await runScene(summary, {
  model: openai({ model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1", apiKey: process.env.API_KEY }),
  records: tickets,        // [{ id: "t1", title: "Billing dispute", ... }]
  lang: "zh",
});

// result = {
//   summary: [{ text: "Orion requested a refund for duplicate invoice INV-88; escalation call Friday.", refs: ["t1"] }],
//   actions: [{ text: "Zhang San follows up this week's tickets.", refs: ["t1", "t2"] }],
//   risks:   [{ text: "staging approval blocks the new teammate.", refs: ["t3"] }]
// }
```

## Why you need it

Calling the model is easy — `openai` or the `ai` SDK do that in two lines:

```ts
const res = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [...] });
const raw = res.choices[0].message.content; // a string. And then?
```

The hard part is everything after `raw`: extracting the JSON, checking the language, verifying that cited record ids actually exist, dropping malformed items, computing the numbers so the model can't invent them, caching per user — and re-checking all of it after every prompt tweak.

ai-kit is that whole layer.

## What happens inside `runScene`

1. **Assembles the prompt** and hands it to your model: role + your task + 7 hard rules + your field notes + this batch of records
2. **Calls your model function**
3. **Checks the output**: extracts the JSON, matches citation ids against the real records, drops malformed items, truncates over-length text
4. **Returns a typed result**; structurally broken output throws (or, with `retries`, the model gets to fix it)

Those 7 hard rules ship with every request. You can't turn them off, and you don't need to:

| Rule | Why it exists |
|---|---|
| Output in the language you asked for (`lang`) | English source text dragging Chinese output off course — the most common bug |
| Proper nouns stay verbatim (names, products, ticket ids, numbers) | `VVDN`, `RFP`, `INV-88` translated or renamed means the information is gone |
| Numbers come from you, never from the model | Models will happily invent quantities and amounts |
| Citations may only reference record ids that exist | Models invent an id; clicking it leads nowhere |
| No content → empty array | Models would rather make something up than say "nothing" |
| JSON only | One stray sentence means extra parsing |
| One sentence per item, no numbering | Your render layer stops doing cleanup |

## Any model

One convention: a model is just a function — `({ system, prompt }) => Promise<string>`.

```ts
// OpenAI-compatible (OpenAI / DeepSeek / Moonshot / Ollama / vLLM) — built in
const model = openai({ model: "deepseek-chat", baseURL: "...", apiKey: "..." });

// Anthropic — two lines around the client you already have
const model2 = async ({ system, prompt }) => {
  const r = await anthropic.messages.create({
    model: "claude-sonnet-4-5", max_tokens: 1024, system,
    messages: [{ role: "user", content: prompt }],
  });
  return r.content[0].text;
};
```

**Why is only `openai()` built in?** Because the OpenAI wire format is the industry's de facto standard — one implementation covers OpenAI, DeepSeek, Moonshot, Ollama, vLLM and dozens more, while Anthropic is a single vendor. Both integrations cost you two lines; shipping more would turn a provider matrix into our maintenance burden — that's ai-sdk's job, not ours.

## Quality regression tests (`evaluate`)

After you tweak a prompt or swap models, how do you know quality didn't regress? **Record one real output as a baseline**, then re-run and check it automatically:

```ts
import { evaluate, lang, refs, covers } from "ai-kit/eval";

const report = await evaluate(summary, [
  {
    name: "zh mode outputs Chinese + citations legal",
    records: realTickets,     // real data snapshot
    mock: savedModelOutput,   // the output you recorded earlier
    assert: [lang("zh"), refs(allIds), covers(["rollback"])],
  },
]);
```

No live model calls, zero tokens, seconds to run, straight into CI. This is what turns "change one line of prompt, refresh the page, squint at the output" into a seconds-long feedback loop.

## A real case

Our first scene (customer activity summary) took **8 rounds of debugging, roughly 1.5 person-days per round**, half of it spent on bugs the model couldn't see:

- The list endpoint doesn't return `customerCode`, so grouping by customer was always empty — **the feature was completely unreachable for users**, found by digging through browser network logs
- The global locale is `zh-CN/en-US`; the code compared `=== "en"`, so English mode silently did nothing
- Weekly reports were written in English; the "keep proper nouns verbatim" rule dragged the Chinese output into English

With ai-kit:

- Those lessons went into the contract file on day one: `{ name: "customerCode", fallback: "not returned by this endpoint; group by customerName" }`, the locale facts, proper-noun protection
- The 7 hard rules ride along with every request; fabricated citation ids get dropped automatically
- The checks live in CI: after a prompt or model change you know within seconds whether anything regressed

Result: the first scene took about 1.5 days, each additional scene about half a day — and from the second scene on, none of the above bugs came back.

## Getting started

```bash
npm install ai-kit
```

Full walkthrough: **[guide.md](./docs/guide.md)** · [简体中文](./docs/guide.zh-CN.md)

## Development

```bash
pnpm install
pnpm test       # 41 tests, including the 5 baseline quality cases
pnpm build      # tsdown: esm + cjs + d.ts
pnpm typecheck
```

No runtime dependencies. Node >= 18, browsers included.

## License

[MIT](./LICENSE)
