import { afterEach, describe, expect, it, vi } from "vitest";
import { openai, TruncatedOutputError, type Model } from "../src";

function okFetch(content: string, finishReason = "stop") {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content }, finish_reason: finishReason }] }),
    text: async () => "",
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai()", () => {
  it("POSTs chat/completions with system+user messages, auth header and extraBody", async () => {
    const fetchMock = okFetch('{"summary":[]}');
    vi.stubGlobal("fetch", fetchMock);
    const model: Model = openai({
      model: "deepseek-chat",
      baseURL: "https://api.example.com/v1/",
      apiKey: "sk-test",
      extraBody: { temperature: 0.2 },
    });
    const r = await model({ system: "S", prompt: "U" });
    expect(r).toBe('{"summary":[]}');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("deepseek-chat");
    expect(body.messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "U" },
    ]);
    expect(body.temperature).toBe(0.2);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  });

  it("works without apiKey (local Ollama)", async () => {
    const fetchMock = okFetch("hi");
    vi.stubGlobal("fetch", fetchMock);
    const model: Model = openai({ model: "llama3", baseURL: "http://localhost:11434/v1" });
    await model({ system: "s", prompt: "u" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("maps finish_reason=length to TruncatedOutputError", async () => {
    vi.stubGlobal("fetch", okFetch('{"summary":[{"te', "length"));
    const model: Model = openai({ model: "gpt-4o-mini" });
    await expect(model({ system: "s", prompt: "u" })).rejects.toBeInstanceOf(TruncatedOutputError);
  });

  it("surfaces HTTP errors with status and body snippet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => "rate limited",
      })),
    );
    const model: Model = openai({ model: "gpt-4o-mini" });
    await expect(model({ system: "s", prompt: "u" })).rejects.toThrow("HTTP 429");
  });
});

const schema = { name: "demo", node: { type: "object" as const } };

/** 造一个"按档位决定成败"的 fetch：用来验证降级链 */
function tieredFetch(tiers: Array<"ok" | "reject">) {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const tier = tiers[Math.min(i, tiers.length - 1)];
    i += 1;
    if (tier === "ok") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"summary":[]}' }, finish_reason: "stop" }] }),
        text: async () => "",
      };
    }
    return {
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => "response_format is not supported by this endpoint",
    };
  });
  return { fn, bodies };
}

describe("structured 三档降级", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("默认发 json_schema（strict）", async () => {
    const { fn, bodies } = tieredFetch(["ok"]);
    vi.stubGlobal("fetch", fn);
    const model = openai({ model: "gpt-4o-mini" });
    await model({ system: "s", prompt: "p", jsonSchema: schema });
    expect((bodies[0].response_format as { type: string }).type).toBe("json_schema");
    expect((bodies[0].response_format as { json_schema: { strict: boolean } }).json_schema.strict).toBe(true);
  });

  it("端点不认 json_schema 时降级到 json_object", async () => {
    const { fn, bodies } = tieredFetch(["reject", "ok"]);
    vi.stubGlobal("fetch", fn);
    const model = openai({ model: "deepseek-chat" });
    const r = await model({ system: "s", prompt: "p", jsonSchema: schema });
    expect(r).toBe('{"summary":[]}');
    expect((bodies[0].response_format as { type: string }).type).toBe("json_schema");
    expect((bodies[1].response_format as { type: string }).type).toBe("json_object");
  });

  it("两档都不认时降级到纯提示词，且请求体里没有 response_format", async () => {
    const { fn, bodies } = tieredFetch(["reject", "reject", "ok"]);
    vi.stubGlobal("fetch", fn);
    const model = openai({ model: "old-ollama" });
    const r = await model({ system: "s", prompt: "p", jsonSchema: schema });
    expect(r).toBe('{"summary":[]}');
    expect(bodies).toHaveLength(3);
    expect(bodies[2].response_format).toBeUndefined();
  });

  it("降级结果被记住：第二次调用不再试探 json_schema", async () => {
    const { fn, bodies } = tieredFetch(["reject", "ok"]);
    vi.stubGlobal("fetch", fn);
    const model = openai({ model: "deepseek-chat" });
    await model({ system: "s", prompt: "p", jsonSchema: schema });
    await model({ system: "s", prompt: "p", jsonSchema: schema });
    // 第一次 2 次调用（L1 失败 + L2 成功），第二次只 1 次（直接 L2）
    expect(bodies).toHaveLength(3);
    expect((bodies[2].response_format as { type: string }).type).toBe("json_object");
  });

  it("structured: false 时请求体完全不带 response_format", async () => {
    const { fn, bodies } = tieredFetch(["ok"]);
    vi.stubGlobal("fetch", fn);
    const model = openai({ model: "gpt-4o-mini", structured: false });
    await model({ system: "s", prompt: "p", jsonSchema: schema });
    expect(bodies[0].response_format).toBeUndefined();
  });

  it("5xx 不算不支持，直接抛错不降级", async () => {
    const fn = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "upstream unavailable",
    }));
    vi.stubGlobal("fetch", fn);
    const model = openai({ model: "gpt-4o-mini" });
    await expect(model({ system: "s", prompt: "p", jsonSchema: schema })).rejects.toThrow("HTTP 503");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("没有 jsonSchema 时不发 response_format（自写适配器场景）", async () => {
    const { fn, bodies } = tieredFetch(["ok"]);
    vi.stubGlobal("fetch", fn);
    const model = openai({ model: "gpt-4o-mini" });
    await model({ system: "s", prompt: "p" });
    expect(bodies[0].response_format).toBeUndefined();
  });
});

describe("AbortSignal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signal 透传给 fetch", async () => {
    const fn = okFetch("hi");
    vi.stubGlobal("fetch", fn);
    const ctrl = new AbortController();
    const model = openai({ model: "gpt-4o-mini" });
    await model({ system: "s", prompt: "p", signal: ctrl.signal });
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeDefined();
  });

  it("调用方中断时请求原样失败，不被包装成 HTTP 错误", async () => {
    const ctrl = new AbortController();
    const fn = vi.fn(async () => {
      ctrl.abort();
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    });
    vi.stubGlobal("fetch", fn);
    const model = openai({ model: "gpt-4o-mini" });
    await expect(model({ system: "s", prompt: "p", signal: ctrl.signal })).rejects.toThrow(
      "The operation was aborted",
    );
  });
});
