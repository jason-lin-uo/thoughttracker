import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError } from "../../src/lib/api";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("api client", () => {
  it("get returns parsed JSON on 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ x: 1 }),
    } as unknown as Response) as typeof fetch;
    const r = await api.get<{ x: number }>("/test");
    expect(r).toEqual({ x: 1 });
  });

  it("get encodes query params + skips undefined/empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "{}",
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    await api.get("/test", { a: "x", b: undefined, c: "", d: 3 });
    const call = fetchMock.mock.calls[0]![0] as string;
    expect(call).toContain("a=x");
    expect(call).toContain("d=3");
    expect(call).not.toContain("b=");
    expect(call).not.toContain("c=");
  });

  it("post sends JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    const r = await api.post<{ ok: boolean }>("/test", { a: 1 });
    expect(r.ok).toBe(true);
    const call = fetchMock.mock.calls[0]![1] as {
      method?: string;
      body?: string;
    };
    expect(call.method).toBe("POST");
    expect(JSON.parse(call.body!)).toEqual({ a: 1 });
  });

  it("post merges custom headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "{}",
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    await api.post("/test", { a: 1 }, { headers: { "X-Admin-Pin": "2468" } });
    const call = fetchMock.mock.calls[0]![1] as {
      headers?: Record<string, string>;
    };
    expect(call.headers).toEqual({
      "Content-Type": "application/json",
      "X-Admin-Pin": "2468",
    });
  });

  it("post without body sends no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "{}",
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    await api.post("/test");
    const call = fetchMock.mock.calls[0]![1] as { body?: string };
    expect(call.body).toBeUndefined();
  });

  it("throws ApiError on non-ok response with the backend message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({ error: "NOT_FOUND", message: "missing" }),
    } as unknown as Response) as typeof fetch;
    await expect(api.get("/x")).rejects.toThrow("missing");
  });

  it("falls back to the backend error code when no message is present", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: "FORBIDDEN" }),
    } as unknown as Response) as typeof fetch;
    await expect(api.get("/x")).rejects.toThrow("FORBIDDEN");
  });

  it("throws ApiError with default HTTP message when body has no error field", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "",
    } as unknown as Response) as typeof fetch;
    await expect(api.get("/x")).rejects.toThrow("HTTP 500");
  });

  it("ApiError carries status + details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 418,
      text: async () => JSON.stringify({ error: "teapot", details: { x: 1 } }),
    } as unknown as Response) as typeof fetch;
    try {
      await api.get("/x");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(418);
      expect((e as ApiError).details).toBeDefined();
    }
  });

  it("handles non-JSON response text gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "not-json",
    } as unknown as Response) as typeof fetch;
    const r = await api.get("/x");
    expect(r).toBe("not-json");
  });

  it("absolute URLs are not prefixed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "{}",
    } as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;
    await api.get("http://other.example/abs");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://other.example/abs");
  });
});
