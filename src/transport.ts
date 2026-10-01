export interface AiChatRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface AiChatResult {
  content: string;
  /** 后端报告输出被 max_tokens 截断 */
  truncated?: boolean;
}

export interface AiTransport {
  complete(req: AiChatRequest, opts?: { signal?: AbortSignal }): Promise<AiChatResult>;
}

export class TruncatedOutputError extends Error {
  constructor() {
    super("模型输出被 max_tokens 截断，无法保证 JSON 完整");
    this.name = "TruncatedOutputError";
  }
}

/**
 * 包装接口 transport：消费方给一个 send 映射到自家后端代理接口。
 * 鉴权/路由/key 全在服务端，包永不持有 key。
 */
export function createApiTransport(
  send: (req: AiChatRequest) => Promise<{ content: string; truncated?: boolean }>,
): AiTransport {
  return {
    async complete(req, opts) {
      void opts;
      const res = await send(req);
      if (res.truncated) throw new TruncatedOutputError();
      return { content: res.content };
    },
  };
}

export interface OpenAiCompatibleOptions {
  /** e.g. "https://api.openai.com/v1" — /chat/completions is appended */
  baseUrl: string;
  /** Auth is injected by the consumer (e.g. { authorization: "Bearer sk-..." }); the kit never stores keys */
  headers?: Record<string, string>;
  /** Defaults to "gpt-4o-mini" */
  model?: string;
  /** Defaults to 60000ms; aborts the request on timeout */
  timeoutMs?: number;
  /** Merged into the request body (e.g. { enable_thinking: false, temperature: 0.2 }) */
  extraBody?: Record<string, unknown>;
}

/**
 * Direct transport to any OpenAI-compatible /chat/completions endpoint
 * (OpenAI, DeepSeek, Moonshot, Ollama, vLLM, your own gateway...).
 * Where the key lives — browser (local tools, prototypes, internal apps)
 * or your backend (multi-user production) — is the consumer's call.
 */
export function createOpenAiCompatibleTransport(opts: OpenAiCompatibleOptions): AiTransport {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const model = opts.model ?? "gpt-4o-mini";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return {
    async complete(req, callOpts) {
      const ctrl = new AbortController();
      const timer = setTimeout(
        () => ctrl.abort(new Error(`request timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      const onOuterAbort = () => ctrl.abort(callOpts?.signal?.reason);
      callOpts?.signal?.addEventListener("abort", onOuterAbort, { once: true });
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...opts.headers },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
            ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
            ...opts.extraBody,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`LLM request failed: HTTP ${res.status} ${text.slice(0, 300)}`);
        }
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        };
        const choice = data.choices?.[0];
        const content = choice?.message?.content;
        if (typeof content !== "string") {
          throw new Error("LLM response missing choices[0].message.content");
        }
        if (choice?.finish_reason === "length") throw new TruncatedOutputError();
        return { content };
      } finally {
        clearTimeout(timer);
        callOpts?.signal?.removeEventListener("abort", onOuterAbort);
      }
    },
  };
}

/** mock transport：按序回放输出（eval 离线层零 token 回归），或按请求动态生成 */
export function createMockTransport(
  outputs: string[] | ((req: AiChatRequest) => string),
): AiTransport {
  let i = 0;
  return {
    async complete(req) {
      if (typeof outputs === "function") return { content: outputs(req) };
      const content = outputs[i] ?? "";
      i += 1;
      return { content };
    },
  };
}
