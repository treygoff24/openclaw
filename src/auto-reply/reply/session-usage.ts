import { setCliSessionId } from "../../agents/cli-session.js";
import { normalizeToolName } from "../../agents/tool-policy.js";
import {
  deriveSessionTotalTokens,
  hasNonzeroUsage,
  type NormalizedUsage,
} from "../../agents/usage.js";
import {
  type SessionSystemPromptReport,
  type SessionEntry,
  updateSessionStoreEntry,
} from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";

const DEFAULT_STICKY_MAX_TOOLS = 12;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function resolveStickyMaxTools(report?: SessionSystemPromptReport): number {
  const raw = report?.tools?.stickyMaxToolsApplied;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return DEFAULT_STICKY_MAX_TOOLS;
}

function resolveToolDisclosureStatePatch(params: {
  entry: SessionEntry;
  toolCallNames?: string[];
  systemPromptReport?: SessionSystemPromptReport;
  now: number;
}): SessionEntry["toolDisclosureState"] | undefined {
  const existing = params.entry.toolDisclosureState;
  const called = (params.toolCallNames ?? [])
    .map((name) => normalizeToolName(name))
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index);
  const stickyMaxTools = resolveStickyMaxTools(params.systemPromptReport);
  const selectionConfidence = params.systemPromptReport?.tools?.selectionConfidence;
  const disclosureMode = params.systemPromptReport?.tools?.disclosureMode;

  if (
    called.length === 0 &&
    (selectionConfidence === undefined || disclosureMode !== "auto_intent")
  ) {
    return existing;
  }

  const merged: string[] = [];
  for (const name of called) {
    if (!merged.includes(name)) {
      merged.push(name);
    }
  }
  for (const name of existing?.stickyToolNames ?? []) {
    const normalized = normalizeToolName(name);
    if (!normalized || merged.includes(normalized)) {
      continue;
    }
    merged.push(normalized);
  }

  return {
    stickyToolNames: merged.slice(0, stickyMaxTools),
    lastSelectionConfidence:
      selectionConfidence === undefined
        ? (existing?.lastSelectionConfidence ?? 0)
        : clamp01(selectionConfidence),
    lastSelectionAt: params.now,
  };
}

export async function persistSessionUsageUpdate(params: {
  storePath?: string;
  sessionKey?: string;
  usage?: NormalizedUsage;
  /**
   * Usage from the last individual API call (not accumulated). When provided,
   * this is used for `totalTokens` instead of the accumulated `usage` so that
   * context-window utilization reflects the actual current context size rather
   * than the sum of input tokens across all API calls in the run.
   */
  lastCallUsage?: NormalizedUsage;
  modelUsed?: string;
  providerUsed?: string;
  contextTokensUsed?: number;
  promptTokens?: number;
  systemPromptReport?: SessionSystemPromptReport;
  toolCallNames?: string[];
  cliSessionId?: string;
  logLabel?: string;
}): Promise<void> {
  const { storePath, sessionKey } = params;
  if (!storePath || !sessionKey) {
    return;
  }

  const label = params.logLabel ? `${params.logLabel} ` : "";
  if (hasNonzeroUsage(params.usage)) {
    try {
      await updateSessionStoreEntry({
        storePath,
        sessionKey,
        update: async (entry) => {
          const now = Date.now();
          const input = params.usage?.input ?? 0;
          const output = params.usage?.output ?? 0;
          const resolvedContextTokens = params.contextTokensUsed ?? entry.contextTokens;
          const hasPromptTokens =
            typeof params.promptTokens === "number" &&
            Number.isFinite(params.promptTokens) &&
            params.promptTokens > 0;
          const hasFreshContextSnapshot = Boolean(params.lastCallUsage) || hasPromptTokens;
          // Use last-call usage for totalTokens when available. The accumulated
          // `usage.input` sums input tokens from every API call in the run
          // (tool-use loops, compaction retries), overstating actual context.
          // `lastCallUsage` reflects only the final API call — the true context.
          const usageForContext = params.lastCallUsage ?? params.usage;
          const totalTokens = hasFreshContextSnapshot
            ? deriveSessionTotalTokens({
                usage: usageForContext,
                contextTokens: resolvedContextTokens,
                promptTokens: params.promptTokens,
              })
            : undefined;
          const patch: Partial<SessionEntry> = {
            inputTokens: input,
            outputTokens: output,
            // Missing a last-call snapshot means context utilization is stale/unknown.
            totalTokens,
            totalTokensFresh: typeof totalTokens === "number",
            modelProvider: params.providerUsed ?? entry.modelProvider,
            model: params.modelUsed ?? entry.model,
            contextTokens: resolvedContextTokens,
            systemPromptReport: params.systemPromptReport ?? entry.systemPromptReport,
            toolDisclosureState: resolveToolDisclosureStatePatch({
              entry,
              toolCallNames: params.toolCallNames,
              systemPromptReport: params.systemPromptReport,
              now,
            }),
            updatedAt: now,
          };
          const cliProvider = params.providerUsed ?? entry.modelProvider;
          if (params.cliSessionId && cliProvider) {
            const nextEntry = { ...entry, ...patch };
            setCliSessionId(nextEntry, cliProvider, params.cliSessionId);
            return {
              ...patch,
              cliSessionIds: nextEntry.cliSessionIds,
              claudeCliSessionId: nextEntry.claudeCliSessionId,
            };
          }
          return patch;
        },
      });
    } catch (err) {
      logVerbose(`failed to persist ${label}usage update: ${String(err)}`);
    }
    return;
  }

  if (params.modelUsed || params.contextTokensUsed) {
    try {
      await updateSessionStoreEntry({
        storePath,
        sessionKey,
        update: async (entry) => {
          const now = Date.now();
          const patch: Partial<SessionEntry> = {
            modelProvider: params.providerUsed ?? entry.modelProvider,
            model: params.modelUsed ?? entry.model,
            contextTokens: params.contextTokensUsed ?? entry.contextTokens,
            systemPromptReport: params.systemPromptReport ?? entry.systemPromptReport,
            toolDisclosureState: resolveToolDisclosureStatePatch({
              entry,
              toolCallNames: params.toolCallNames,
              systemPromptReport: params.systemPromptReport,
              now,
            }),
            updatedAt: now,
          };
          const cliProvider = params.providerUsed ?? entry.modelProvider;
          if (params.cliSessionId && cliProvider) {
            const nextEntry = { ...entry, ...patch };
            setCliSessionId(nextEntry, cliProvider, params.cliSessionId);
            return {
              ...patch,
              cliSessionIds: nextEntry.cliSessionIds,
              claudeCliSessionId: nextEntry.claudeCliSessionId,
            };
          }
          return patch;
        },
      });
    } catch (err) {
      logVerbose(`failed to persist ${label}model/context update: ${String(err)}`);
    }
  }
}
