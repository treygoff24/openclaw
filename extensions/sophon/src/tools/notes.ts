import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  archiveNote,
  createNote,
  getNote,
  listNotes,
  patchNote,
  type GetNoteResponse,
  type ListNotesResponse,
  type PatchNoteInput,
} from "../lib/api.js";

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function registerNoteTools(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "sophon_list_notes",
    label: "Sophon: List Notes",
    description: "List notes from Sophon with optional filters",
    parameters: Type.Object({
      project_id: Type.Optional(Type.String({ format: "uuid" })),
      task_id: Type.Optional(Type.String({ format: "uuid" })),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
      search: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    }),
    async execute(_toolCallId, params) {
      const response: ListNotesResponse = await listNotes({
        project_id: params.project_id,
        task_id: params.task_id,
        team_id: params.team_id,
        search: params.search,
        limit: params.limit,
      });
      return jsonResult(response.notes);
    },
  });

  api.registerTool({
    name: "sophon_get_note",
    label: "Sophon: Get Note",
    description: "Get one note by id with full content",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
    }),
    async execute(_toolCallId, params) {
      const response: GetNoteResponse = await getNote(params.id);
      return jsonResult(response.note);
    },
  });

  api.registerTool({
    name: "sophon_create_note",
    label: "Sophon: Create Note",
    description: "Create a note in Sophon",
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      content: Type.Optional(Type.String()),
      task_id: Type.Optional(Type.String({ format: "uuid" })),
      project_id: Type.Optional(Type.String({ format: "uuid" })),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
    }),
    async execute(_toolCallId, params) {
      const response = await createNote(
        compactObject({
          title: params.title,
          content: params.content,
          task_id: params.task_id,
          project_id: params.project_id,
          team_id: params.team_id,
        }),
      );
      return jsonResult(response.note);
    },
  });

  api.registerTool({
    name: "sophon_update_note",
    label: "Sophon: Update Note",
    description: "Update fields on a note",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
      title: Type.Optional(Type.String({ minLength: 1 })),
      content: Type.Optional(Type.String()),
      task_id: Type.Optional(Type.String({ format: "uuid" })),
      project_id: Type.Optional(Type.String({ format: "uuid" })),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
    }),
    async execute(_toolCallId, params) {
      const { id, ...fields } = params;
      const response = await patchNote(id, compactObject(fields) as PatchNoteInput);
      return jsonResult(response.note);
    },
  });

  api.registerTool({
    name: "sophon_archive_note",
    label: "Sophon: Archive Note",
    description: "Archive (soft-delete) a note",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
      reason: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const response = await archiveNote(params.id);
      return jsonResult(response.note);
    },
  });
}
