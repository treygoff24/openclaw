import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../auto-reply/templating.js";

const mocks = vi.hoisted(() => ({
  recordSessionMetaFromInbound: vi.fn().mockResolvedValue(null),
  updateLastRoute: vi.fn().mockResolvedValue(null),
}));

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    recordSessionMetaFromInbound: mocks.recordSessionMetaFromInbound,
    updateLastRoute: mocks.updateLastRoute,
  };
});

const makeCtx = (id: string): MsgContext => ({ from: `user-${id}` }) as unknown as MsgContext;

async function loadRecordInboundSession() {
  const mod = await import("./session.js");
  return mod.recordInboundSession;
}

describe("recordInboundSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.recordSessionMetaFromInbound.mockReset().mockResolvedValue(null);
    mocks.updateLastRoute.mockReset().mockResolvedValue(null);
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("coalesces repeated metadata writes for the same session key", async () => {
    vi.stubEnv("OPENCLAW_SESSION_META_DEBOUNCE_MS", "50");
    const recordInboundSession = await loadRecordInboundSession();

    await recordInboundSession({
      storePath: "/tmp/store.json",
      sessionKey: "agent:main:telegram:dm:1",
      ctx: makeCtx("a"),
      onRecordError: vi.fn(),
    });
    await recordInboundSession({
      storePath: "/tmp/store.json",
      sessionKey: "agent:main:telegram:dm:1",
      ctx: makeCtx("b"),
      onRecordError: vi.fn(),
    });
    await recordInboundSession({
      storePath: "/tmp/store.json",
      sessionKey: "agent:main:telegram:dm:1",
      ctx: makeCtx("c"),
      onRecordError: vi.fn(),
    });

    expect(mocks.recordSessionMetaFromInbound).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(49);
    expect(mocks.recordSessionMetaFromInbound).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.recordSessionMetaFromInbound).toHaveBeenCalledTimes(1);
    expect(mocks.recordSessionMetaFromInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        storePath: "/tmp/store.json",
        sessionKey: "agent:main:telegram:dm:1",
        ctx: expect.objectContaining({ from: "user-c" }),
      }),
    );
  });

  it("keeps updateLastRoute behavior immediate and awaited", async () => {
    vi.stubEnv("OPENCLAW_SESSION_META_DEBOUNCE_MS", "100");
    const recordInboundSession = await loadRecordInboundSession();

    const promise = recordInboundSession({
      storePath: "/tmp/store.json",
      sessionKey: "agent:main:telegram:dm:2",
      ctx: makeCtx("route"),
      updateLastRoute: {
        sessionKey: "agent:main:telegram:dm:main",
        channel: "telegram",
        to: "telegram:123",
        accountId: "default",
        threadId: "42",
      },
      onRecordError: vi.fn(),
    });

    expect(mocks.updateLastRoute).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toBeUndefined();

    expect(mocks.recordSessionMetaFromInbound).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.recordSessionMetaFromInbound).toHaveBeenCalledTimes(1);
  });

  it("disables coalescing when debounce is zero", async () => {
    vi.stubEnv("OPENCLAW_SESSION_META_DEBOUNCE_MS", "0");
    const recordInboundSession = await loadRecordInboundSession();

    await recordInboundSession({
      storePath: "/tmp/store.json",
      sessionKey: "agent:main:telegram:dm:3",
      ctx: makeCtx("x"),
      onRecordError: vi.fn(),
    });
    await recordInboundSession({
      storePath: "/tmp/store.json",
      sessionKey: "agent:main:telegram:dm:3",
      ctx: makeCtx("y"),
      onRecordError: vi.fn(),
    });

    expect(mocks.recordSessionMetaFromInbound).toHaveBeenCalledTimes(2);
  });
});
