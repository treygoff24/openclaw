import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { callGateway } from "../../gateway/call.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { isSubagentSessionKey } from "../../routing/session-key.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { AGENT_LANE_NESTED } from "../lanes.js";
import {
  createOrchestratorRequest,
  waitForResolution,
  getOrchestratorRequest,
} from "../orchestrator-request-registry.js";
import { getRunByChildKey } from "../subagent-registry.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

const RequestOrchestratorSchema = Type.Object({
  message: Type.String({
    minLength: 1,
    description: "Question or request for the parent orchestrator",
  }),
  context: Type.Optional(
    Type.String({ description: "Additional context (file paths, data, partial results)" }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      minimum: 10,
      maximum: 3600,
      description: "Max wait time. Default: 300",
    }),
  ),
  priority: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("high")])),
});

export function createRequestOrchestratorTool(opts?: {
  agentSessionKey?: string;
  runId?: string;
  runTimeoutMs?: number;
  runStartedAt?: number;
  abortSignal?: AbortSignal;
}): AnyAgentTool {
  return {
    label: "Orchestrator",
    name: "request_orchestrator",
    description:
      "Request input from the parent orchestrator. Blocks until the parent responds, times out, or the run is aborted.",
    parameters: RequestOrchestratorSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const message = readStringParam(params, "message", { required: true });
      const context = readStringParam(params, "context");
      const timeoutSeconds = readNumberParam(params, "timeoutSeconds") ?? 300;
      const priority = (params.priority as "normal" | "high") === "high" ? "high" : "normal";

      const currentSessionKey = opts?.agentSessionKey?.trim() ?? "";

      // 1. Validate caller is a subagent
      if (!isSubagentSessionKey(currentSessionKey)) {
        return jsonResult({
          status: "error",
          error: "request_orchestrator is only available to subagent sessions.",
        });
      }

      // 2. Resolve parent
      const run = getRunByChildKey(currentSessionKey);
      if (!run) {
        return jsonResult({
          status: "error",
          error: "Could not resolve parent session. No run record found.",
        });
      }
      const parentSessionKey = run.requesterSessionKey;

      // 3. Check parent availability (best-effort)
      let parentAvailable = true;
      try {
        const sessions = await callGateway<{ sessions: Array<{ key: string }> }>({
          method: "sessions.list",
          params: { limit: 500 },
          timeoutMs: 5_000,
        });
        const sessionList = Array.isArray(sessions?.sessions) ? sessions.sessions : [];
        parentAvailable = sessionList.some((s) => s.key === parentSessionKey);
      } catch {
        // If we can't check, assume available
      }

      if (!parentAvailable) {
        return jsonResult({
          status: "parent_unavailable",
          error: "Parent session is not active.",
        });
      }

      // 4. Compute effective timeout
      const requestedTimeoutMs = timeoutSeconds * 1000;
      let effectiveTimeoutMs = requestedTimeoutMs;

      if (opts?.runTimeoutMs && opts?.runStartedAt) {
        const elapsed = Date.now() - opts.runStartedAt;
        const remainingMs = opts.runTimeoutMs - elapsed;
        const bufferMs = 30_000;
        if (remainingMs - bufferMs <= 0) {
          return jsonResult({
            status: "timeout",
            error: "Insufficient remaining run time for orchestrator request.",
          });
        }
        effectiveTimeoutMs = Math.min(requestedTimeoutMs, remainingMs - bufferMs);
      }

      // 5. Create request record
      let requestId: string;
      try {
        requestId = createOrchestratorRequest({
          childSessionKey: currentSessionKey,
          parentSessionKey,
          runId: opts?.runId,
          message,
          context,
          priority,
          timeoutMs: effectiveTimeoutMs,
        });
      } catch (err) {
        return jsonResult({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const request = getOrchestratorRequest(requestId);
      const timeoutAt = request?.timeoutAt ? new Date(request.timeoutAt).toISOString() : undefined;

      // 6. Deliver parent notification
      const notificationText = [
        `[subagent_request requestId=${requestId}]`,
        `From: ${currentSessionKey}`,
        run.label ? `Label: "${run.label}"` : undefined,
        `Priority: ${priority}`,
        `Timeout: ${timeoutSeconds}s${timeoutAt ? ` (expires at ${timeoutAt})` : ""}`,
        "",
        `Question: ${message}`,
        context ? `\nContext: ${context}` : undefined,
        "",
        "---",
        `Respond: respond_orchestrator_request(requestId="${requestId}", response="your guidance")`,
      ]
        .filter((line) => line !== undefined)
        .join("\n");

      try {
        await callGateway({
          method: "agent",
          params: {
            message: notificationText,
            sessionKey: parentSessionKey,
            deliver: false,
            channel: INTERNAL_MESSAGE_CHANNEL,
            lane: AGENT_LANE_NESTED,
          },
          timeoutMs: 10_000,
        });
      } catch {
        // Notification delivery is best-effort
      }

      // 7. Emit agent event
      if (opts?.runId) {
        emitAgentEvent({
          runId: opts.runId,
          stream: "orchestrator_request",
          data: {
            requestId,
            childSessionKey: currentSessionKey,
            parentSessionKey,
            message,
            priority,
            timeoutAt: request?.timeoutAt,
          },
        });
      }

      // 8. Block on resolution
      try {
        const resolved = await waitForResolution(requestId, effectiveTimeoutMs, opts?.abortSignal);

        return jsonResult({
          status: resolved.status,
          requestId,
          response: resolved.response,
          error: resolved.error,
          respondedAt: resolved.resolvedAt,
        });
      } catch (err) {
        // Abort signal
        return jsonResult({
          status: "cancelled",
          requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
