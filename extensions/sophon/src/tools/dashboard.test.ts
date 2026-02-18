import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";

const { getDashboardMock, searchMock } = vi.hoisted(() => ({
  getDashboardMock: vi.fn(),
  searchMock: vi.fn(),
}));

vi.mock("../lib/api.js", () => ({
  getDashboard: getDashboardMock,
  search: searchMock,
}));

import { registerDashboardTools } from "./dashboard.js";

function createApi() {
  const tools: Array<{
    name: string;
    execute: (_toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }> = [];

  const api = {
    id: "sophon",
    name: "sophon",
    source: "test",
    config: {},
    pluginConfig: {},
    runtime: { version: "test" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool(tool: (typeof tools)[number]) {
      tools.push(tool);
    },
  } as unknown as OpenClawPluginApi;

  return { api, tools };
}

describe("sophon dashboard tools", () => {
  beforeEach(() => {
    getDashboardMock.mockReset();
    searchMock.mockReset();
  });

  it("loads dashboard with optional team filter", async () => {
    const { api, tools } = createApi();
    registerDashboardTools(api);

    getDashboardMock.mockResolvedValue({
      tasks: {
        backlog: 1,
        in_progress: 0,
        completed: 0,
        blocked: 0,
        waiting: 0,
        overdue: 0,
        total: 1,
      },
      projects: { active: 0, completed: 0, total: 0 },
      upcoming_deadlines: [],
    });

    const tool = tools.find((entry) => entry.name === "sophon_dashboard");
    if (!tool) throw new Error("sophon_dashboard not registered");

    await tool.execute("call", {
      team_id: "00000000-0000-4000-8000-000000000001",
    });

    expect(getDashboardMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });

  it("searches by joined entity list", async () => {
    const { api, tools } = createApi();
    registerDashboardTools(api);

    searchMock.mockResolvedValue({ tasks: [], projects: [] });

    const tool = tools.find((entry) => entry.name === "sophon_search");
    if (!tool) throw new Error("sophon_search not registered");

    await tool.execute("call", {
      query: "deploy",
      entity_types: ["tasks", "projects"],
      limit: 3,
      team_id: "00000000-0000-4000-8000-000000000002",
    });

    expect(searchMock).toHaveBeenCalledWith({
      query: "deploy",
      entity_types: ["tasks", "projects"],
      limit: 3,
      team_id: "00000000-0000-4000-8000-000000000002",
    });
  });
});
