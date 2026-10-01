<div align="center">

# ai-kit

**Embed AI into your product as typed functions, not chat.**

[![npm version](https://img.shields.io/npm/v/ai-kit.svg)](https://www.npmjs.com/package/ai-kit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)
<!-- After creating the GitHub repo, uncomment and replace YOUR_USERNAME:
[![CI](https://github.com/YOUR_USERNAME/ai-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/ai-kit/actions/workflows/ci.yml)
-->

[English](./README.md) | [简体中文](./README.zh-CN.md)

</div>

ai-kit is a zero-dependency, framework-agnostic TypeScript runtime for the AI features that are **not** chatbots — summaries, scores, recommendations, extractions: single-step calls with structured output.

You describe *what the AI should do* and *what your data means*. The kit handles the rest of the pipeline: prompt assembly, model call, hallucination guards, caching, and regression testing.

## A taste

```ts
import { defineAiScene, createOpenAiCompatibleTransport, createSceneController } from "ai-kit";

// 1. Declare what the AI should do
const scene = defineAiScene({
  id: "ticket_summary",
  output: { kind: "sections", sections: ["summary", "actions", "risks"] },
  prompt: { role: "You are a support assistant.", task: "Summarize the given tickets." },
});

// 2. Wire it up — model, cache, identity, language
const ctrl = createSceneController({
  scene,
  transport: createOpenAiCompatibleTransport({
    baseUrl: "https://api.deepseek.com/v1",
    headers: { authorization: `Bearer ${KEY}` },
  }),
  store: createMemoryStore(),
  identity: () => user.id,   // cache-key only, never in prompt
  scope: () => teamName,
  lang: () => "en",
  records: () => tickets,
});

// 3. Render — strongly-typed, citation-checked output
ctrl.subscribe((state) => {
  if (state.status === "ok") render(state.result);
});
ctrl.refresh();
```

Every claim in the output carries `refs` back to the input records. Numbers are computed by your code, never by the model. Malformed items are dropped while the rest survives.

## Why ai-kit?

- **Semantic contracts** — field meanings, fallback rules and locale facts injected into prompts, so the AI actually understands your data instead of guessing
- **Seven mandatory invariants** — anti-hallucination guards enforced at prompt and parse level; consumers can add rules, never remove them
- **Golden evals** — replay-based quality gates with zero tokens; every prompt tweak or model swap is a seconds-level regression, not a page-refresh guessing game
- **Plumbing included** — cache keyed by identity + scope + content + language, debounce, single-flight, soft-fail: the code you rewrite for every AI feature, written once

## Getting started

```bash
npm install ai-kit
```

1. **Describe your data** — write a `DataProfile` file: field meanings, fallback rules, PII
2. **Declare a scene** — `defineAiScene({ id, output, prompt, profile })`, about 40 lines
3. **Wire the controller** — `createSceneController({ scene, transport, store, ... })`, render in any framework
4. **Gate quality** — add golden cases with `runCases`, run them in CI

Full walkthrough with copy-paste snippets: **[guide.md](./docs/guide.md)**

## Connect to any model

Any OpenAI-compatible endpoint works out of the box — OpenAI, DeepSeek, Moonshot, Ollama, vLLM:

```ts
createOpenAiCompatibleTransport({ baseUrl: "https://api.deepseek.com/v1", headers: { authorization: `Bearer ${key}` } })
```

Prefer keys to stay on your server? Proxy through your backend with `createApiTransport(send)`, or implement the one-method `AiTransport` interface yourself.

## Documentation

- [Full guide (English)](./docs/guide.md) · [完整指南（中文）](./docs/guide.zh-CN.md)
- [The seven mandatory invariants](./docs/guide.md#the-seven-mandatory-invariants)

## Development

```bash
pnpm install
pnpm test       # 44 tests, including the 5-case golden gate
pnpm build      # tsdown: esm + cjs + d.ts
pnpm typecheck
```

## License

[MIT](./LICENSE)
