import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "../../../../src/plugins/types.js";

const { archiveNoteMock, createNoteMock, getNoteMock, listNotesMock, patchNoteMock } = vi.hoisted(
  () => ({
    archiveNoteMock: vi.fn(),
    createNoteMock: vi.fn(),
    getNoteMock: vi.fn(),
    listNotesMock: vi.fn(),
    patchNoteMock: vi.fn(),
  }),
);

vi.mock("../lib/api.js", () => ({
  archiveNote: archiveNoteMock,
  createNote: createNoteMock,
  getNote: getNoteMock,
  listNotes: listNotesMock,
  patchNote: patchNoteMock,
}));

import { registerNoteTools } from "./notes.js";

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

describe("sophon note tools", () => {
  beforeEach(() => {
    archiveNoteMock.mockReset();
    createNoteMock.mockReset();
    getNoteMock.mockReset();
    listNotesMock.mockReset();
    patchNoteMock.mockReset();
  });

  it("forwards list filters", async () => {
    const { api, tools } = createApi();
    registerNoteTools(api);

    listNotesMock.mockResolvedValue({ notes: [{ id: "note-1" }] });

    const tool = tools.find((entry) => entry.name === "sophon_list_notes");
    if (!tool) throw new Error("sophon_list_notes not registered");

    await tool.execute("call", {
      project_id: "00000000-0000-4000-8000-000000000001",
      search: "design",
      limit: 15,
      team_id: "00000000-0000-4000-8000-000000000002",
    });

    expect(listNotesMock).toHaveBeenCalledWith({
      project_id: "00000000-0000-4000-8000-000000000001",
      task_id: undefined,
      team_id: "00000000-0000-4000-8000-000000000002",
      search: "design",
      limit: 15,
    });
  });

  it("creates and updates notes", async () => {
    const { api, tools } = createApi();
    registerNoteTools(api);

    createNoteMock.mockResolvedValue({ note: { id: "note-2" } });
    patchNoteMock.mockResolvedValue({ note: { id: "note-2", title: "Updated" } });

    const createTool = tools.find((entry) => entry.name === "sophon_create_note");
    const updateTool = tools.find((entry) => entry.name === "sophon_update_note");
    if (!createTool || !updateTool) throw new Error("note create/update tool missing");

    await createTool.execute("call", {
      title: "Daily plan",
      content: "Draft",
    });
    await updateTool.execute("call", {
      id: "00000000-0000-4000-8000-000000000003",
      title: "Updated",
      task_id: undefined,
    });

    expect(createNoteMock).toHaveBeenCalledWith({
      title: "Daily plan",
      content: "Draft",
      task_id: undefined,
      project_id: undefined,
      team_id: undefined,
    });
    expect(patchNoteMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000003", {
      title: "Updated",
    });
  });

  it("gets and archives notes", async () => {
    const { api, tools } = createApi();
    registerNoteTools(api);

    getNoteMock.mockResolvedValue({ note: { id: "note-3" } });
    archiveNoteMock.mockResolvedValue({ note: { id: "note-3" } });

    const getTool = tools.find((entry) => entry.name === "sophon_get_note");
    const archiveTool = tools.find((entry) => entry.name === "sophon_archive_note");
    if (!getTool || !archiveTool) throw new Error("note get/archive tool missing");

    await getTool.execute("call", {
      id: "00000000-0000-4000-8000-000000000004",
    });
    await archiveTool.execute("call", {
      id: "00000000-0000-4000-8000-000000000004",
      reason: "No longer needed",
    });

    expect(getNoteMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000004");
    expect(archiveNoteMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000004");
  });
});
