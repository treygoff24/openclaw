import type {
  AgentCapabilitiesConfig,
  AgentCapabilityCard,
  AgentCapabilityCostTier,
  AgentModelConfig,
} from "../config/types.agents.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { listAgentIds, resolveAgentConfig } from "./agent-scope.js";

export type DelegationFleetEntry = {
  id: string;
  model?: string;
  description?: string;
  capabilities?: AgentCapabilitiesConfig;
  capabilityCards?: AgentCapabilityCard[];
};

export type DelegationFleetRouting = {
  score: number;
  matchedCardId?: string;
  matchedCardTitle?: string;
  matchedTerms: string[];
  matchedTags?: string[];
  costTier?: AgentCapabilityCostTier;
  typicalLatency?: string;
};

export type RankedDelegationFleetEntry = DelegationFleetEntry & {
  routing?: DelegationFleetRouting;
};

export type SuggestAgentsHint =
  | string
  | {
      hint?: string;
      filter?: string[];
      maxMatches?: number;
    };

const DEFAULT_MAX_MATCHED_TERMS = 6;
const MIN_TERM_LENGTH = 3;
const COST_TIER_ORDER: Record<AgentCapabilityCostTier, number> = {
  free: 0,
  cheap: 1,
  medium: 2,
  expensive: 3,
};

function normalizeText(value?: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.normalize("NFKD").toLowerCase().trim();
}

function normalizeSearchText(value?: unknown): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ");
}

function tokenize(value?: unknown): string[] {
  return normalizeSearchText(value)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((token) => token.length >= MIN_TERM_LENGTH);
}

function dedupeStrings(values: string[]): string[] {
  const unique = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (unique.has(value)) {
      continue;
    }
    unique.add(value);
    out.push(value);
  }
  return out;
}

function normalizeCapabilityCard(value: unknown): AgentCapabilityCard | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const title = normalizeText((value as { title?: unknown }).title);
  if (!title) {
    return undefined;
  }

  const id = normalizeText((value as { id?: unknown }).id);
  const description = normalizeText((value as { description?: unknown }).description);
  const rawKeywords = Array.isArray((value as { keywords?: unknown }).keywords)
    ? ((value as { keywords?: unknown[] }).keywords ?? []).map((keyword) =>
        normalizeSearchText(keyword),
      )
    : [];

  const keywords = dedupeStrings(
    rawKeywords.filter((keyword) => keyword.length >= MIN_TERM_LENGTH),
  );
  const card: AgentCapabilityCard = { title };
  if (id) {
    card.id = id;
  }
  if (description) {
    card.description = description;
  }
  if (keywords.length > 0) {
    card.keywords = keywords;
  }
  return card;
}

function parseCapabilityCardsInternal(value: unknown): AgentCapabilityCard[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: AgentCapabilityCard[] = [];
  for (const item of value) {
    const card = normalizeCapabilityCard(item);
    if (card) {
      out.push(card);
    }
  }
  return out;
}

export function parseCapabilityCards(value: unknown): AgentCapabilityCard[] {
  return parseCapabilityCardsInternal(value);
}

function normalizeCostTier(value: unknown): AgentCapabilityCostTier | undefined {
  const normalized = normalizeText(value);
  if (
    normalized === "free" ||
    normalized === "cheap" ||
    normalized === "medium" ||
    normalized === "expensive"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeCapabilities(value: unknown): AgentCapabilitiesConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const rawTags = Array.isArray((value as { tags?: unknown }).tags)
    ? ((value as { tags?: unknown[] }).tags ?? []).map((tag) => normalizeSearchText(tag))
    : [];
  const tags = dedupeStrings(rawTags.filter((tag) => tag.length >= MIN_TERM_LENGTH));
  const costTier = normalizeCostTier((value as { costTier?: unknown }).costTier);
  const typicalLatency = normalizeText((value as { typicalLatency?: unknown }).typicalLatency);
  const notes = normalizeText((value as { notes?: unknown }).notes);

  const capabilities: AgentCapabilitiesConfig = {};
  if (tags.length > 0) {
    capabilities.tags = tags;
  }
  if (costTier) {
    capabilities.costTier = costTier;
  }
  if (typicalLatency) {
    capabilities.typicalLatency = typicalLatency;
  }
  if (notes) {
    capabilities.notes = notes;
  }
  if (
    !capabilities.tags &&
    !capabilities.costTier &&
    !capabilities.typicalLatency &&
    !capabilities.notes
  ) {
    return undefined;
  }
  return capabilities;
}

export function parseAgentCapabilities(value: unknown): AgentCapabilitiesConfig | undefined {
  return normalizeCapabilities(value);
}

function resolveAgentEntryFromConfig(args: { cfg: OpenClawConfig; agentId: string }) {
  if (!Array.isArray(args.cfg.agents?.list)) {
    return undefined;
  }
  const targetId = normalizeText(args.agentId);
  return args.cfg.agents?.list.find((entry) => normalizeText(entry?.id) === targetId);
}

export function resolveCapabilityCardsFromConfig(args: {
  cfg: OpenClawConfig;
  agentId: string;
}): AgentCapabilityCard[] {
  if (!args?.cfg) {
    return [];
  }
  const entry = resolveAgentEntryFromConfig(args);
  if (!entry || typeof entry !== "object") {
    return [];
  }
  return parseCapabilityCardsInternal((entry as { capabilityCards?: unknown }).capabilityCards);
}

export function resolveAgentCapabilitiesFromConfig(args: {
  cfg: OpenClawConfig;
  agentId: string;
}): AgentCapabilitiesConfig | undefined {
  if (!args?.cfg) {
    return undefined;
  }
  const entry = resolveAgentEntryFromConfig(args);
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  return normalizeCapabilities((entry as { capabilities?: unknown }).capabilities);
}

function scoreTokens(
  sourceTokens: ReadonlyArray<string>,
  querySet: Set<string>,
  matched: Set<string>,
): number {
  let score = 0;
  for (const token of sourceTokens) {
    if (querySet.has(token) && !matched.has(token)) {
      matched.add(token);
      score += 1;
    }
  }
  return score;
}

function scoreRoutingCard(params: {
  card: AgentCapabilityCard;
  querySet: Set<string>;
  queryText: string;
  maxTerms: number;
}): {
  score: number;
  matchedTerms: string[];
} {
  const matched = new Set<string>();
  let score = 0;

  const titleTokens = tokenize(params.card.title);
  score += scoreTokens(titleTokens, params.querySet, matched);

  const descriptionTokens = tokenize(params.card.description);
  score += scoreTokens(descriptionTokens, params.querySet, matched);

  const keywords = params.card.keywords ?? [];
  for (const keyword of keywords) {
    if (keyword.length < MIN_TERM_LENGTH) {
      continue;
    }

    const keywordText = ` ${normalizeSearchText(keyword)} `;
    if (params.queryText.includes(keywordText)) {
      score += 3;
      if (!matched.has(keyword)) {
        matched.add(keyword);
      }
      continue;
    }

    for (const token of tokenize(keyword)) {
      if (params.querySet.has(token) && !matched.has(token)) {
        matched.add(token);
        score += 1;
      }
    }
  }

  const terms = Array.from(matched)
    .slice(0, params.maxTerms)
    .toSorted((a, b) => a.localeCompare(b));

  return { score, matchedTerms: terms };
}

function scoreCapabilitiesMetadata(params: {
  capabilities?: AgentCapabilitiesConfig;
  querySet: Set<string>;
  queryText: string;
  maxTerms: number;
}): {
  score: number;
  matchedTerms: string[];
  matchedTags: string[];
} {
  const matched = new Set<string>();
  const matchedTags = new Set<string>();
  let score = 0;

  const tags = params.capabilities?.tags ?? [];
  for (const tag of tags) {
    if (tag.length < MIN_TERM_LENGTH) {
      continue;
    }
    const normalizedTag = normalizeSearchText(tag);
    const tagText = ` ${normalizedTag} `;
    if (params.queryText.includes(tagText)) {
      matchedTags.add(normalizedTag);
      if (!matched.has(normalizedTag)) {
        matched.add(normalizedTag);
      }
      score += 3;
      continue;
    }
    for (const token of tokenize(normalizedTag)) {
      if (params.querySet.has(token) && !matched.has(token)) {
        matched.add(token);
        matchedTags.add(normalizedTag);
        score += 1;
      }
    }
  }

  const notesTokens = tokenize(params.capabilities?.notes);
  score += scoreTokens(notesTokens, params.querySet, matched);

  const terms = Array.from(matched)
    .slice(0, params.maxTerms)
    .toSorted((a, b) => a.localeCompare(b));
  const tagsOut = Array.from(matchedTags)
    .slice(0, params.maxTerms)
    .toSorted((a, b) => a.localeCompare(b));

  return { score, matchedTerms: terms, matchedTags: tagsOut };
}

function scoreAgentFromDescription(params: {
  id: string;
  description?: string;
  querySet: Set<string>;
  maxTerms: number;
}): DelegationFleetRouting {
  const matched = new Set<string>();
  const descriptionTokens = tokenize(params.description);
  const score = scoreTokens(descriptionTokens, params.querySet, matched);

  return {
    score,
    matchedCardTitle: params.description
      ? `agent ${params.id.toLowerCase()} description`
      : "No specific capability card",
    matchedTerms: Array.from(matched)
      .slice(0, params.maxTerms)
      .toSorted((a, b) => a.localeCompare(b)),
  };
}

function costTierRank(value?: AgentCapabilityCostTier): number {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }
  return COST_TIER_ORDER[value];
}

function parseLatencyMs(value?: string): number | undefined {
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }
  const match =
    /^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/.exec(
      normalized,
    );
  if (!match) {
    return undefined;
  }
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount) || amount < 0) {
    return undefined;
  }
  const unit = match[2];
  if (unit === "ms") {
    return Math.round(amount);
  }
  if (
    unit === "s" ||
    unit === "sec" ||
    unit === "secs" ||
    unit === "second" ||
    unit === "seconds"
  ) {
    return Math.round(amount * 1000);
  }
  if (
    unit === "m" ||
    unit === "min" ||
    unit === "mins" ||
    unit === "minute" ||
    unit === "minutes"
  ) {
    return Math.round(amount * 60_000);
  }
  return Math.round(amount * 3_600_000);
}

function resolveModelLabel(value?: AgentModelConfig): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const primary = value.primary;
  if (typeof primary === "string" && primary.trim()) {
    return primary.trim();
  }
  return undefined;
}

function buildDelegationFleetFromConfig(cfg: OpenClawConfig): DelegationFleetEntry[] {
  const rawEntries = Array.isArray(cfg.agents?.list) ? cfg.agents?.list : [];
  return listAgentIds(cfg).map((id) => {
    const agentConfig = resolveAgentConfig(cfg, id);
    const fallbackDescription = rawEntries.find(
      (entry) => entry?.id?.trim().toLowerCase() === id.toLowerCase(),
    )?.description;
    return {
      id,
      model: resolveModelLabel(agentConfig?.model),
      description: fallbackDescription ?? agentConfig?.name,
      capabilities: resolveAgentCapabilitiesFromConfig({ cfg, agentId: id }),
      capabilityCards: resolveCapabilityCardsFromConfig({ cfg, agentId: id }),
    };
  });
}

function resolveSuggestionHintText(hint: SuggestAgentsHint): string {
  if (typeof hint === "string") {
    return hint;
  }
  return typeof hint?.hint === "string" ? hint.hint : "";
}

function resolveSuggestionFilter(hint: SuggestAgentsHint): Set<string> | undefined {
  if (!hint || typeof hint === "string" || !Array.isArray(hint.filter)) {
    return undefined;
  }
  const normalized = hint.filter
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? new Set(normalized) : new Set();
}

function resolveSuggestionLimit(hint: SuggestAgentsHint): number | undefined {
  if (!hint || typeof hint === "string") {
    return undefined;
  }
  if (typeof hint.maxMatches !== "number" || !Number.isFinite(hint.maxMatches)) {
    return undefined;
  }
  return Math.max(1, Math.floor(hint.maxMatches));
}

export function suggestAgents(
  hint: SuggestAgentsHint,
  cfg: OpenClawConfig,
): RankedDelegationFleetEntry[] {
  const fleet = buildDelegationFleetFromConfig(cfg ?? {});
  const ranked = rankAgentsForTask({
    task: resolveSuggestionHintText(hint),
    fleet,
  });
  const filter = resolveSuggestionFilter(hint);
  const filtered = filter ? ranked.filter((entry) => filter.has(normalizeText(entry.id))) : ranked;
  const maxMatches = resolveSuggestionLimit(hint);
  if (maxMatches == null) {
    return filtered;
  }
  return filtered.slice(0, maxMatches);
}

export function rankAgentsForTask(params: {
  task: string;
  fleet: DelegationFleetEntry[];
  maxMatches?: number;
}): RankedDelegationFleetEntry[] {
  const taskText = ` ${normalizeSearchText(params.task)} `;
  const queryTokens = tokenize(params.task);
  const querySet = new Set(queryTokens);
  const maxMatches =
    typeof params.maxMatches === "number" && Number.isFinite(params.maxMatches)
      ? Math.max(1, Math.floor(params.maxMatches))
      : DEFAULT_MAX_MATCHED_TERMS;

  const fleet = Array.isArray(params.fleet) ? params.fleet : [];
  const ranked = fleet.map((agent) => {
    const cards = parseCapabilityCards(agent.capabilityCards);
    const capabilities = normalizeCapabilities(agent.capabilities);
    let bestScore = 0;
    let bestTitle: string | undefined;
    let bestId: string | undefined;
    let bestTerms: string[] = [];
    let bestTags: string[] = [];

    if (querySet.size > 0) {
      const capabilityRouting = scoreCapabilitiesMetadata({
        capabilities,
        querySet,
        queryText: taskText,
        maxTerms: maxMatches,
      });
      if (capabilityRouting.score > bestScore) {
        bestScore = capabilityRouting.score;
        bestTitle = "capabilities";
        bestTerms = capabilityRouting.matchedTerms;
        bestTags = capabilityRouting.matchedTags;
      }

      for (const card of cards) {
        const rankedCard = scoreRoutingCard({
          card,
          querySet,
          queryText: taskText,
          maxTerms: maxMatches,
        });
        if (
          rankedCard.score > bestScore ||
          (rankedCard.score === bestScore && card.title < (bestTitle ?? ""))
        ) {
          bestScore = rankedCard.score;
          bestTitle = card.title;
          bestId = card.id;
          bestTerms = rankedCard.matchedTerms;
          bestTags = [];
        }
      }

      if (bestScore === 0) {
        const fallback = scoreAgentFromDescription({
          id: agent.id,
          description: agent.description,
          querySet,
          maxTerms: maxMatches,
        });
        bestScore = fallback.score;
        bestTitle = fallback.matchedCardTitle;
        bestTerms = fallback.matchedTerms;
        bestTags = [];
      }
    } else if (agent.description) {
      const fallback = scoreAgentFromDescription({
        id: agent.id,
        description: agent.description,
        querySet,
        maxTerms: maxMatches,
      });
      bestScore = fallback.score;
      bestTitle = fallback.matchedCardTitle;
      bestTerms = fallback.matchedTerms;
      bestTags = [];
    }

    return {
      ...agent,
      capabilities,
      capabilityCards: cards,
      routing: {
        score: bestScore,
        matchedCardId: bestId,
        matchedCardTitle: bestTitle,
        matchedTerms: bestTerms,
        matchedTags: bestTags,
        costTier: capabilities?.costTier,
        typicalLatency: capabilities?.typicalLatency,
      },
    } satisfies RankedDelegationFleetEntry;
  });

  return ranked.toSorted((a, b) => {
    const aScore = a.routing?.score ?? 0;
    const bScore = b.routing?.score ?? 0;
    if (aScore !== bScore) {
      return bScore - aScore;
    }
    const aCost = costTierRank(a.capabilities?.costTier);
    const bCost = costTierRank(b.capabilities?.costTier);
    if (aCost !== bCost) {
      return aCost - bCost;
    }
    const aLatency = parseLatencyMs(a.capabilities?.typicalLatency);
    const bLatency = parseLatencyMs(b.capabilities?.typicalLatency);
    if (aLatency != null || bLatency != null) {
      if (aLatency == null) {
        return 1;
      }
      if (bLatency == null) {
        return -1;
      }
      if (aLatency !== bLatency) {
        return aLatency - bLatency;
      }
    }
    return a.id.localeCompare(b.id);
  });
}
