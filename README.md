# ai-kit

MIT · Node >= 18 · TypeScript strict · browsers included · no runtime dependencies

[English](./README.md) | [简体中文](./README.zh-CN.md)

ai-kit turns your business data into **structured AI output with citations you can check** — summaries, scores, recommendations, extractions. Any model, any SDK you already use.

Why you need it: calling the model takes two lines, but what comes back is a string, and everything after that is on you — extracting the JSON, checking the language, verifying that cited record ids exist, dropping malformed items, computing the numbers, re-checking everything after each prompt tweak. ai-kit is that whole layer.

## 30 seconds

```ts
import { defineScene, openai, runScene } from "ai-kit";

const summary = defineScene({
  task: "Summarize the given support tickets.",
  sections: ["summary", "actions", "risks"],   // defines the output shape
});

const result = await runScene(summary, {
  model: openai({ model: "deepseek-chat", baseURL: "...", apiKey: "..." }),
  records: tickets,        // [{ id: "t1", title: "Billing dispute", ... }]
  lang: "zh",
});

result.summary;   // [{ text: "Orion requested a refund for duplicate invoice INV-88.", refs: ["t1"] }]
```

## What it does for you

| Capability | What it means |
|---|---|
| Summaries / recommendations | `sections: ["summary", "actions", "risks"]` — grouped item lists under the headings you choose |
| Scoring / classification / extraction | `scores: ["severity", "urgency"]` — a score, a reason and citations per dimension |
| Output language you control | With `lang: "zh"`, English source text is translated; proper nouns stay verbatim |
| Every claim carries citations | `refs` may only reference record ids that exist; fabricated ones are dropped. Render them as clickable citations |
| Numbers never come from the model | Counts, amounts and dates are computed by your code and passed in; the model only phrases them |
| Malformed items don't ruin the batch | Bad items dropped, good ones survive; only a structurally broken output throws |
| The model can fix its own mistakes | `retries: 1` feeds the validation error back for another attempt |
| Quality regression checks | Record one real output as a baseline; every later change is re-checked automatically |

## One real feature, end to end

"Customer activity summary" in a CRM: turn a customer's recent sales activity records into a three-part structured summary shown on the customer detail page. This is the first scene we shipped.

**1. Write the business rules into the contract** (this is where all the quality comes from)

```jsonc
// profiles/customer.json
{
  "entity": "customer_activity",
  "fields": [
    { "name": "customerName", "meaning": "Customer name — the grouping key", "authoritative": true },
    { "name": "customerCode", "meaning": "Customer code",
      "fallback": "The list endpoint does not return this field; it is always empty. Group by customerName instead." },
    { "name": "content", "meaning": "Activity body / weekly report, may be written in English" },
    { "name": "ownerName", "meaning": "Owner person name — keep verbatim", "pii": true }
  ],
  "localeFacts": [
    "The global locale is only zh-CN / en-US",
    "Activity content may be an English weekly report; when lang=zh it must be translated into Chinese"
  ]
}
```

Those two lines — `fallback` and `localeFacts` — came from real incidents: the endpoint not returning `customerCode` made grouping always empty, so the feature was completely unreachable for users; English weekly reports dragged the Chinese output off course. Written into the contract, the model gets it right the first time.

**2. Declare the scene**

```ts
const activitySummary = defineScene({
  task: "Summarize all sales activity for this customer in three parts: work done, support needed, next steps.",
  sections: ["work", "support", "plan"],
  about: customerProfile,     // the contract above
});
```

**3. Feed the data**

```ts
const records = [
  { id: "a1", customerName: "Stellar Tech", ownerName: "Zhang San",
    content: "Weekly report: submitted the RFP for the Orion project; bid review on Friday." },
  { id: "a2", customerName: "Stellar Tech", ownerName: "Zhang San",
    content: "Second technical session with the platform team; customer focuses on delivery time and after-sales response." },
  { id: "a3", customerName: "Stellar Tech", ownerName: "Li Si",
    content: "Budget approved for Q4; waiting for procurement to start." },
];

const result = await runScene(activitySummary, {
  model: openai({ model: "deepseek-chat", baseURL: "...", apiKey: "..." }),
  records,
  lang: "zh",
  stats: computeStats,     // counts computed by code; the model never repeats them
  retries: 1,
});
```

**4. What you get**

```ts
result.work;
// [
//   { text: "RFP submitted for the Orion project; bid review on Friday.", refs: ["a1"] },
//   { text: "Second technical session focused on delivery time.", refs: ["a2"] },
// ]
result.support;
// [{ text: "Zhang San follows up this week's activities.", refs: ["a1", "a2"] }]
result.plan;
// [{ text: "Advance the commercial step once procurement starts.", refs: ["a3"] }]
```

All Chinese, proper nouns (`RFP`, `Orion`) kept verbatim, every line clickable back to its source record, the English weekly report correctly translated.

**What it cost:** about 1.5 days for the first scene (mostly learning those business rules), roughly half a day for each additional one. What you stop paying: the "tweak prompt → refresh the page → squint at the output" loop, and re-checking every time whether the model made something up.

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

// Your own backend
const model3 = ({ system, prompt }) =>
  fetch("/api/ai-chat", { method: "POST", body: JSON.stringify({ system, prompt }) })
    .then((r) => r.json()).then((r) => r.content);
```

**Why is only `openai()` built in?** The OpenAI wire format is the industry's de facto standard — one implementation covers OpenAI, DeepSeek, Moonshot, Ollama, vLLM and dozens more, while Anthropic is a single vendor. Both integrations cost two lines; shipping more would turn a provider matrix into our maintenance burden — that's ai-sdk's job, not ours.

## Keeping quality from regressing

Record one real output as a baseline; every later change re-runs and checks it. No live model calls, zero tokens, seconds to run, straight into CI:

```ts
import { evaluate, lang, refs, covers } from "ai-kit/eval";

const report = await evaluate(activitySummary, [
  {
    name: "zh mode outputs Chinese + citations legal + key point covered",
    records: realTickets,
    mock: savedModelOutput,          // the output you recorded earlier
    assert: [lang("zh"), refs(allIds), covers(["RFP"])],
  },
]);
```

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
