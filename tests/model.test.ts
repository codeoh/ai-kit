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
