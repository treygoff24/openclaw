export type ParsedAgentSessionKey = {
  agentId: string;
  rest: string;
};

let getRunByChildKeyGlobal: ((key: string) => { depth?: number } | undefined) | undefined;

export function setRegistryAccessor(
  fn: ((key: string) => { depth?: number } | undefined) | undefined,
): void {
  getRunByChildKeyGlobal = fn;
}

export function parseAgentSessionKey(
  sessionKey: string | undefined | null,
): ParsedAgentSessionKey | null {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return null;
  }
  const parts = raw.split(":").filter(Boolean);
  if (parts.length < 3) {
    return null;
  }
  if (parts[0] !== "agent") {
    return null;
  }
  const agentId = parts[1]?.trim();
  const rest = parts.slice(2).join(":");
  if (!agentId || !rest) {
    return null;
  }
  return { agentId, rest };
}

export function isCronRunSessionKey(sessionKey: string | undefined | null): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return false;
  }
  return /^cron:[^:]+:run:[^:]+$/.test(parsed.rest);
}

export function isSubagentSessionKey(sessionKey: string | undefined | null): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return false;
  }
  if (raw.toLowerCase().startsWith("subagent:")) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  return Boolean((parsed?.rest ?? "").toLowerCase().startsWith("subagent:"));
}

export function isAcpSessionKey(sessionKey: string | undefined | null): boolean {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return false;
  }
  const normalized = raw.toLowerCase();
  if (normalized.startsWith("acp:")) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  return Boolean((parsed?.rest ?? "").toLowerCase().startsWith("acp:"));
}

export function getSubagentDepth(sessionKey: string | undefined | null): number {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return 0;
  }
  const parsed = parseAgentSessionKey(raw);
  if (!parsed) {
    return 0;
  }
  const rest = parsed.rest.toLowerCase();
  if (!rest.startsWith("subagent:")) {
    return 0;
  }
  const segments = getValidatedSubagentSegments(raw);
  if (!segments) {
    return 0;
  }
  const registryRecord = getRunByChildKeyGlobal?.(raw);
  if (registryRecord?.depth != null && registryRecord.depth > 0) {
    return registryRecord.depth;
  }
  return segments.length;
}

/**
 * @deprecated Unreliable for cross-agent recursive spawns. Use SubagentRegistry
 * (getRunByChildKey + requesterSessionKey) for lineage lookups instead.
 * Retained only for backward compatibility with non-recursive code paths.
 */
export function getParentSubagentKey(sessionKey: string | undefined | null): string | null {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return null;
  }
  const depth = getSubagentDepth(raw);
  if (depth === 0) {
    return null;
  }
  if (depth === 1) {
    const parsed = parseAgentSessionKey(raw);
    if (!parsed) {
      return null;
    }
    return `agent:${parsed.agentId}:main`;
  }
  const normalized = raw.toLowerCase();
  const lastSubIdx = normalized.lastIndexOf(":sub:");
  if (lastSubIdx <= 0) {
    return null;
  }
  return raw.substring(0, lastSubIdx);
}

const SUBAGENT_MARKER = "subagent";
const SUB_MARKER = "sub";

function getValidatedSubagentSegments(raw: string): string[] | null {
  const restStart = findNthColonIndex(raw, 2);
  if (restStart === null) {
    return null;
  }
  const rest = raw.slice(restStart + 1);
  if (!rest) {
    return null;
  }
  const tokens = rest.toLowerCase().split(":");
  if (tokens[0] !== SUBAGENT_MARKER) {
    return null;
  }
  const firstId = tokens[1]?.trim();
  if (!firstId) {
    return null;
  }
  const segments = [firstId];
  let i = 2;
  while (i < tokens.length) {
    const marker = tokens[i]?.trim();
    if (marker !== SUB_MARKER) {
      break;
    }
    const child = tokens[i + 1]?.trim();
    if (!child) {
      return null;
    }
    segments.push(child);
    i += 2;
  }
  return segments;
}

function findNthColonIndex(raw: string, n: number): number | null {
  let count = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === ":") {
      count++;
      if (count === n) {
        return i;
      }
    }
  }
  return null;
}

const THREAD_SESSION_MARKERS = [":thread:", ":topic:"];

export function resolveThreadParentSessionKey(
  sessionKey: string | undefined | null,
): string | null {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  let idx = -1;
  for (const marker of THREAD_SESSION_MARKERS) {
    const candidate = normalized.lastIndexOf(marker);
    if (candidate > idx) {
      idx = candidate;
    }
  }
  if (idx <= 0) {
    return null;
  }
  const parent = raw.slice(0, idx).trim();
  return parent ? parent : null;
}
