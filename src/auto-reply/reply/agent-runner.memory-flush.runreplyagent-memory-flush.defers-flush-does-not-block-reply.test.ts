import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBaseRun,
  getRunEmbeddedPiAgentMock,
  runReplyAgentWithHarness,
  seedSessionStore,
  waitForScheduledMemoryFlush,
  type EmbeddedRunParams,
} from "./agent-runner.memory-flush.test-harness.js";
import { DEFAULT_MEMORY_FLUSH_PROMPT } from "./memory-flush.js";

describe("runReplyAgent memory flush", () => {
  it("returns the turn reply before a pending memory flush finishes", async () => {
    const runEmbeddedPiAgentMock = getRunEmbeddedPiAgentMock();
    runEmbeddedPiAgentMock.mockReset();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-flush-"));
    const storePath = path.join(tmp, "sessions.json");
    const sessionKey = "main";
    const sessionEntry = {
      sessionId: "session",
      updatedAt: Date.now(),
      totalTokens: 80_000,
      compactionCount: 1,
    };

    await seedSessionStore({ storePath, sessionKey, entry: sessionEntry });

    let resolveFlush:
      | ((value: { payloads: unknown[]; meta: Record<string, unknown> }) => void)
      | undefined;
    const flushPromise = new Promise<{ payloads: unknown[]; meta: Record<string, unknown> }>(
      (resolve) => {
        resolveFlush = resolve;
      },
    );

    runEmbeddedPiAgentMock.mockImplementation(async (params: EmbeddedRunParams) => {
      if (params.prompt === DEFAULT_MEMORY_FLUSH_PROMPT) {
        return await flushPromise;
      }
      return {
        payloads: [{ text: "ok" }],
        meta: { agentMeta: { usage: { input: 1, output: 1 } } },
      };
    });

    const { typing, sessionCtx, resolvedQueue, followupRun } = createBaseRun({
      storePath,
      sessionEntry,
    });

    const runPromise = runReplyAgentWithHarness({
      commandBody: "hello",
      followupRun,
      queueKey: "main",
      resolvedQueue,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      typing,
      sessionCtx,
      sessionEntry,
      sessionStore: { [sessionKey]: sessionEntry },
      sessionKey,
      storePath,
      defaultModel: "anthropic/claude-opus-4-5",
      agentCfgContextTokens: 100_000,
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    });

    const settled = await Promise.race([
      runPromise.then(() => "returned"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 1_200)),
    ]);
    expect(settled).toBe("returned");

    const storedBeforeFlush = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(storedBeforeFlush[sessionKey].memoryFlushAt).toBeUndefined();

    resolveFlush?.({ payloads: [], meta: {} });
    await waitForScheduledMemoryFlush(sessionKey);

    const storedAfterFlush = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(storedAfterFlush[sessionKey].memoryFlushAt).toBeTypeOf("number");
  });
});
