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
