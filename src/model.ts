import type { Model } from "./types";

export interface OpenAiOptions {
  /** 模型名，如 "deepseek-chat" / "gpt-4o-mini" */
  model: string;
  /** 默认 https://api.openai.com/v1 ；DeepSeek/Moonshot/Ollama/vLLM 换这里即可 */
  baseURL?: string;
  /** API key；本地 Ollama 可省略 */
  apiKey?: string;
  /** 额外请求头 */
  headers?: Record<string, string>;
  /** 请求超时毫秒数，默认 60000 */
  timeoutMs?: number;
  /** 合并进请求体（如 { temperature: 0.2 }） */
  extraBody?: Record<string, unknown>;
}

export class TruncatedOutputError extends Error {
  constructor() {
    super("model output was truncated (finish_reason=length); the JSON is incomplete");
    this.name = "TruncatedOutputError";
  }
}

/**
 * 内置的 OpenAI 兼容 model：OpenAI / DeepSeek / Moonshot / Ollama / vLLM 开箱即用。
 * 其他 SDK（anthropic、ai SDK 等）请用它们自己的 client 写一个 2 行的 Model 函数。
 */
export function openai(opts: OpenAiOptions): Model {
  const base = (opts.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    ...opts.headers,
  };
  const timeoutMs = opts.timeoutMs ?? 60_000;

  return async ({ system, prompt }: { system: string; prompt: string }) => {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new Error(`request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
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
      return content;
    } finally {
      clearTimeout(timer);
    }
  };
}
