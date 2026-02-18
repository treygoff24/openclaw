import type { OpenClawConfig } from "../config/config.js";
import type { DeliveryContext } from "../utils/delivery-context.js";
import { compileGlobPatterns, matchesAnyGlobPattern } from "./glob-pattern.js";
import { expandToolGroups, normalizeToolName } from "./tool-policy.js";

function splitModelRef(ref?: string) {
  if (!ref) {
    return { provider: undefined, model: undefined };
  }
  const trimmed = ref.trim();
  if (!trimmed) {
    return { provider: undefined, model: undefined };
  }
  const [provider, model] = trimmed.split("/", 2);
  if (model) {
    return { provider, model };
  }
  return { provider: undefined, model: trimmed };
}

export function normalizeToolOverrideEntries(values?: string[]): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value): value is string => Boolean(value));
}

async function resolveTargetAgentToolNames(params: {
  cfg: OpenClawConfig;
  targetAgentId: string;
  requesterInternalKey: string;
  requesterOrigin?: DeliveryContext;
  resolvedProvider?: string;
  resolvedModel?: string;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
}): Promise<string[]> {
  const { createOpenClawCodingTools } = await import("./pi-tools.js");
  const modelProvider =
    params.resolvedProvider?.trim() || splitModelRef(params.resolvedModel).provider;
  const modelId =
    splitModelRef(params.resolvedModel).model ?? params.resolvedModel?.trim() ?? undefined;
  const toolSessionKey = `agent:${params.targetAgentId}:subagent:tool-override-validation`;
  const tools = createOpenClawCodingTools({
    config: params.cfg,
    sessionKey: toolSessionKey,
    spawnedBy: params.requesterInternalKey,
    messageProvider: params.requesterOrigin?.channel,
    agentAccountId: params.requesterOrigin?.accountId,
    groupId: params.agentGroupId ?? null,
    groupChannel: params.agentGroupChannel ?? null,
    groupSpace: params.agentGroupSpace ?? null,
    senderIsOwner: true,
    modelProvider,
    modelId,
  });
  return tools.map((tool) => normalizeToolName(tool.name));
}

function findInvalidAllowOverrides(params: {
  allow: string[];
  availableToolNames: string[];
}): string[] {
  const normalizedToolNames = new Set(
    params.availableToolNames.map((value) => normalizeToolName(value)),
  );
  const invalid: string[] = [];
  for (const entry of params.allow) {
    const expanded = expandToolGroups([entry]);
    if (expanded.length === 0) {
      invalid.push(entry);
      continue;
    }
    const matcher = compileGlobPatterns({
      raw: expanded,
      normalize: normalizeToolName,
    });
    const matches = Array.from(normalizedToolNames).some((name) =>
      matchesAnyGlobPattern(name, matcher),
    );
    if (!matches) {
      invalid.push(entry);
    }
  }
  return invalid;
}

export async function validateToolOverridesAllowForTargetAgent(params: {
  cfg: OpenClawConfig;
  targetAgentId: string;
  allow?: string[];
  requesterInternalKey: string;
  requesterOrigin?: DeliveryContext;
  resolvedProvider?: string;
  resolvedModel?: string;
  agentGroupId?: string | null;
  agentGroupChannel?: string | null;
  agentGroupSpace?: string | null;
}): Promise<{
  normalizedAllow: string[];
  invalidAllow: string[];
  availableToolNames: string[];
}> {
  const normalizedAllow = normalizeToolOverrideEntries(params.allow);
  if (normalizedAllow.length === 0) {
    return {
      normalizedAllow,
      invalidAllow: [],
      availableToolNames: [],
    };
  }

  const availableToolNames = await resolveTargetAgentToolNames({
    cfg: params.cfg,
    targetAgentId: params.targetAgentId,
    requesterInternalKey: params.requesterInternalKey,
    requesterOrigin: params.requesterOrigin,
    resolvedProvider: params.resolvedProvider,
    resolvedModel: params.resolvedModel,
    agentGroupId: params.agentGroupId,
    agentGroupChannel: params.agentGroupChannel,
    agentGroupSpace: params.agentGroupSpace,
  });
  const invalidAllow = findInvalidAllowOverrides({
    allow: normalizedAllow,
    availableToolNames,
  });
  return {
    normalizedAllow,
    invalidAllow,
    availableToolNames,
  };
}
