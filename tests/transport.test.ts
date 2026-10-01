import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleTransport, TruncatedOutputError } from "../src/transport";

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

describe("createOpenAiCompatibleTransport", () => {
  it("POSTs chat/completions with system+user messages, headers and extraBody", async () => {
    const fetchMock = okFetch('{"work":[]}');
    vi.stubGlobal("fetch", fetchMock);
    const transport = createOpenAiCompatibleTransport({
      baseUrl: "https://api.example.com/v1/",
      headers: { authorization: "Bearer sk-test" },
      model: "deepseek-chat",
      extraBody: { enable_thinking: false, temperature: 0.2 },
    });
    const r = await transport.complete({ system: "S", user: "U" });
    expect(r.content).toBe('{"work":[]}');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("deepseek-chat");
    expect(body.messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "U" },
    ]);
    expect(body.enable_thinking).toBe(false);
    expect(body.temperature).toBe(0.2);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  });

  it("maps finish_reason=length to TruncatedOutputError", async () => {
    vi.stubGlobal("fetch", okFetch('{"work":[{"te', "length"));
    const transport = createOpenAiCompatibleTransport({ baseUrl: "https://x/v1" });
    await expect(transport.complete({ system: "s", user: "u" })).rejects.toBeInstanceOf(
      TruncatedOutputError,
    );
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
    const transport = createOpenAiCompatibleTransport({ baseUrl: "https://x/v1" });
    await expect(transport.complete({ system: "s", user: "u" })).rejects.toThrow("HTTP 429");
  });

  it("missing choices[0].message.content is an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
        text: async () => "",
      })),
    );
    const transport = createOpenAiCompatibleTransport({ baseUrl: "https://x/v1" });
    await expect(transport.complete({ system: "s", user: "u" })).rejects.toThrow(
      "missing choices[0].message.content",
    );
  });

  it("honors caller AbortSignal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted by caller")),
            );
          }),
      ),
    );
    const transport = createOpenAiCompatibleTransport({ baseUrl: "https://x/v1" });
    const ctrl = new AbortController();
    const p = transport.complete({ system: "s", user: "u" }, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toThrow();
  });
});
