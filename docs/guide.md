# ai-kit Guide

> Language: [English](./guide.md) | [简体中文](./guide.zh-CN.md)

This is the full integration walkthrough. The consumer's entire job fits in five decisions:

> Review rule: any decision you cannot make without reading the source code is a design flaw.

| # | Decision | Entry point |
|---|---|---|
| 1 | How to reach the model? | Three options: `createOpenAiCompatibleTransport({ baseUrl, headers })` — direct to any OpenAI-compatible endpoint (OpenAI / DeepSeek / Moonshot / Ollama / vLLM…); `createApiTransport(send)` — through your backend proxy; or implement `AiTransport` yourself. The kit never stores keys — where they live is your call |
| 2 | Where to cache results? | `createMemoryStore()` (default/testing) or `createLocalStorageStore(prefix?)` (browser persistence) |
| 3 | What does the AI do and return? | `defineAiScene({ id, output, prompt })` — ~40 lines |
| 4 | What do your fields mean? | `DataProfile` file kept in **your** repo (`profiles/<entity>.json`) |
| 5 | How is quality gated? | Seven mandatory invariants (cannot be disabled) + `runCases` golden eval (zero tokens) |

## Walkthrough (~30 minutes)

### Step 0: install

```bash
npm install ai-kit
```

Node >= 18. Runs in browsers and Node; TypeScript types included.

### Step 1: declare a semantic contract

Create `profiles/ticket.json` — this teaches the AI what your data means:

```json
{
  "entity": "ticket",
  "fields": [
    { "name": "id", "meaning": "Ticket unique id, the only legal value for refs", "authoritative": true },
    { "name": "title", "meaning": "Ticket title" },
    { "name": "body", "meaning": "Ticket body, may be written in English" },
    { "name": "status", "meaning": "Ticket status", "dict": "open | pending | closed" },
    { "name": "team", "meaning": "Owning team name, the grouping key", "authoritative": true },
    { "name": "assignee", "meaning": "Assignee person name, proper-noun protected", "authoritative": true, "pii": true },
    { "name": "slaHours", "meaning": "Resolved SLA in hours", "fallback": "List API does not return this field; compute it from createdAt/resolvedAt on the client. Never let the model guess numbers." }
  ],
  "unavailable": ["Cross-system customer identity mapping"],
  "localeFacts": [
    "Ticket body may be written in English; when lang=zh it must be translated into Chinese"
  ]
}
```

What each annotation buys you:

- `meaning` — injected into every system prompt for this entity
- `authoritative` — marks the field the AI should trust for grouping/attribution
- `fallback` — tells the AI (and your grouping code) what to do when a field is missing
- `pii` — reserved for masking strategies before the prompt leaves the client
- `unavailable` — capabilities that don't exist yet, so the AI never cites them
- `localeFacts` — environment truths the AI cannot discover on its own

### Step 2: declare a scene

One AI feature = one declaration:

```ts
import { defineAiScene, validateDataProfile, type DataProfile } from "ai-kit";
import ticketProfileJson from "../profiles/ticket.json";

const ticketProfile: DataProfile = validateDataProfile(ticketProfileJson);

export const ticketSummary = defineAiScene({
  id: "ticket_summary",                          // lowercase_with_underscores
  output: { kind: "sections", sections: ["summary", "actions", "risks"] },
  prompt: { role: "You are a support-team assistant.", task: "Summarize the given tickets." },
  profile: ticketProfile,
  cache: { ttlMs: 7 * 864e5, schemaVersion: 1 },
});
```

Two built-in output kinds cover most single-step features:

- `sections` — grouped lists: `Record<key, { text: string; refs: string[] }[]>`
- `dimensions` — scores: `Record<key, { score: number; reason: string; refs: string[] }>`

Multi-turn chat is out of scope by design.

### Step 3: wire the controller and render

```ts
import { createApiTransport, createLocalStorageStore, createSceneController } from "ai-kit";

const ctrl = createSceneController({
  scene: ticketSummary,
  // Option A: direct — one line, any OpenAI-compatible endpoint:
  // transport: createOpenAiCompatibleTransport({ baseUrl: "https://api.deepseek.com/v1", headers: { authorization: `Bearer ${key}` } })
  // Option B: through your backend (recommended for multi-user production, so keys stay server-side):
  transport: createApiTransport(async (req) => {
    const r = await fetch("/api/ai-chat", { method: "POST", body: JSON.stringify(req) }).then((x) => x.json());
    return { content: r.content, truncated: r.truncated };
  }),
  store: createLocalStorageStore("myapp:"),
  identity: () => user.id,                       // cache-key only, never in prompt
  scope: () => teamName,                         // cache-key only
  lang: () => (locale === "en" ? "en" : "zh"),   // normalization is your job; the kit never guesses
  records: () => normalizeRows(tickets),         // empty array short-circuits to `empty`
  stats: computeStats,                           // numbers are computed by code, never by the model
});

ctrl.subscribe((state) => {
  // state.status: idle | empty | pending | ok | error
  if (state.status === "ok") render(state.result); // refs render as clickable citations
});
ctrl.refresh();                                  // refresh(true) bypasses the cache
```

Controller behavior you get for free:

- **Cache first** — key = identity | scope | content hash | language | schemaVersion; TTL from the scene
- **Debounce** — bursts of refresh calls collapse into one generation (default 1500ms)
- **Single-flight** — stale generations are discarded, never overwrite newer results
- **No cache on failure** — a failed generation is retried on the next trigger
- **Soft-fail** — malformed items are dropped, valid ones survive; only structural failures error out

> Security note: direct browser transport puts your API key in the client — fine for local tools, internal apps and prototypes; for multi-user production, proxy through your backend instead.

### Step 4: gate quality with a golden eval

Create `evals/ticketSummary.golden.test.ts` — real data snapshots + replayed model outputs + assertions:

```ts
import { runCases, assertLangIs, assertRefsSubset, assertCovers } from "ai-kit/eval";

const report = await runCases([
  {
    name: "zh mode outputs Chinese + citations legal",
    lang: "zh",
    input: { records: snapshot },                 // real data snapshot
    mockOutput: mockModelJson,                    // replayed model output, zero tokens
    asserts: [assertLangIs("zh"), assertRefsSubset(ids), assertCovers(["rollback"])],
  },
  // soft-fail / structure-error / fabricated-id cases — see evals/ticket.golden.test.ts
], { scene: ticketSummary });

expect(report.passed).toBe(report.total);         // all green = integration done
```

Built-in assertion helpers: `assertLangIs`, `assertNounsVerbatim`, `assertRefsSubset`, `assertCovers`, `assertNoError`. After this, every prompt tweak or model swap is a seconds-level regression.

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

- `DataProfile` format or output-contract change → **major**
- New guards / assertion helpers → **minor**
- Prompt wording changes → **patch**, and must pass the golden gate before release
