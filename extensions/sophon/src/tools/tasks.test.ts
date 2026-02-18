import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";

const {
  archiveTaskMock,
  completeTaskMock,
  createTaskMock,
  getTaskMock,
  listTasksMock,
  patchTaskMock,
} = vi.hoisted(() => ({
  archiveTaskMock: vi.fn(),
  completeTaskMock: vi.fn(),
  createTaskMock: vi.fn(),
  getTaskMock: vi.fn(),
  listTasksMock: vi.fn(),
  patchTaskMock: vi.fn(),
}));

vi.mock("../lib/api.js", () => ({
  archiveTask: archiveTaskMock,
  completeTask: completeTaskMock,
  createTask: createTaskMock,
  getTask: getTaskMock,
  listTasks: listTasksMock,
  patchTask: patchTaskMock,
}));

import { registerTaskTools } from "./tasks.js";

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

describe("sophon task tools", () => {
  beforeEach(() => {
    archiveTaskMock.mockReset();
    completeTaskMock.mockReset();
    createTaskMock.mockReset();
    getTaskMock.mockReset();
    listTasksMock.mockReset();
    patchTaskMock.mockReset();
  });

  it("lists tasks with expected query params", async () => {
    const { api, tools } = createApi();
    registerTaskTools(api);

    listTasksMock.mockResolvedValue({ tasks: [{ id: "task-1" }] });

    const tool = tools.find((entry) => entry.name === "sophon_list_tasks");
    if (!tool) throw new Error("sophon_list_tasks not registered");

    await tool.execute("call", {
      status: "backlog",
      priority: "p2",
      limit: 5,
      team_id: "00000000-0000-4000-8000-000000000001",
    });

    expect(listTasksMock).toHaveBeenCalledTimes(1);
    expect(listTasksMock).toHaveBeenCalledWith({
      status: "backlog",
      priority: "p2",
      project_id: undefined,
      category: undefined,
      due_before: undefined,
      due_after: undefined,
      team_id: "00000000-0000-4000-8000-000000000001",
      limit: 5,
    });
  });

  it("creates a task with API defaults", async () => {
    const { api, tools } = createApi();
    registerTaskTools(api);

    createTaskMock.mockResolvedValue({ task: { id: "task-2" } });

    const tool = tools.find((entry) => entry.name === "sophon_create_task");
    if (!tool) throw new Error("sophon_create_task not registered");

    await tool.execute("call", {
      title: "Ship plugin",
    });

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(createTaskMock).toHaveBeenCalledWith({
      title: "Ship plugin",
      description: undefined,
      desired_outcome: undefined,
      status_label: "backlog",
      priority_level: "p3",
      top_level_category: "Uncategorized",
      project_id: undefined,
      due_date: undefined,
      team_id: undefined,
    });
  });

  it("updates a task with filtered body", async () => {
    const { api, tools } = createApi();
    registerTaskTools(api);

    patchTaskMock.mockResolvedValue({ task: { id: "task-3" } });
    const tool = tools.find((entry) => entry.name === "sophon_update_task");
    if (!tool) throw new Error("sophon_update_task not registered");

    await tool.execute("call", {
      id: "00000000-0000-4000-8000-000000000002",
      title: "Updated title",
      due_date: undefined,
    });

    expect(patchTaskMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002", {
      title: "Updated title",
    });
  });

  it("completes and archives via API endpoints", async () => {
    const { api, tools } = createApi();
    registerTaskTools(api);

    completeTaskMock.mockResolvedValue({ task: { id: "task-4" } });
    archiveTaskMock.mockResolvedValue({ task: { id: "task-4" } });

    const completeTool = tools.find((entry) => entry.name === "sophon_complete_task");
    const archiveTool = tools.find((entry) => entry.name === "sophon_archive_task");

    if (!completeTool || !archiveTool) {
      throw new Error("task completion/archive tool not registered");
    }

    await completeTool.execute("call", {
      id: "00000000-0000-4000-8000-000000000004",
    });
    await archiveTool.execute("call", {
      id: "00000000-0000-4000-8000-000000000004",
      reason: "No longer needed",
    });

    expect(completeTaskMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000004");
    expect(archiveTaskMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000004");
  });
});
