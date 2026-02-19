import type {
  ToolDisclosureLowConfidenceFallback,
  ToolDisclosureMode,
} from "../../config/types.tools.js";
import type { ToolDisclosureCatalog } from "./catalog.js";
import { normalizeToolName } from "../tool-policy.js";

export type ToolSelectionSource = "always" | "sticky" | "intent";

export type ToolDisclosureSelection = {
  mode: ToolDisclosureMode;
  activeToolNames: string[];
  confidence: number;
  usedFallback: boolean;
  fallbackReason?: "no_match" | "low_confidence";
  selectedBy: Record<ToolSelectionSource, string[]>;
};

export type SelectToolsByIntentParams = {
  mode: ToolDisclosureMode;
  prompt: string;
  catalog: ToolDisclosureCatalog;
  alwaysAllow: string[];
  stickyToolNames?: string[];
  stickyLastSelectionAt?: number;
  maxActiveTools: number;
  minConfidence: number;
  lowConfidenceFallback: ToolDisclosureLowConfidenceFallback;
  stickyMaxTools: number;
  stickyTurns: number;
};

type ScoredTool = {
  name: string;
  normalizedName: string;
  score: number;
};

const GROUP_KEYWORDS: Record<string, string[]> = {
  "group:fs": ["file", "files", "edit", "write", "read", "patch", "repo"],
  "group:runtime": ["bash", "shell", "command", "terminal", "run", "exec"],
  "group:sessions": ["session", "subagent", "delegate", "agent", "status"],
  "group:memory": ["memory", "recall", "remember", "history", "context"],
  "group:web": ["web", "search", "url", "fetch", "website", "internet"],
  "group:ui": ["browser", "canvas", "click", "ui", "page"],
  "group:automation": ["cron", "schedule", "reminder", "update", "gateway"],
  "group:messaging": ["message", "send", "reply", "dm", "chat", "post"],
  "group:nodes": ["node", "device", "camera", "screen", "notify"],
};
const STICKY_TURN_WINDOW_MS = 10 * 60 * 1000;

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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]+/g, " ")
    .split(/[\s_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreTools(params: {
  prompt: string;
  promptTokens: Set<string>;
  catalog: ToolDisclosureCatalog;
}): ScoredTool[] {
  const prompt = params.prompt.toLowerCase();
  const scored: ScoredTool[] = [];

  for (const entry of params.catalog.entries) {
    let score = 0;

    const normalizedNameText = entry.normalizedName.replace(/_/g, " ");
    if (prompt.includes(entry.normalizedName) || prompt.includes(normalizedNameText)) {
      score += 7;
    }

    for (const alias of entry.aliases) {
      const aliasText = alias.replace(/_/g, " ").toLowerCase();
      if (prompt.includes(aliasText)) {
        score += 6;
      }
    }

    for (const keyword of entry.keywords) {
      if (params.promptTokens.has(keyword)) {
        score += 1.5;
      }
    }

    for (const group of entry.groups) {
      const groupKeywords = GROUP_KEYWORDS[group] ?? [];
      if (groupKeywords.some((keyword) => params.promptTokens.has(keyword))) {
        score += 1.5;
      }
    }

    if (score <= 0) {
      continue;
    }
    scored.push({ name: entry.name, normalizedName: entry.normalizedName, score });
  }

  return scored.toSorted((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.name.localeCompare(b.name);
  });
}

function computeConfidence(scores: ScoredTool[]): number {
  if (scores.length === 0) {
    return 0;
  }
  const top = scores[0]?.score ?? 0;
  const second = scores[1]?.score ?? 0;
  const signal = clamp01(top / 12);
  const margin = top > 0 ? clamp01((top - second) / top) : 0;
  const depth = clamp01(Math.min(1, scores.length / 6));
  return clamp01(signal * 0.65 + margin * 0.25 + depth * 0.1);
}

function toSelectedList(selected: Set<string>, catalog: ToolDisclosureCatalog): string[] {
  const normalized = Array.from(selected);
  const order = new Map(catalog.entries.map((entry, index) => [entry.normalizedName, index]));
  return normalized
    .toSorted(
      (a, b) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((name) => catalog.byNormalizedName.get(name)?.name ?? name);
}

export function selectToolsByIntent(params: SelectToolsByIntentParams): ToolDisclosureSelection {
  const selectedBy: Record<ToolSelectionSource, string[]> = {
    always: [],
    sticky: [],
    intent: [],
  };

  const fullToolNames = params.catalog.entries.map((entry) => entry.name);
  if (params.mode !== "auto_intent") {
    return {
      mode: params.mode,
      activeToolNames: fullToolNames,
      confidence: 1,
      usedFallback: false,
      selectedBy,
    };
  }

  const selected = new Set<string>();
  const catalogNames = new Set(params.catalog.entries.map((entry) => entry.normalizedName));

  for (const name of params.alwaysAllow) {
    const normalized = normalizeToolName(name);
    if (!catalogNames.has(normalized)) {
      continue;
    }
    if (selected.has(normalized)) {
      continue;
    }
    selected.add(normalized);
    selectedBy.always.push(params.catalog.byNormalizedName.get(normalized)?.name ?? normalized);
  }

  const stickyFreshnessMs = Math.max(1, params.stickyTurns) * STICKY_TURN_WINDOW_MS;
  const stickyStateFresh =
    params.stickyLastSelectionAt == null ||
    !Number.isFinite(params.stickyLastSelectionAt) ||
    Date.now() - params.stickyLastSelectionAt <= stickyFreshnessMs;

  if (params.stickyTurns > 0 && stickyStateFresh) {
    const stickyCandidates = (params.stickyToolNames ?? [])
      .map((name) => normalizeToolName(name))
      .filter((name) => catalogNames.has(name))
      .filter((name, index, list) => list.indexOf(name) === index)
      .slice(0, Math.max(0, params.stickyMaxTools));
    for (const name of stickyCandidates) {
      if (selected.has(name)) {
        continue;
      }
      selected.add(name);
      selectedBy.sticky.push(params.catalog.byNormalizedName.get(name)?.name ?? name);
    }
  }

  const promptTokens = new Set(tokenize(params.prompt));
  const scored = scoreTools({
    prompt: params.prompt,
    promptTokens,
    catalog: params.catalog,
  });

  for (const score of scored) {
    if (selectedBy.intent.length >= params.maxActiveTools) {
      break;
    }
    if (selected.has(score.normalizedName)) {
      continue;
    }
    selected.add(score.normalizedName);
    selectedBy.intent.push(score.name);
  }

  const confidence = computeConfidence(scored);
  const noMatch = scored.length === 0;

  if (noMatch) {
    return {
      mode: params.mode,
      activeToolNames: fullToolNames,
      confidence,
      usedFallback: true,
      fallbackReason: "no_match",
      selectedBy,
    };
  }

  if (confidence < params.minConfidence) {
    if (params.lowConfidenceFallback === "full") {
      return {
        mode: params.mode,
        activeToolNames: fullToolNames,
        confidence,
        usedFallback: true,
        fallbackReason: "low_confidence",
        selectedBy,
      };
    }

    const widened = new Set(selected);
    const widenLimit = Math.min(
      params.catalog.entries.length,
      Math.max(params.maxActiveTools * 2, selected.size + params.maxActiveTools),
    );
    for (const entry of scored) {
      if (widened.size >= widenLimit) {
        break;
      }
      widened.add(entry.normalizedName);
    }

    return {
      mode: params.mode,
      activeToolNames: toSelectedList(widened, params.catalog),
      confidence,
      usedFallback: true,
      fallbackReason: "low_confidence",
      selectedBy,
    };
  }

  return {
    mode: params.mode,
    activeToolNames: toSelectedList(selected, params.catalog),
    confidence,
    usedFallback: false,
    selectedBy,
  };
}
