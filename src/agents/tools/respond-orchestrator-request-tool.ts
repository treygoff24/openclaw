import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import {
  getOrchestratorRequest,
  resolveOrchestratorRequest,
} from "../orchestrator-request-registry.js";
import { jsonResult, readStringParam } from "./common.js";

const RespondOrchestratorRequestSchema = Type.Object({
  requestId: Type.String({ minLength: 1 }),
  response: Type.String({ minLength: 1 }),
});

export function createRespondOrchestratorRequestTool(opts?: {
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Orchestrator",
    name: "respond_orchestrator_request",
    description: "Respond to a pending orchestrator request from a child subagent.",
    parameters: RespondOrchestratorRequestSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const requestId = readStringParam(params, "requestId", { required: true });
      const response = readStringParam(params, "response", { required: true });

      const callerSessionKey = opts?.agentSessionKey?.trim() ?? "";

      // Look up request
      const request = getOrchestratorRequest(requestId);
      if (!request) {
        return jsonResult({
          status: "not_found",
          error: `Request not found: ${requestId}`,
        });
      }

      // Check if already resolved
      if (
        request.status === "resolved" ||
        request.status === "timeout" ||
        request.status === "cancelled" ||
        request.status === "orphaned"
      ) {
        return jsonResult({
          status: "already_resolved",
          error: `Request ${requestId} is already ${request.status}`,
        });
      }

      // Authorize: caller must be the designated parent
      if (callerSessionKey && request.parentSessionKey !== callerSessionKey) {
        return jsonResult({
          status: "forbidden",
          error: "Only the designated parent can respond to this request.",
        });
      }

      // Resolve
      try {
        resolveOrchestratorRequest(requestId, response, callerSessionKey);
        return jsonResult({
          status: "ok",
          requestId,
          message: "Request resolved successfully.",
        });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
