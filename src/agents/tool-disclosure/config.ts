import type { OpenClawConfig } from "../../config/config.js";
import type {
  ToolDisclosureConfig,
  ToolDisclosureLowConfidenceFallback,
  ToolDisclosureMode,
} from "../../config/types.tools.js";
import { resolveAgentConfig } from "../agent-scope.js";
import { normalizeToolName } from "../tool-policy.js";

const DEFAULT_ALWAYS_ALLOW = ["session_status", "read", "ls", "grep"];
const DEFAULT_MAX_ACTIVE_TOOLS = 12;
const DEFAULT_MIN_CONFIDENCE = 0.35;
const DEFAULT_LOW_CONFIDENCE_FALLBACK: ToolDisclosureLowConfidenceFallback = "full";
const DEFAULT_INCLUDE_CATEGORY_SUMMARY = true;
const DEFAULT_STICKY_TURNS = 4;
const DEFAULT_STICKY_MAX_TOOLS = 12;

export type ResolvedToolDisclosureConfig = {
  mode: ToolDisclosureMode;
  alwaysAllow: string[];
  maxActiveTools: number;
  minConfidence: number;
  lowConfidenceFallback: ToolDisclosureLowConfidenceFallback;
  includeCategorySummary: boolean;
  stickyTurns: number;
  stickyMaxTools: number;
};

function coerceMode(value: unknown): ToolDisclosureMode {
  return value === "auto_intent" ? "auto_intent" : "off";
}

function coerceAlwaysAllow(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ALWAYS_ALLOW];
  }
  const normalized = value
    .map((item) => (typeof item === "string" ? normalizeToolName(item) : ""))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function coercePositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function coerceNonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function coerceUnitFloat(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function mergeDisclosureConfig(
  base: ToolDisclosureConfig | undefined,
  override: ToolDisclosureConfig | undefined,
): ToolDisclosureConfig {
  if (!base && !override) {
    return {};
  }
  if (!base) {
    return { ...override };
  }
  if (!override) {
    return { ...base };
  }
  return {
    ...base,
    ...override,
    alwaysAllow: override.alwaysAllow ?? base.alwaysAllow,
  };
}

export function resolveToolDisclosureConfig(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
}): ResolvedToolDisclosureConfig {
  const cfg = params.cfg ?? {};
  const defaults = cfg.agents?.defaults?.toolDisclosure;
  const agentOverride = params.agentId
    ? resolveAgentConfig(cfg, params.agentId)?.toolDisclosure
    : undefined;
  const merged = mergeDisclosureConfig(defaults, agentOverride);

  const mode = coerceMode(merged.mode ?? defaults?.mode);
  const alwaysAllow = coerceAlwaysAllow(merged.alwaysAllow ?? defaults?.alwaysAllow);
  const maxActiveTools = coercePositiveInt(
    merged.maxActiveTools ?? defaults?.maxActiveTools,
    DEFAULT_MAX_ACTIVE_TOOLS,
  );
  const minConfidence = coerceUnitFloat(
    merged.minConfidence ?? defaults?.minConfidence,
    DEFAULT_MIN_CONFIDENCE,
  );
  const lowConfidenceFallback =
    merged.lowConfidenceFallback === "widen" || merged.lowConfidenceFallback === "full"
      ? merged.lowConfidenceFallback
      : DEFAULT_LOW_CONFIDENCE_FALLBACK;
  const includeCategorySummary =
    typeof merged.includeCategorySummary === "boolean"
      ? merged.includeCategorySummary
      : DEFAULT_INCLUDE_CATEGORY_SUMMARY;
  const stickyTurns = coerceNonNegativeInt(
    merged.stickyTurns ?? defaults?.stickyTurns,
    DEFAULT_STICKY_TURNS,
  );
  const stickyMaxTools = coercePositiveInt(
    merged.stickyMaxTools ?? defaults?.stickyMaxTools,
    DEFAULT_STICKY_MAX_TOOLS,
  );

  return {
    mode,
    alwaysAllow,
    maxActiveTools,
    minConfidence,
    lowConfidenceFallback,
    includeCategorySummary,
    stickyTurns,
    stickyMaxTools,
  };
}
