# ai-kit Guide

> Language: [English](./guide.md) | [简体中文](./guide.zh-CN.md)

The full integration walkthrough. The public API is four functions:

| Export | Purpose |
|---|---|
| `defineScene({...})` | Declare once: what the AI does, the output shape, the optional contract |
| `runScene(scene, { model, records, lang, retries? })` | Call: data in, validated result out |
| `openai({ model, baseURL?, apiKey? })` | Built-in model helper for any OpenAI-compatible endpoint |
| `evaluate(scene, cases)` | Quality regression tests (baseline replay) (from `ai-kit/eval`) |

The model itself is the only convention: a function `({ system, prompt }) => Promise<string>`. Any SDK adapts in two lines.

## Walkthrough (~30 minutes)

### Step 0: install

```bash
npm install ai-kit
```

Node >= 18. Runs in browsers and Node; TypeScript types included.

### Step 1: declare the semantic contract

Create `profiles/ticket.json` — this teaches the AI what your data means:

```json
{
  "entity": "ticket",
  "fields": [
    { "name": "id", "meaning": "Ticket unique id, the only legal value for refs" },
    { "name": "title", "meaning": "Ticket title" },
    { "name": "body", "meaning": "Ticket body, may be written in English" },
    { "name": "status", "meaning": "Ticket status", "dict": "open | pending | closed" },
    { "name": "team", "meaning": "Owning team name, the grouping key" },
    { "name": "assignee", "meaning": "Assignee person name, proper-noun protected", "pii": true },
    { "name": "slaHours", "meaning": "Resolved SLA in hours", "fallback": "List API does not return this field; compute it on the client. Never let the model guess numbers." }
  ],
  "unavailable": ["Cross-system customer identity mapping"],
  "localeFacts": [
    "Ticket body may be written in English; when lang=zh it must be translated into Chinese"
  ]
}
```

What each annotation buys you:

- `meaning` — injected into every system prompt for this scene
- `fallback` — tells the AI what to do when a field is missing
- `pii` — reserved for masking strategies before the prompt leaves your code
- `unavailable` — capabilities that don't exist yet, so the AI never cites them
- `localeFacts` — environment truths the AI cannot discover on its own

### Step 2: declare the scene

One AI feature = one declaration:

```ts
import { defineScene, validateDataProfile, type DataProfile } from "ai-kit";
import ticketProfileJson from "../profiles/ticket.json";

const ticketProfile: DataProfile = validateDataProfile(ticketProfileJson);

export const ticketSummary = defineScene({
  id: "ticket_summary",
  task: "Summarize the given support tickets.",
  sections: ["summary", "actions", "risks"],
  about: ticketProfile,
});
```

Two output shapes cover most single-step features:

- `sections: ["summary", "actions", "risks"]` → `Record<key, { text: string; refs: string[] }[]>`
- `scores: ["severity", "urgency"]` → `Record<key, { score: number; reason: string; refs: string[] }>`

Multi-turn chat is out of scope by design.

### Step 3: choose a model

OpenAI-compatible endpoints (OpenAI, DeepSeek, Moonshot, Ollama, vLLM) are built in:

```ts
import { openai } from "ai-kit";

const model = openai({
  model: "deepseek-chat",
  baseURL: "https://api.deepseek.com/v1",
  apiKey: process.env.API_KEY,
});
```

Any other SDK — wrap your client in two lines:

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

// Vercel ai SDK:
import { generateText } from "ai";
const model2 = ({ system, prompt }) =>
  generateText({ model: "openai/gpt-5.2", system, prompt }).then((r) => r.text);

// Your own backend:
const model3 = ({ system, prompt }) =>
  fetch("/api/ai-chat", { method: "POST", body: JSON.stringify({ system, prompt }) })
    .then((r) => r.json())
    .then((r) => r.content);
```

> Direct browser usage puts the API key in the client — fine for local tools, internal apps and prototypes; for multi-user production, route through your backend.

### Step 4: run

```ts
import { runScene } from "ai-kit";

const result = await runScene(ticketSummary, {
  model,
  records: tickets,                 // each record needs an `id` for refs
  lang: "zh",                       // default "en"
  stats: computeStats,              // numbers computed by code, never by the model
  retries: 1,                       // validation failure -> feed error back, retry once
});
```

What you get for free inside `runScene`:

- **Prompt assembly** — role + task + seven mandatory invariants + your contract + the records
- **Refs whitelist** — fabricated citation ids are dropped against the input id set
- **Soft-fail** — malformed items dropped, valid ones survive; only structural failures throw
- **Self-correction** — with `retries`, the validation error is fed back to the model for a fixed attempt

### Step 5: lock in quality with baseline tests

```ts
import { evaluate, lang, refs, covers } from "ai-kit/eval";

const report = await evaluate(ticketSummary, [
  {
    name: "zh mode outputs Chinese + citations legal",
    lang: "zh",
    records: snapshot,                // real data snapshot
    mock: mockModelJson,              // replayed model output, zero tokens
    assert: [lang("zh"), refs(ids), covers(["rollback"])],
  },
  // soft-fail / structure-error / fabricated-id cases — see evals/ticket.golden.test.ts
]);
```

Run them in CI (`pnpm test`). Every prompt tweak or model swap is a seconds-level regression.

Built-in assertion helpers: `lang`, `nouns`, `refs`, `covers`, `noError`.

## The seven mandatory invariants

Injected into every system prompt and enforced again at parse time; consumers can add rules via `extraRules` but never remove these:

1. Output language = `lang`, regardless of input language (with explicit translation requirement)
2. Proper nouns (names, products, ticket ids, numbers) stay verbatim
3. Statistics are never produced by the model — only quoted from program-computed stats
4. `refs` may only reference input record ids (whitelist enforced; fabricated ids dropped)
5. Nothing to say → empty arrays; fabrication forbidden
6. Output one compact JSON object only
7. One sentence per item, no numbering

## How it relates to MCP

One shared asset: the semantic contract. `ai-kit` injects it into prompts; an MCP server can serve the same file as a resource and expose scenes as tools. The discipline that makes this work: **contracts are standalone data files, never welded into component code.**

## Versioning policy

- `about` contract format or output-shape change → **major**
- New assertion helpers / guards → **minor**
- Prompt wording changes → **patch**, and must pass the baseline tests before release
