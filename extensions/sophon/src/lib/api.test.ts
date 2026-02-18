import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callSophonApi, isDateOnly, resolveClientConfig } from "./api.js";

const ORIGINAL_ENV = process.env;

describe("sophon api client", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.SOPHON_API_URL = "https://api.example.com";
    process.env.SOPHON_API_TOKEN = "token-123";
    process.env.SOPHON_API_TIMEOUT_MS = "30000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("resolves API configuration from env precedence", () => {
    process.env.SOPHON_API_URL = "https://api.primary.example";
    process.env.SOPHON_API_BASE_URL = "https://api.base.example";
    process.env.SOPHON_SUPABASE_URL = "https://api.supabase.example";

    const config = resolveClientConfig();
    expect(config.baseUrl).toBe("https://api.primary.example");
    expect(config.token).toBe("token-123");
  });

  it("falls back to SOPHON_API_BASE_URL before SUPABASE URL", () => {
    delete process.env.SOPHON_API_URL;
    process.env.SOPHON_API_BASE_URL = "https://api.base.example";
    process.env.SOPHON_SUPABASE_URL = "https://api.supabase.example";

    const config = resolveClientConfig();
    expect(config.baseUrl).toBe("https://api.base.example");
  });

  it("falls back from SUPABASE URL by appending functions path", () => {
    delete process.env.SOPHON_API_URL;
    delete process.env.SOPHON_API_BASE_URL;
    process.env.SOPHON_SUPABASE_URL = "https://project.supabase.co";

    const config = resolveClientConfig();
    expect(config.baseUrl).toBe("https://project.supabase.co");
  });

  it("uses SOPHON_USER_TOKEN when API token is missing", () => {
    delete process.env.SOPHON_API_TOKEN;
    process.env.SOPHON_USER_TOKEN = "fallback-token";

    const config = resolveClientConfig();
    expect(config.token).toBe("fallback-token");
  });

  it("builds API URL for /tasks list call", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{"tasks": []}'));

    await callSophonApi("GET", "tasks", {
      query: {
        status: "backlog",
        limit: 25,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const called = new URL(fetchMock.mock.calls[0][0] as string);
    expect(called.pathname).toBe("/functions/v1/api-v1/api/v1/tasks");
    expect(called.searchParams.get("status")).toBe("backlog");
    expect(called.searchParams.get("limit")).toBe("25");
  });

  it("appends auth and content headers", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{"tasks": []}'));

    await callSophonApi("GET", "/notes", {});

    const headers = fetchMock.mock.calls[0]?.[1]?.headers;
    if (!headers || headers instanceof Headers) {
      expect(headers?.get("Authorization")).toBe("Bearer token-123");
      expect(headers?.get("Content-Type")).toBe("application/json");
      return;
    }

    expect((headers as Record<string, string>)["Authorization"]).toBe("Bearer token-123");
    expect((headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("maps API error payload to message", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response('{"error":{"code":"INVALID_INPUT","message":"bad request"}}', {
        status: 400,
        statusText: "Bad Request",
      }),
    );

    await expect(callSophonApi("GET", "/dashboard")).rejects.toThrow(
      "Sophon API error: INVALID_INPUT: bad request",
    );
  });

  it("throws for unparsable response payload", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("<html/>", { status: 200 }));

    await expect(callSophonApi("GET", "/dashboard")).rejects.toThrow(
      "Sophon API error: Invalid API response format.",
    );
  });

  it("times out and throws request timeout", async () => {
    process.env.SOPHON_API_TIMEOUT_MS = "1";
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Operation aborted", "AbortError"));
        });
      });
    });

    await expect(callSophonApi("GET", "/dashboard")).rejects.toThrow(
      "Sophon API error: Request timed out.",
    );
  });

  it("validates date-only helper", () => {
    expect(isDateOnly("2025-02-05")).toBe(true);
    expect(isDateOnly("2025-02-31")).toBe(false);
    expect(isDateOnly("2025-2-5")).toBe(false);
  });

  it("errors when auth token missing", () => {
    delete process.env.SOPHON_API_TOKEN;
    delete process.env.SOPHON_USER_TOKEN;

    expect(() => resolveClientConfig()).toThrow("Missing SOPHON_API_TOKEN");
  });
});
