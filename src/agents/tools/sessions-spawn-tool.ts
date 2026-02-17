import { Type } from "@sinclair/typebox";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { VerificationContract } from "../spawn-verification.types.js";
import type { AnyAgentTool } from "./common.js";
import { normalizeDeliveryContext } from "../../utils/delivery-context.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { SpawnError, spawnCore } from "../spawn-core.js";
import { jsonResult, readStringParam } from "./common.js";

const SessionsSpawnToolSchema = Type.Object({
  task: Type.String(),
  label: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  // Back-compat alias. Prefer runTimeoutSeconds.
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  toolOverrides: Type.Optional(
    Type.Object(
      {
        allow: Type.Optional(Type.Array(Type.String())),
        deny: Type.Optional(Type.Array(Type.String())),
      },
      { additionalProperties: false },
    ),
  ),
  completionReport: Type.Optional(Type.Boolean()),
  progressReporting: Type.Optional(Type.Boolean()),
  verification: Type.Optional(
    Type.Object(
      {
        artifacts: Type.Optional(
          Type.Array(
            Type.Object(
              {
                path: Type.String({ minLength: 1 }),
                json: Type.Optional(Type.Boolean()),
                minItems: Type.Optional(Type.Number({ minimum: 0 })),
                requiredKeys: Type.Optional(Type.Array(Type.String())),
                minBytes: Type.Optional(Type.Number({ minimum: 0 })),
              },
              { additionalProperties: false },
            ),
          ),
        ),
        requireCompletionReport: Type.Optional(Type.Boolean()),
        onFailure: optionalStringEnum(["retry_once", "escalate", "fail"] as const),
        verificationTimeoutMs: Type.Optional(Type.Number({ minimum: 1 })),
      },
      { additionalProperties: false },
    ),
  ),
  cleanup: optionalStringEnum(["delete", "keep"] as const),
});

function normalizeTimeoutSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeVerification(raw: unknown): VerificationContract | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as {
    artifacts?: unknown;
    requireCompletionReport?: unknown;
    onFailure?: unknown;
    verificationTimeoutMs?: unknown;
  };

  const artifacts = Array.isArray(record.artifacts)
    ? record.artifacts
        .map((artifact) => {
          if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
            return undefined;
          }
          const candidate = artifact as {
            path?: unknown;
            json?: unknown;
            minItems?: unknown;
            requiredKeys?: unknown;
            minBytes?: unknown;
          };
          const targetPath = typeof candidate.path === "string" ? candidate.path.trim() : "";
          if (!targetPath) {
            return undefined;
          }
          const minItems =
            typeof candidate.minItems === "number" &&
            Number.isFinite(candidate.minItems) &&
            candidate.minItems >= 0
              ? Math.floor(candidate.minItems)
              : undefined;
          const minBytes =
            typeof candidate.minBytes === "number" &&
            Number.isFinite(candidate.minBytes) &&
            candidate.minBytes >= 0
              ? Math.floor(candidate.minBytes)
              : undefined;
          const requiredKeys = Array.isArray(candidate.requiredKeys)
            ? candidate.requiredKeys
                .map((key) => (typeof key === "string" ? key.trim() : ""))
                .filter((key) => Boolean(key))
            : undefined;
          return {
            path: targetPath,
            ...(typeof candidate.json === "boolean" ? { json: candidate.json } : {}),
            ...(minItems !== undefined ? { minItems } : {}),
            ...(requiredKeys?.length ? { requiredKeys } : {}),
            ...(minBytes !== undefined ? { minBytes } : {}),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    : undefined;

  const onFailure =
    record.onFailure === "retry_once" ||
    record.onFailure === "escalate" ||
    record.onFailure === "fail"
      ? record.onFailure
      : undefined;
  const verificationTimeoutMs =
    typeof record.verificationTimeoutMs === "number" &&
    Number.isFinite(record.verificationTimeoutMs) &&
    record.verificationTimeoutMs > 0
      ? Math.floor(record.verificationTimeoutMs)
      : undefined;

  const contract: VerificationContract = {
    ...(artifacts?.length ? { artifacts } : {}),
    ...(typeof record.requireCompletionReport === "boolean"
      ? { requireCompletionReport: record.requireCompletionReport }
      : {}),
    ...(onFailure ? { onFailure } : {}),
    ...(verificationTimeoutMs ? { verificationTimeoutMs } : {}),
  };

  return Object.keys(contract).length > 0 ? contract : undefined;
}

export function createSessionsSpawnTool(opts?: {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
  sandboxed?: boolean;
  /** Explicit agent ID override for cron/hook sessions where session key parsing may not work. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_spawn",
    description:
      "Spawn a background sub-agent run in an isolated session and announce the result back to the requester chat.",
    parameters: SessionsSpawnToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const completionReport =
        typeof params.completionReport === "boolean" ? params.completionReport : undefined;
      const progressReporting =
        typeof params.progressReporting === "boolean" ? params.progressReporting : undefined;
      const explicitRunTimeoutSeconds =
        normalizeTimeoutSeconds(params.runTimeoutSeconds) ??
        normalizeTimeoutSeconds(params.timeoutSeconds);
      const requesterOrigin = normalizeDeliveryContext({
        channel: opts?.agentChannel,
        accountId: opts?.agentAccountId,
        to: opts?.agentTo,
        threadId: opts?.agentThreadId,
      });

      try {
        const result = await spawnCore({
          task,
          label: typeof params.label === "string" ? params.label : undefined,
          requestedAgentId: readStringParam(params, "agentId"),
          modelOverride: readStringParam(params, "model"),
          thinkingOverrideRaw: readStringParam(params, "thinking"),
          explicitRunTimeoutSeconds,
          completionReport,
          progressReporting,
          toolOverrides:
            params.toolOverrides && typeof params.toolOverrides === "object"
              ? {
                  allow: Array.isArray((params.toolOverrides as { allow?: unknown }).allow)
                    ? ((params.toolOverrides as { allow?: unknown }).allow as string[])
                        .map((value) => (typeof value === "string" ? value.trim() : ""))
                        .filter((value) => Boolean(value))
                    : undefined,
                  deny: Array.isArray((params.toolOverrides as { deny?: unknown }).deny)
                    ? ((params.toolOverrides as { deny?: unknown }).deny as string[])
                        .map((value) => (typeof value === "string" ? value.trim() : ""))
                        .filter((value) => Boolean(value))
                    : undefined,
                }
              : undefined,
          verification: normalizeVerification(params.verification),
          cleanup:
            params.cleanup === "keep" || params.cleanup === "delete" ? params.cleanup : "keep",
          requesterSessionKey: opts?.agentSessionKey,
          requesterOrigin,
          requesterAgentIdOverride: opts?.requesterAgentIdOverride,
          agentGroupId: opts?.agentGroupId,
          agentGroupChannel: opts?.agentGroupChannel,
          agentGroupSpace: opts?.agentGroupSpace,
        });
        return jsonResult(result);
      } catch (err) {
        if (err instanceof SpawnError) {
          return jsonResult(err.details);
        }
        throw err;
      }
    },
  };
}
