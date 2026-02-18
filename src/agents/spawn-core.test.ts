import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const callGatewayMock = vi.fn();
const onAgentEventMock = vi.fn(() => () => {});
const loadSubagentRegistryFromDiskMock = vi.fn(() => new Map());
const saveSubagentRegistryToDiskMock = vi.fn(() => {});
const buildSubagentSystemPromptMock = vi.fn(() => "subagent-system-prompt");

vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: OpenClawConfig = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
  };
});

vi.mock("../infra/agent-events.js", () => ({
  onAgentEvent: (...args: unknown[]) => onAgentEventMock(...args),
}));

vi.mock("./subagent-registry.store.js", () => ({
  loadSubagentRegistryFromDisk: () => loadSubagentRegistryFromDiskMock(),
  saveSubagentRegistryToDisk: (...args: unknown[]) => saveSubagentRegistryToDiskMock(...args),
}));

vi.mock("./subagent-announce.js", () => ({
  buildSubagentSystemPrompt: (...args: unknown[]) => buildSubagentSystemPromptMock(...args),
  runSubagentAnnounceFlow: vi.fn(async () => true),
}));

import { spawnCore, SpawnError } from "./spawn-core.js";
import {
  addSubagentRunForTests,
  listSubagentRunsForRequester,
  releaseChildSlot,
  releaseProviderSlot,
  reserveChildSlot,
  reserveProviderSlot,
  resetSubagentRegistryForTests,
} from "./subagent-registry.js";

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

beforeEach(() => {
  configOverride = baseConfig();
  callGatewayMock.mockReset();
  onAgentEventMock.mockReset();
  loadSubagentRegistryFromDiskMock.mockReset();
  loadSubagentRegistryFromDiskMock.mockReturnValue(new Map());
  saveSubagentRegistryToDiskMock.mockReset();
  buildSubagentSystemPromptMock.mockReset();
  buildSubagentSystemPromptMock.mockReturnValue("subagent-system-prompt");
  resetSubagentRegistryForTests({ persist: false });
});

afterEach(() => {
  resetSubagentRegistryForTests({ persist: false });
  callGatewayMock.mockReset();
  onAgentEventMock.mockReset();
  loadSubagentRegistryFromDiskMock.mockReset();
  saveSubagentRegistryToDiskMock.mockReset();
  buildSubagentSystemPromptMock.mockReset();
});

describe("spawnCore", () => {
  it("returns accepted and registers run on success", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-core-ok" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });

    const result = await spawnCore({
      task: "new task",
      cleanup: "keep",
      requesterSessionKey: "main",
    });

    expect(result).toMatchObject({
      status: "accepted",
      runId: "run-core-ok",
    });
    const requesterRuns = listSubagentRunsForRequester("main");
    expect(requesterRuns).toHaveLength(1);
    expect(requesterRuns[0]?.runId).toBe("run-core-ok");
  });

  it("throws SpawnError for disallowed target agent", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        list: [{ id: "main", subagents: { allowRecursiveSpawn: false, allowAgents: ["alpha"] } }],
      },
    };

    await expect(
      spawnCore({
        task: "route this",
        cleanup: "keep",
        requesterSessionKey: "agent:main:subagent:parent",
        requestedAgentId: "ghost",
      }),
    ).rejects.toMatchObject({
      details: {
        status: "forbidden",
      },
    });

    await expect(
      spawnCore({
        task: "route this",
        cleanup: "keep",
        requesterSessionKey: "agent:main:subagent:parent",
        requestedAgentId: "ghost",
      }),
    ).rejects.toBeInstanceOf(SpawnError);
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("throws blocked provider_limit when provider bucket is full", async () => {
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

    await expect(
      spawnCore({
        task: "new task",
        cleanup: "keep",
        requesterSessionKey: "main",
        modelOverride: "openai/gpt-5",
      }),
    ).rejects.toMatchObject({
      details: {
        status: "blocked",
        reason: "provider_limit",
        provider: "openai",
      },
    });

    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("releases reserved child + provider slots when spawn fails", async () => {
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

    await expect(
      spawnCore({
        task: "this will fail",
        cleanup: "keep",
        requesterSessionKey: "main",
        modelOverride: "openai/gpt-5",
      }),
    ).rejects.toMatchObject({
      details: {
        status: "error",
      },
    });

    expect(listSubagentRunsForRequester("main")).toHaveLength(0);
    expect(reserveChildSlot("main", 1)).toBe(true);
    releaseChildSlot("main");

    const reservation = reserveProviderSlot("openai", 1);
    expect(reservation).not.toBeNull();
    releaseProviderSlot(reservation);
  });

  it("threads completion/progress reporting flags into subagent system prompt", async () => {
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-reporting-flags" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });

    await spawnCore({
      task: "new task",
      cleanup: "keep",
      requesterSessionKey: "main",
      completionReport: true,
      progressReporting: true,
    });

    expect(buildSubagentSystemPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        completionReport: true,
        progressReporting: true,
      }),
    );
  });

  it("inherits recursive-spawn policy from parent agent for subagent sessions", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        list: [
          { id: "main", subagents: { allowRecursiveSpawn: false } },
          { id: "beta", subagents: { allowRecursiveSpawn: true, maxDepth: 4 } },
        ],
      },
    };

    addSubagentRunForTests({
      runId: "parent-beta-run",
      childSessionKey: "agent:beta:subagent:parent-beta",
      requesterSessionKey: "main",
      requesterDisplayKey: "main",
      task: "seed",
      cleanup: "keep",
      createdAt: Date.now(),
      originalSpawnParams: {
        requesterAgentIdOverride: "main",
      },
    });

    await expect(
      spawnCore({
        task: "nested task",
        cleanup: "keep",
        requesterSessionKey: "agent:beta:subagent:parent-beta",
      }),
    ).rejects.toMatchObject({
      details: {
        status: "forbidden",
      },
    });

    await expect(
      spawnCore({
        task: "nested task",
        cleanup: "keep",
        requesterSessionKey: "agent:beta:subagent:parent-beta",
      }),
    ).rejects.toMatchObject({
      details: {
        error: expect.stringContaining("Recursive spawning is not enabled"),
      },
    });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("inherits parent-agent allowlist for cross-agent recursive spawns", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        list: [
          {
            id: "main",
            subagents: { allowRecursiveSpawn: true, maxDepth: 4, allowAgents: ["beta"] },
          },
          {
            id: "beta",
            subagents: { allowRecursiveSpawn: true, maxDepth: 4, allowAgents: ["gamma"] },
          },
          { id: "gamma", subagents: { allowRecursiveSpawn: true, maxDepth: 4 } },
        ],
      },
    };

    addSubagentRunForTests({
      runId: "parent-beta-run-allowlist",
      childSessionKey: "agent:beta:subagent:parent-beta-allowlist",
      requesterSessionKey: "main",
      requesterDisplayKey: "main",
      task: "seed",
      cleanup: "keep",
      createdAt: Date.now(),
      originalSpawnParams: {
        requesterAgentIdOverride: "main",
      },
    });

    await expect(
      spawnCore({
        task: "cross-agent nested task",
        cleanup: "keep",
        requesterSessionKey: "agent:beta:subagent:parent-beta-allowlist",
        requestedAgentId: "gamma",
      }),
    ).rejects.toMatchObject({
      details: {
        status: "forbidden",
        error: expect.stringContaining("allowed: beta"),
      },
    });

    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("returns max-depth error before recursive-toggle error when already at cap", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        list: [{ id: "main", subagents: { allowRecursiveSpawn: false, maxDepth: 1 } }],
      },
    };

    await expect(
      spawnCore({
        task: "too deep",
        cleanup: "keep",
        requesterSessionKey: "agent:main:subagent:parent",
      }),
    ).rejects.toMatchObject({
      details: {
        status: "forbidden",
        error: expect.stringContaining("Maximum subagent depth (1) reached"),
      },
    });

    await expect(
      spawnCore({
        task: "too deep",
        cleanup: "keep",
        requesterSessionKey: "agent:main:subagent:parent",
      }),
    ).rejects.toMatchObject({
      details: {
        error: expect.not.stringContaining("Recursive spawning is not enabled"),
      },
    });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("rejects unknown explicitly requested agent ids without fallback", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        list: [{ id: "main", subagents: { allowAgents: ["*"] } }],
      },
    };

    await expect(
      spawnCore({
        task: "unknown target",
        cleanup: "keep",
        requesterSessionKey: "main",
        requestedAgentId: "ghost",
      }),
    ).rejects.toMatchObject({
      details: {
        status: "error",
        error: expect.stringContaining('Unknown requested agentId "ghost"'),
      },
    });

    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it("stores normalized requestedAgentId in original spawn params", async () => {
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        list: [
          { id: "main", subagents: { allowAgents: ["research"] } },
          { id: "research", subagents: {} },
        ],
      },
    };

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "agent") {
        return { runId: "run-requested-agent-normalized" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });

    const result = await spawnCore({
      task: "cross-agent spawn",
      cleanup: "keep",
      requesterSessionKey: "main",
      requestedAgentId: "Research",
    });

    expect(result).toMatchObject({
      status: "accepted",
      runId: "run-requested-agent-normalized",
    });

    const run = listSubagentRunsForRequester("main").find(
      (entry) => entry.runId === "run-requested-agent-normalized",
    );
    expect(run?.originalSpawnParams?.requestedAgentId).toBe("research");
    expect(run?.childSessionKey.startsWith("agent:research:subagent:")).toBe(true);
  });
});
