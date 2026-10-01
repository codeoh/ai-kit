# ai-kit

**Embed AI into your product as typed functions, not chat.**

`ai-kit` is a zero-dependency, framework-agnostic TypeScript runtime for a class of AI features that is *not* a chatbot: single-step, structured-output, strongly-validated calls like summaries, scores, recommendations and extractions. You declare a **scene** (what the AI does), a **semantic contract** (what your data means), and a **golden eval** (how quality is gated) — the kit handles the pipeline: prompt assembly, model call, anti-hallucination guards, caching, soft-failure, and regression testing.

[中文文档](./README.zh-CN.md)

## Why not just call the LLM SDK?

Because every embedded AI feature pays the same four taxes again and again:

| Tax | What it looks like | ai-kit's answer |
|---|---|---|
| Contract discovery | API doesn't return the field you grouped by; locale codes silently mismatch | **Semantic contract** (`DataProfile`) with fallback rules and locale facts, injected into prompts |
| Prompt debugging loop | change prompt → refresh page → squint at output, minutes per cycle | **Golden eval**: replay-based assertions, seconds per cycle, zero tokens |
| Hallucination | invented numbers, invented citations | **Seven mandatory invariants**: program-computed stats, `refs` whitelist, verbatim proper nouns, soft-fail… |
| Rewritten plumbing | cache / debounce / abort / retry per feature | **Scene controller**: cache-first, debounce, single-flight, no-cache-on-fail |

## The five decisions (the whole integration)

> Review rule: any decision a consumer cannot make without reading the source is a design flaw.

| # | Decision | Entry point |
|---|---|---|
| 1 | How to reach the model? | Three options: `createOpenAiCompatibleTransport({ baseUrl, headers })` — direct to any OpenAI-compatible endpoint (OpenAI / DeepSeek / Moonshot / Ollama / vLLM…); `createApiTransport(send)` — through your backend proxy; or implement `AiTransport` yourself. The kit never stores keys — where they live is your call |
| 2 | Where to cache results? | `createMemoryStore()` or `createLocalStorageStore(prefix?)` |
| 3 | What does the AI do and return? | `defineAiScene({ id, output, prompt })` — ~40 lines |
| 4 | What do your fields mean? | `DataProfile` file kept in **your** repo (`profiles/<entity>.json`) |
| 5 | How is quality gated? | Seven mandatory invariants (cannot be disabled) + `runCases` golden eval (zero tokens) |

## Install

```bash
npm install ai-kit
```

Node >= 18. Runs in browsers and Node; TypeScript types included.

## Quickstart

**1. Declare a semantic contract** — what the AI must understand about your data:

```jsonc
// profiles/ticket.json
{
  "entity": "ticket",
  "fields": [
    { "name": "id", "meaning": "Ticket unique id, the only legal value for refs", "authoritative": true },
    { "name": "body", "meaning": "Ticket body, may be written in English" },
    { "name": "team", "meaning": "Owning team name, the grouping key", "authoritative": true },
    { "name": "slaHours", "meaning": "Resolved SLA in hours",
      "fallback": "List API does not return this field; compute on the client. Never let the model guess numbers." }
  ],
  "localeFacts": ["Ticket body may be in English; when lang=zh it must be translated"]
}
```

**2. Declare a scene** — one AI feature = one declaration:

```ts
import { defineAiScene, validateDataProfile } from "ai-kit";
import ticketProfile from "./profiles/ticket.json";

export const ticketSummary = defineAiScene({
  id: "ticket_summary",
  output: { kind: "sections", sections: ["summary", "actions", "risks"] },
  prompt: { role: "You are a support-team assistant.", task: "Summarize the given tickets." },
  profile: validateDataProfile(ticketProfile),
  cache: { ttlMs: 7 * 864e5, schemaVersion: 1 },
});
```

Two built-in output kinds cover most single-step features: `sections` (grouped `{text, refs}[]`) and `dimensions` (`{score, reason, refs}`). Multi-turn chat is out of scope by design.

**3. Wire the controller into your UI** (any framework — the kit is UI-free):

```ts
import { createApiTransport, createLocalStorageStore, createSceneController } from "ai-kit";

const ctrl = createSceneController({
  scene: ticketSummary,
  // Option A: direct — one line, works with any OpenAI-compatible endpoint:
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
  records: () => tickets,                        // empty array short-circuits to `empty`
  stats: computeStats,                           // numbers are computed by code, never by the model
});

ctrl.subscribe((state) => {
  // state.status: idle | empty | pending | ok | error
  if (state.status === "ok") render(state.result); // refs render as clickable citations
});
ctrl.refresh();                                  // refresh(true) bypasses cache
```

**4. Gate quality with a golden eval** — real data snapshots + replayed model outputs + assertions, zero tokens, runs in CI:

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
  // soft-fail / structure error / fabricated-id cases — see evals/ticket.golden.test.ts
], { scene: ticketSummary });

expect(report.passed).toBe(report.total); // all green = integration done
```

> Direct browser transport puts your API key in the client — fine for local tools, internal apps and prototypes; for multi-user production, proxy through your backend instead.

From now on, every prompt tweak or model swap is a seconds-level regression instead of a page-refresh guessing game.

## The seven mandatory invariants

Injected into every system prompt and enforced again at parse time; consumers can add rules but never remove these:

1. Output language = `lang`, regardless of input language (with explicit translation requirement)
2. Proper nouns (names, products, ticket ids, numbers) stay verbatim
3. Statistics are never produced by the model — only quoted from program-computed stats
4. `refs` may only reference input record ids (whitelist enforced; fabricated ids dropped)
5. Nothing to say → empty arrays; fabrication forbidden
6. Output one compact JSON object only
7. One sentence per item, no numbering

## How it relates to MCP

One shared asset: the semantic contract. `ai-kit` injects it into prompts; an MCP server (your P2) serves the same file as a resource and exposes scenes as tools. The discipline that makes this work: **contracts are standalone data files, never welded into component code.**

## Development

```bash
pnpm install
pnpm test       # 44 tests, includes the 5-case golden gate
pnpm build      # tsup: esm + cjs + d.ts
pnpm typecheck
```

## License

[MIT](./LICENSE)
