# ai-kit Guide

> Language: [English](./guide.md) | [简体中文](./guide.zh-CN.md)

The full integration walkthrough. The public API is four functions:

| Export | Purpose |
|---|---|
| `defineScene({...})` | Declare once: what the AI does, the output shape, the optional contract |
| `runScene(scene, { model, records, lang, retries?, signal? })` | Call: data in, validated result out |
| `openai({ model, baseURL?, apiKey?, structured? })` | Built-in model helper for any OpenAI-compatible endpoint |
| `evaluate(scene, cases)` | Quality regression tests (baseline replay) (from `ai-kit/eval`) |

The model itself is the only convention: a function `({ system, prompt, signal?, jsonSchema? }) => Promise<string>`. Any SDK adapts in two lines — the last two arguments are optional, so an adapter that only destructures `system` and `prompt` keeps working unchanged.

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

What happens inside `runScene`:

- **Prompt assembly** — role + task + seven hard rules + your contract + the records
- **Structured output** — the shape is derived from your declaration and sent to the endpoint as a JSON schema when it supports one. Ends that don't are handled automatically: see below
- **Refs whitelist** — ids that don't exist in the input are dropped, and the count lands in `droppedRefs` so you can tell "no sources" from "fabricated sources"
- **Soft-fail** — malformed items dropped, valid ones survive; only structural failures throw
- **Self-correction** — with `retries`, the validation error is fed back to the model for another attempt

### Step 4b. what the endpoint supports

The output shape is enforced where the endpoint allows it, and worked around where it doesn't. Three levels, tried in order and then remembered:

| Level | Sent | What you're guaranteed |
|---|---|---|
| 1 | `json_schema` with `strict` | The shape and types are enforced by the model itself. This is the only level where structurally broken output can't happen |
| 2 | `json_object` | Output is valid JSON. Field names and types still come from the prompt |
| 3 | nothing extra | Output shape relies on the prompt alone |

DeepSeek sits at level 2 — it doesn't support `json_schema`. OpenAI sits at level 1. You don't have to pick; the level is detected on the first call and reused after that.

Note that levels 2 and 3 still need the parsing layer, so a badly shaped response can still throw `SceneStructureError`. That's expected, and it's why `retries` exists.

If your gateway rejects unknown request fields, turn the whole thing off:

```ts
openai({ model: "gpt-4o-mini", structured: false })   // never sends response_format
```

### Step 4c. cancelling a call

Pass a `signal` and the request actually stops — the built-in `openai()` forwards it to `fetch`. Nothing partial comes back; the call rejects.

```ts
const ctrl = new AbortController();
button.onclick = () => ctrl.abort();

await runScene(ticketSummary, { model, records, signal: ctrl.signal });
```

A cancelled call is not retried, even with `retries` set — cancelling is your decision, not a failure to recover from.

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

## The seven hard rules

Injected into every system prompt, in Chinese or English depending on `lang`. You can add rules with `extraRules` but not remove these.

Of the seven, only one is enforced mechanically: **rule 4**, the `refs` whitelist. The rest live in the prompt, which is not a guarantee — a model can still break them. If that matters for your use, check the result yourself, or compute it in code.

1. Output language = `lang`, regardless of input language (with explicit translation requirement)
2. Proper nouns (names, products, ticket ids, numbers) stay verbatim
3. Statistics are not computed by the model — only quoted from what your `stats` function produced
4. `refs` may only reference input record ids ← **this one is enforced in code**
5. Nothing to say → empty arrays
6. Output one compact JSON object only
7. One sentence per item, no numbering

## Scores, and why `null` shows up

`score` is `number | null`. `null` means the model didn't give a usable number (missing, wrong type, NaN). A real `0` stays `0`.

This distinction matters: in a 0-to-5 severity scale, `0` is a real answer, and quietly turning a type error into `0` would look like a confident low score when the model actually said nothing useful.

```ts
if (result.severity.score === null) {
  // the model didn't answer this dimension
}
```

## How it relates to MCP

One shared asset: the semantic contract. `ai-kit` injects it into prompts; an MCP server can serve the same file as a resource and expose scenes as tools. The discipline that makes this work: **contracts are standalone data files, never welded into component code.**

## Versioning policy

- `about` contract format or output-shape change → **major**
- New assertion helpers / guards → **minor**
- Prompt wording changes → **patch**, and must pass the baseline tests before release
