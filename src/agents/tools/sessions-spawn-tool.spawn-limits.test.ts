import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";

const callGatewayMock = vi.fn();
const onAgentEventMock = vi.fn(() => () => {});
const loadSubagentRegistryFromDiskMock = vi.fn(() => new Map());
const saveSubagentRegistryToDiskMock = vi.fn(() => {});

vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: OpenClawConfig = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
};

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
  };
});

vi.mock("../../infra/agent-events.js", () => ({
  onAgentEvent: (...args: unknown[]) => onAgentEventMock(...args),
}));

vi.mock("../subagent-registry.store.js", () => ({
  loadSubagentRegistryFromDisk: () => loadSubagentRegistryFromDiskMock(),
  saveSubagentRegistryToDisk: (...args: unknown[]) => saveSubagentRegistryToDiskMock(...args),
}));

vi.mock("../subagent-announce.js", () => ({
  buildSubagentSystemPrompt: vi.fn(() => "subagent-system-prompt"),
  runSubagentAnnounceFlow: vi.fn(async () => true),
}));

import {
  addSubagentRunForTests,
  getActiveChildCount,
  getRunById,
  releaseChildSlot,
  releaseProviderSlot,
  reserveChildSlot,
  reserveProviderSlot,
  resetSubagentRegistryForTests,
} from "../subagent-registry.js";
import { createSessionsSpawnTool } from "./sessions-spawn-tool.js";

function baseConfig(): OpenClawConfig {
  return {
    session: {
      mainKey: "main",
      scope: "per-sender",
    },
    agents: {
      list: [{ id: "main", subagents: { maxChildrenPerAgent: 1 } }],
    },
  };
}

function createTool(agentSessionKey = "main") {
  return createSessionsSpawnTool({
    agentSessionKey,
    agentChannel: "discord",
  });
}

beforeEach(() => {
  configOverride = baseConfig();
  callGatewayMock.mockReset();
  onAgentEventMock.mockReset();
  loadSubagentRegistryFromDiskMock.mockReset();
  loadSubagentRegistryFromDiskMock.mockReturnValue(new Map());
  saveSubagentRegistryToDiskMock.mockReset();
  resetSubagentRegistryForTests({ persist: false });
});

afterEach(() => {
  resetSubagentRegistryForTests({ persist: false });
  callGatewayMock.mockReset();
  onAgentEventMock.mockReset();
  loadSubagentRegistryFromDiskMock.mockReset();
  saveSubagentRegistryToDiskMock.mockReset();
});

describe("sessions_spawn parent limits + target validation", () => {
  it("returns blocked when parent has maxChildrenPerAgent active children", async () => {
    addSubagentRunForTests({
      runId: "active-1",
      childSessionKey: "agent:main:subagent:active-1",
      requesterSessionKey: "main",
      requesterDisplayKey: "main",
      task: "already running",
      cleanup: "keep",
      createdAt: Date.now(),
    });

    const result = await createTool().execute("call-parent-limit", {
      task: "new task",
    });

    expect(result.details).toMatchObject({
      status: "blocked",
      reason: "parent_limit",
    });
    expect(String((result.details as { error?: unknown }).error)).toContain("1/1");
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("allows spawn when previous children have completed", async () => {
    addSubagentRunForTests({
      runId: "done-1",
      childSessionKey: "agent:main:subagent:done-1",
      requesterSessionKey: "main",
      requesterDisplayKey: "main",
      task: "finished",
      cleanup: "keep",
      createdAt: Date.now() - 1000,
      endedAt: Date.now(),
    });

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-after-complete" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });

    const result = await createTool().execute("call-after-complete", {
      task: "new task",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      runId: "run-after-complete",
    });
  });

  it("persists verification payload and original spawn params on the run record", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-with-verification" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });

    const verification = {
      artifacts: [{ path: "out/report.json", json: true, minItems: 1, requiredKeys: ["id"] }],
      requireCompletionReport: true,
      onFailure: "retry_once",
      verificationTimeoutMs: 45000,
    } as const;

    const result = await createTool().execute("call-with-verification", {
      task: "new verified task",
      verification,
      model: "openai/gpt-5",
      thinking: "medium",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      runId: "run-with-verification",
    });

    const run = getRunById("run-with-verification");
    expect(run?.verification).toMatchObject(verification);
    expect(run?.verificationState).toBe("pending");
    expect(run?.originalSpawnParams?.verification).toMatchObject(verification);
    expect(run?.originalSpawnParams?.modelOverride).toBe("openai/gpt-5");
    expect(run?.originalSpawnParams?.thinkingOverrideRaw).toBe("medium");
  });

  it("blocks spawn when provider concurrency cap is reached", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        defaults: {
          subagents: {
            providerLimits: {
              openai: 1,
              unknown: 3,
            },
          },
        },
        list: [{ id: "main", subagents: { maxChildrenPerAgent: 3 } }],
      },
    };

    addSubagentRunForTests({
      runId: "openai-active",
      childSessionKey: "agent:main:subagent:openai-active",
      requesterSessionKey: "main",
      requesterDisplayKey: "main",
      task: "already running",
      cleanup: "keep",
      createdAt: Date.now(),
      provider: "openai",
    });

    const result = await createTool().execute("call-provider-limit", {
      task: "new task",
      model: "openai/gpt-5",
    });

    expect(result.details).toMatchObject({
      status: "blocked",
      reason: "provider_limit",
      provider: "openai",
      active: 1,
      pending: 0,
      used: 1,
      maxConcurrent: 1,
    });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("counts provider usage from restored registry runs before reserving", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        defaults: {
          subagents: {
            providerLimits: {
              google: 1,
              unknown: 3,
            },
          },
        },
        list: [{ id: "main", subagents: { maxChildrenPerAgent: 5 } }],
      },
    };

    loadSubagentRegistryFromDiskMock.mockReturnValueOnce(
      new Map([
        [
          "google-restored",
          {
            runId: "google-restored",
            childSessionKey: "agent:main:subagent:restored-google",
            requesterSessionKey: "agent:other:main",
            requesterDisplayKey: "other",
            task: "restored",
            cleanup: "keep",
            createdAt: Date.now(),
            provider: "google",
          },
        ],
      ]),
    );

    const result = await createTool().execute("call-provider-limit-restored", {
      task: "new task",
      model: "google/gemini-3-pro-preview",
    });

    expect(result.details).toMatchObject({
      status: "blocked",
      reason: "provider_limit",
      provider: "google",
      active: 1,
      pending: 0,
      used: 1,
      maxConcurrent: 1,
    });
    const spawnCalls = callGatewayMock.mock.calls.filter(
      (call: unknown[]) => (call[0] as { method?: string })?.method === "agent",
    );
    expect(spawnCalls).toHaveLength(0);
  });

  it("applies provider limits independently per provider", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        defaults: {
          subagents: {
            providerLimits: {
              openai: 1,
              google: 1,
              unknown: 3,
            },
          },
        },
        list: [{ id: "main", subagents: { maxChildrenPerAgent: 3 } }],
      },
    };

    addSubagentRunForTests({
      runId: "openai-active-2",
      childSessionKey: "agent:main:subagent:openai-active-2",
      requesterSessionKey: "main",
      requesterDisplayKey: "main",
      task: "already running",
      cleanup: "keep",
      createdAt: Date.now(),
      provider: "openai",
    });

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-google-ok" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });

    const result = await createTool().execute("call-provider-isolation", {
      task: "new task",
      model: "google/gemini-3-pro-preview",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      runId: "run-google-ok",
    });
  });

  it("uses unknown provider bucket when provider cannot be resolved", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        defaults: {
          subagents: {
            providerLimits: {
              unknown: 1,
            },
          },
        },
        list: [{ id: "main", subagents: { maxChildrenPerAgent: 3 } }],
      },
    };

    addSubagentRunForTests({
      runId: "unknown-active",
      childSessionKey: "agent:main:subagent:unknown-active",
      requesterSessionKey: "main",
      requesterDisplayKey: "main",
      task: "already running",
      cleanup: "keep",
      createdAt: Date.now(),
      provider: "unknown",
    });

    const result = await createTool().execute("call-provider-unknown", {
      task: "new task",
      model: "gpt-5-mini",
    });

    expect(result.details).toMatchObject({
      status: "blocked",
      reason: "provider_limit",
      provider: "unknown",
      active: 1,
      pending: 0,
      used: 1,
      maxConcurrent: 1,
    });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("releases provider reservation when spawn fails", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        defaults: {
          subagents: {
            providerLimits: {
              openai: 1,
              unknown: 3,
            },
          },
        },
        list: [{ id: "main", subagents: { maxChildrenPerAgent: 3 } }],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        throw new Error("spawn failed");
      }
      return {};
    });

    const result = await createTool().execute("call-provider-failure-release", {
      task: "this will fail",
      model: "openai/gpt-5",
    });

    expect(result.details).toMatchObject({ status: "error" });
    const reservation = reserveProviderSlot("openai", 1);
    expect(reservation).not.toBeNull();
    releaseProviderSlot(reservation);
  });

  it("returns forbidden when requested agent is not allowed", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        list: [{ id: "main", subagents: { allowRecursiveSpawn: false, allowAgents: ["alpha"] } }],
      },
    };

    const result = await createTool("agent:main:subagent:parent").execute("call-unknown", {
      task: "route this",
      agentId: "ghost",
    });

    expect(result.details).toMatchObject({
      status: "forbidden",
    });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("fails fast when toolOverrides.allow includes tools unavailable to the target agent", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      tools: {
        profile: "messaging",
      },
      agents: {
        list: [{ id: "main", subagents: { maxChildrenPerAgent: 2 } }],
      },
    };

    const result = await createTool().execute("call-invalid-allow", {
      task: "new task",
      toolOverrides: {
        allow: ["read"],
      },
    });

    expect(result.details).toMatchObject({
      status: "error",
      reason: "invalid_tool_overrides_allow",
      targetAgentId: "main",
      invalidAllow: ["read"],
    });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("accepts toolOverrides.allow entries that match target agent tools", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      tools: {
        profile: "messaging",
      },
      agents: {
        list: [{ id: "main", subagents: { maxChildrenPerAgent: 2 } }],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-valid-allow" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });

    const result = await createTool().execute("call-valid-allow", {
      task: "new task",
      toolOverrides: {
        allow: ["message"],
      },
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      runId: "run-valid-allow",
    });
  });

  it("accepts explicit main target when agents.list is empty", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {},
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-main-empty-list" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });

    const result = await createTool().execute("call-main-empty-list", {
      task: "spawn main",
      agentId: "main",
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      runId: "run-main-empty-list",
    });
  });

  it("reserveChildSlot returns false when active + pending >= max", () => {
    const parentKey = "main";
    addSubagentRunForTests({
      runId: "active-for-reserve",
      childSessionKey: "agent:main:subagent:active-for-reserve",
      requesterSessionKey: parentKey,
      requesterDisplayKey: "main",
      task: "active",
      cleanup: "keep",
      createdAt: Date.now(),
    });

    expect(reserveChildSlot(parentKey, 2)).toBe(true);
    expect(reserveChildSlot(parentKey, 2)).toBe(false);

    releaseChildSlot(parentKey);
  });

  it("releases reserved slot when spawn fails", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        throw new Error("spawn failed");
      }
      return {};
    });

    const result = await createTool().execute("call-failure-release", {
      task: "this will fail",
    });

    expect(result.details).toMatchObject({
      status: "error",
    });
    expect(String((result.details as { error?: unknown }).error)).toContain("spawn failed");
    expect(getActiveChildCount("main")).toBe(0);
    expect(reserveChildSlot("main", 1)).toBe(true);
    releaseChildSlot("main");
  });
});
