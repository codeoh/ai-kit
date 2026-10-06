import type { Model, ModelRequest } from "./types";
import type { JsonSchemaNode } from "./schema";

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
  /**
   * 是否使用结构化输出，默认 true。
   *
   * true 时按 json_schema → json_object →纯提示词三档自动降级，
   * 降级结果记在本model 实例的闭包里，后续调用不再重复试探。
   * false 时请求体里完全不带 response_format（某些内部代理会拦截未知字段）。
   *
   * 注意：本选项只影响"发什么"，不影响"结果怎么处理"。
   * 无论开关如何，结构整体坏掉都照旧抛 SceneStructureError。
   */
  structured?: boolean;
}

export class TruncatedOutputError extends Error {
  constructor() {
    super("model output was truncated (finish_reason=length); the JSON is incomplete");
    this.name = "TruncatedOutputError";
  }
}

/** 结构约束强度：L1 严格 schema / L2 合法 JSON / L3 纯提示词 */
type Level = 1 | 2 | 3;

/** 端点是否认识 response_format / json_schema：只认 4xx + 错误信息里明确提到字段名 */
function isStructuredUnsupported(status: number, body: string): boolean {
  if (status < 400 || status >= 500) return false;
  return /response_format|json_schema|structured output/i.test(body);
}

function responseFormatFor(
  level: Level,
  schema: { name: string; node: JsonSchemaNode } | undefined,
): Record<string, unknown> | undefined {
  if (level === 3 || !schema) return undefined;
  if (level === 1) {
    return {
      type: "json_schema",
      json_schema: { name: schema.name, strict: true, schema: schema.node },
    };
  }
  return { type: "json_object" };
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
  // 能力探测结果存在闭包里：降级一次，之后直接走已知可用档位。
  // 已知取舍——若端点是间歇性故障，首次失败后本实例永久降级；
  // 换baseURL 或新建 model 实例可重置。
  let level: Level = opts.structured === false ? 3 : 1;

  async function call(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new Error(`request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    // 调用方的 signal 与内部超时，任一触发即中断
    const onAbort = () => ctrl.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  return async (req: ModelRequest): Promise<string> => {
    const build = (lvl: Level): Record<string, unknown> => {
      const rf = responseFormatFor(lvl, req.jsonSchema);
      return {
        model: opts.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
        ...(rf ? { response_format: rf } : {}),
        ...opts.extraBody,
      };
    };

    // 降级探测：端点不认识结构化字段就退一档，并记住不再试探。
    // 用循环而不是 if——L1 降到 L2 后如果 L2 也被拒，还要再降到 L3。
    let res = await call(build(level), req.signal);
    while (!res.ok && level < 3) {
      const errText = await res.text().catch(() => "");
      if (!isStructuredUnsupported(res.status, errText)) {
        throw new Error(`LLM request failed: HTTP ${res.status} ${errText.slice(0, 300)}`);
      }
      level = (level + 1) as Level;
      res = await call(build(level), req.signal);
    }

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
  };
}
