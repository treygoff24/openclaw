import { beforeEach, describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  getCallGatewayMock,
  getSessionsSpawnTool,
  resetSessionsSpawnConfigOverride,
  setSessionsSpawnConfigOverride,
} from "./openclaw-tools.subagents.sessions-spawn.test-harness.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";

const callGatewayMock = getCallGatewayMock();

describe("openclaw-tools: subagents (sessions_spawn target selection)", () => {
  function setAllowAgents(allowAgents: string[]) {
    setSessionsSpawnConfigOverride({
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
      agents: {
        list: [
          {
            id: "main",
            subagents: {
              allowAgents,
            },
          },
        ],
      },
    });
  }

  function mockAcceptedSpawn(acceptedAt: number) {
    let childSessionKey: string | undefined;
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      if (request.method === "agent") {
        const params = request.params as { sessionKey?: string } | undefined;
        childSessionKey = params?.sessionKey;
        return { runId: "run-1", status: "accepted", acceptedAt };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });
    return () => childSessionKey;
  }

  async function executeSpawn(callId: string, agentId: string) {
    const tool = await getSessionsSpawnTool({
      agentSessionKey: "main",
      agentChannel: "whatsapp",
    });
    return tool.execute(callId, { task: "do thing", agentId });
  }

  async function expectAllowedSpawn(params: {
    agentId: string;
    callId: string;
    acceptedAt: number;
  }) {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    const getChildSessionKey = mockAcceptedSpawn(params.acceptedAt);

    const result = await executeSpawn(params.callId, params.agentId);

    expect(result.details).toMatchObject({
      status: "accepted",
      runId: "run-1",
    });
    expect(
      getChildSessionKey()?.startsWith(`agent:${normalizeAgentId(params.agentId)}:subagent:`),
    ).toBe(true);
  }

  beforeEach(() => {
    resetSessionsSpawnConfigOverride();
  });

  it("sessions_spawn allows cross-agent spawning by default", async () => {
    await expectAllowedSpawn({
      agentId: "beta",
      callId: "call6",
      acceptedAt: 4900,
    });
  });

  it("sessions_spawn ignores legacy allowAgents restrictions", async () => {
    setAllowAgents(["alpha"]);

    await expectAllowedSpawn({
      agentId: "beta",
      callId: "call9",
      acceptedAt: 5000,
    });
  });

  it("sessions_spawn ignores wildcard allowAgents settings", async () => {
    setAllowAgents(["*"]);

    await expectAllowedSpawn({
      agentId: "beta",
      callId: "call8",
      acceptedAt: 5100,
    });
  });

  it("sessions_spawn normalizes target agent ids", async () => {
    await expectAllowedSpawn({
      agentId: "Research",
      callId: "call10",
      acceptedAt: 5200,
    });
  });
});
