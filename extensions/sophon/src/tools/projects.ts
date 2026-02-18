import { Type } from "@sinclair/typebox";
import { jsonResult, optionalStringEnum, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  patchProject,
  type GetProjectResponse,
  type ListProjectsResponse,
  type PatchProjectInput,
} from "../lib/api.js";

const PRIORITY_VALUES = ["p1", "p2", "p3", "p4", "p5"] as const;
const DATE_ONLY = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function registerProjectTools(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "sophon_list_projects",
    label: "Sophon: List Projects",
    description: "List projects from Sophon with optional filters",
    parameters: Type.Object({
      category: Type.Optional(Type.String()),
      priority: optionalStringEnum(PRIORITY_VALUES),
      include_completed: Type.Optional(Type.Boolean({ default: false })),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    }),
    async execute(_toolCallId, params) {
      const response: ListProjectsResponse = await listProjects({
        category: params.category,
        priority: params.priority,
        include_completed: params.include_completed,
        team_id: params.team_id,
        limit: params.limit,
      });
      return jsonResult(response.projects);
    },
  });

  api.registerTool({
    name: "sophon_get_project",
    label: "Sophon: Get Project",
    description: "Get one project by id with task status stats",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
    }),
    async execute(_toolCallId, params) {
      const response: GetProjectResponse = await getProject(params.id);
      return jsonResult(response.project);
    },
  });

  api.registerTool({
    name: "sophon_create_project",
    label: "Sophon: Create Project",
    description: "Create a project in Sophon",
    parameters: Type.Object({
      name: Type.String({ minLength: 1 }),
      description: Type.Optional(Type.String()),
      category: Type.Optional(Type.String()),
      priority_level: optionalStringEnum(PRIORITY_VALUES),
      due_date: Type.Optional(DATE_ONLY),
      desired_outcome: Type.Optional(Type.String()),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
      visible_to_managers: Type.Optional(Type.Boolean()),
      completed_at: Type.Optional(Type.String({ format: "date-time" })),
    }),
    async execute(_toolCallId, params) {
      const response = await createProject(
        compactObject({
          name: params.name,
          description: params.description,
          category: params.category ?? "Uncategorized",
          priority_level: params.priority_level ?? "p2",
          due_date: params.due_date,
          desired_outcome: params.desired_outcome,
          visible_to_managers: params.visible_to_managers,
          team_id: params.team_id,
          completed_at: params.completed_at,
        }),
      );
      return jsonResult(response.project);
    },
  });

  api.registerTool({
    name: "sophon_update_project",
    label: "Sophon: Update Project",
    description: "Update fields on a project",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
      name: Type.Optional(Type.String({ minLength: 1 })),
      description: Type.Optional(Type.String()),
      category: Type.Optional(Type.String()),
      priority_level: optionalStringEnum(PRIORITY_VALUES),
      due_date: Type.Optional(DATE_ONLY),
      desired_outcome: Type.Optional(Type.String()),
      visible_to_managers: Type.Optional(Type.Boolean()),
      completed_at: Type.Optional(Type.String({ format: "date-time" })),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
    }),
    async execute(_toolCallId, params) {
      const { id, ...fields } = params;
      const response = await patchProject(id, compactObject(fields) as PatchProjectInput);
      return jsonResult(response.project);
    },
  });

  api.registerTool({
    name: "sophon_archive_project",
    label: "Sophon: Archive Project",
    description: "Archive (soft-delete) a project",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
      reason: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const response = await archiveProject(params.id);
      return jsonResult(response.project);
    },
  });
}
