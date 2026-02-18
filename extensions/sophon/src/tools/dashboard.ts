import { Type } from "@sinclair/typebox";
import { jsonResult, stringEnum, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getDashboard, search } from "../lib/api.js";

const ENTITY_TYPES = ["tasks", "projects", "notes"] as const;

export function registerDashboardTools(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "sophon_dashboard",
    label: "Sophon: Dashboard",
    description: "Get task/project summary plus upcoming deadlines",
    parameters: Type.Object({
      team_id: Type.Optional(Type.String({ format: "uuid" })),
    }),
    async execute(_toolCallId, params) {
      const response = await getDashboard(params.team_id);
      return jsonResult(response);
    },
  });

  api.registerTool({
    name: "sophon_search",
    label: "Sophon: Search",
    description: "Search across Sophon tasks, projects, and notes",
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      entity_types: Type.Optional(Type.Array(stringEnum(ENTITY_TYPES))),
      team_id: Type.Optional(Type.String({ format: "uuid" })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 10 })),
    }),
    async execute(_toolCallId, params) {
      const response = await search({
        query: params.query,
        entity_types: params.entity_types,
        team_id: params.team_id,
        limit: params.limit,
      });
      return jsonResult(response);
    },
  });
}
