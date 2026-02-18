import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";

const {
  archiveProjectMock,
  createProjectMock,
  getProjectMock,
  listProjectsMock,
  patchProjectMock,
} = vi.hoisted(() => ({
  archiveProjectMock: vi.fn(),
  createProjectMock: vi.fn(),
  getProjectMock: vi.fn(),
  listProjectsMock: vi.fn(),
  patchProjectMock: vi.fn(),
}));

vi.mock("../lib/api.js", () => ({
  archiveProject: archiveProjectMock,
  createProject: createProjectMock,
  getProject: getProjectMock,
  listProjects: listProjectsMock,
  patchProject: patchProjectMock,
}));

import { registerProjectTools } from "./projects.js";

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

describe("sophon project tools", () => {
  beforeEach(() => {
    archiveProjectMock.mockReset();
    createProjectMock.mockReset();
    getProjectMock.mockReset();
    listProjectsMock.mockReset();
    patchProjectMock.mockReset();
  });

  it("lists projects with expected query", async () => {
    const { api, tools } = createApi();
    registerProjectTools(api);

    listProjectsMock.mockResolvedValue({ projects: [{ id: "project-1" }] });

    const tool = tools.find((entry) => entry.name === "sophon_list_projects");
    if (!tool) throw new Error("sophon_list_projects not registered");

    await tool.execute("call", {
      category: "work",
      priority: "p2",
      include_completed: true,
      limit: 20,
    });

    expect(listProjectsMock).toHaveBeenCalledWith({
      category: "work",
      priority: "p2",
      include_completed: true,
      team_id: undefined,
      limit: 20,
    });
  });

  it("creates project with API defaults", async () => {
    const { api, tools } = createApi();
    registerProjectTools(api);

    createProjectMock.mockResolvedValue({
      project: { id: "project-2", task_stats: { backlog: 0 } },
    });

    const tool = tools.find((entry) => entry.name === "sophon_create_project");
    if (!tool) throw new Error("sophon_create_project not registered");

    await tool.execute("call", {
      name: "Launch Plan",
    });

    expect(createProjectMock).toHaveBeenCalledWith({
      name: "Launch Plan",
      description: undefined,
      category: "Uncategorized",
      priority_level: "p2",
      due_date: undefined,
      desired_outcome: undefined,
      visible_to_managers: undefined,
      team_id: undefined,
      completed_at: undefined,
    });
  });

  it("updates and gets project", async () => {
    const { api, tools } = createApi();
    registerProjectTools(api);

    getProjectMock.mockResolvedValue({ project: { id: "project-3" } });
    patchProjectMock.mockResolvedValue({ project: { id: "project-3", name: "Updated" } });

    const getTool = tools.find((entry) => entry.name === "sophon_get_project");
    const updateTool = tools.find((entry) => entry.name === "sophon_update_project");

    if (!getTool || !updateTool) {
      throw new Error("project get/update tool missing");
    }

    await getTool.execute("call", { id: "00000000-0000-4000-8000-000000000003" });
    await updateTool.execute("call", {
      id: "00000000-0000-4000-8000-000000000003",
      name: "Updated",
      priority_level: undefined,
    });

    expect(getProjectMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000003");
    expect(patchProjectMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000003", {
      name: "Updated",
    });
  });

  it("archives by project id", async () => {
    const { api, tools } = createApi();
    registerProjectTools(api);

    archiveProjectMock.mockResolvedValue({ project: { id: "project-4" } });
    const tool = tools.find((entry) => entry.name === "sophon_archive_project");
    if (!tool) throw new Error("sophon_archive_project not registered");

    await tool.execute("call", {
      id: "00000000-0000-4000-8000-000000000004",
      reason: "moved on",
    });

    expect(archiveProjectMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000004");
  });
});
