import { Type } from "@sinclair/typebox";
import { jsonResult, optionalStringEnum, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  archiveTask,
  completeTask,
  createTask,
  getTask,
  listTasks,
  patchTask,
  type ListTasksResponse,
  type PatchTaskInput,
} from "../lib/api.js";

const STATUS_VALUES = ["backlog", "in_progress", "completed", "blocked", "waiting"] as const;
const PRIORITY_VALUES = ["p1", "p2", "p3", "p4", "p5"] as const;

const DATE_ONLY = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function registerTaskTools(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "sophon_list_tasks",
    label: "Sophon: List Tasks",
    description: "List tasks from Sophon with optional filters",
    parameters: Type.Object({
      status: optionalStringEnum(STATUS_VALUES),
      priority: optionalStringEnum(PRIORITY_VALUES),
      project_id: Type.Optional(Type.String()),
      category: Type.Optional(Type.String()),
      due_before: Type.Optional(DATE_ONLY),
      due_after: Type.Optional(DATE_ONLY),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    }),
    async execute(_toolCallId, params) {
      const response: ListTasksResponse = await listTasks({
        status: params.status,
        priority: params.priority,
        project_id: params.project_id,
        category: params.category,
        due_before: params.due_before,
        due_after: params.due_after,
        team_id: params.team_id,
        limit: params.limit,
      });
      return jsonResult(response.tasks);
    },
  });

  api.registerTool({
    name: "sophon_get_task",
    label: "Sophon: Get Task",
    description: "Get a single task by ID with full details",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
    }),
    async execute(_toolCallId, params) {
      const response = await getTask(params.id);
      return jsonResult(response.task);
    },
  });

  api.registerTool({
    name: "sophon_create_task",
    label: "Sophon: Create Task",
    description: "Create a new task in Sophon",
    parameters: Type.Object({
      title: Type.String({ minLength: 1 }),
      description: Type.Optional(Type.String()),
      desired_outcome: Type.Optional(Type.String()),
      status_label: optionalStringEnum(STATUS_VALUES),
      priority_level: optionalStringEnum(PRIORITY_VALUES),
      top_level_category: Type.Optional(Type.String()),
      project_id: Type.Optional(Type.String({ format: "uuid" })),
      due_date: Type.Optional(DATE_ONLY),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
    }),
    async execute(_toolCallId, params) {
      const response = await createTask(
        compactObject({
          title: params.title,
          description: params.description,
          desired_outcome: params.desired_outcome,
          status_label: params.status_label ?? "backlog",
          priority_level: params.priority_level ?? "p3",
          top_level_category: params.top_level_category ?? "Uncategorized",
          project_id: params.project_id,
          due_date: params.due_date,
          team_id: params.team_id,
        }),
      );
      return jsonResult(response.task);
    },
  });

  api.registerTool({
    name: "sophon_update_task",
    label: "Sophon: Update Task",
    description: "Update fields on an existing task",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
      title: Type.Optional(Type.String({ minLength: 1 })),
      description: Type.Optional(Type.String()),
      desired_outcome: Type.Optional(Type.String()),
      status_label: optionalStringEnum(STATUS_VALUES),
      priority_level: optionalStringEnum(PRIORITY_VALUES),
      top_level_category: Type.Optional(Type.String()),
      project_id: Type.Optional(Type.String({ format: "uuid" })),
      due_date: Type.Optional(DATE_ONLY),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
    }),
    async execute(_toolCallId, params) {
      const { id, ...fields } = params;
      const response = await patchTask(id, compactObject(fields) as PatchTaskInput);
      return jsonResult(response.task);
    },
  });

  api.registerTool({
    name: "sophon_complete_task",
    label: "Sophon: Complete Task",
    description: "Mark a task as completed",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
    }),
    async execute(_toolCallId, params) {
      const response = await completeTask(params.id);
      return jsonResult(response.task);
    },
  });

  api.registerTool({
    name: "sophon_archive_task",
    label: "Sophon: Archive Task",
    description: "Archive (soft-delete) a task",
    parameters: Type.Object({
      id: Type.String({ format: "uuid" }),
      reason: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const response = await archiveTask(params.id);
      return jsonResult(response.task);
    },
  });
}
