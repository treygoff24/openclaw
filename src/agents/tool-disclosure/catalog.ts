import type { AgentTool } from "@mariozechner/pi-agent-core";
import { TOOL_GROUPS, TOOL_NAME_ALIASES, normalizeToolName } from "../tool-policy.js";

const GROUP_LABELS: Record<string, string> = {
  "group:fs": "Workspace & Files",
  "group:runtime": "Shell & Runtime",
  "group:sessions": "Sessions & Delegation",
  "group:memory": "Memory",
  "group:web": "Web",
  "group:ui": "Browser & UI",
  "group:automation": "Automation",
  "group:messaging": "Messaging",
  "group:nodes": "Nodes & Devices",
};

export type ToolDisclosureCatalogEntry = {
  name: string;
  normalizedName: string;
  summary: string;
  aliases: string[];
  groups: string[];
  schemaChars: number;
  keywords: string[];
};

export type ToolDisclosureCatalog = {
  entries: ToolDisclosureCatalogEntry[];
  byNormalizedName: Map<string, ToolDisclosureCatalogEntry>;
};

export type ToolCategoryCoverage = {
  group: string;
  label: string;
  total: number;
  active: number;
  activeToolNames: string[];
};

function estimateSchemaChars(tool: AgentTool): number {
  if (!tool.parameters || typeof tool.parameters !== "object") {
    return 0;
  }
  try {
    return JSON.stringify(tool.parameters).length;
  } catch {
    return 0;
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]+/g, " ")
    .split(/[\s_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function buildAliasMap(): Map<string, string[]> {
  const aliasesByCanonical = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(TOOL_NAME_ALIASES)) {
    const normalizedCanonical = normalizeToolName(canonical);
    const list = aliasesByCanonical.get(normalizedCanonical) ?? [];
    list.push(alias);
    aliasesByCanonical.set(normalizedCanonical, list);
  }
  return aliasesByCanonical;
}

function resolveGroups(normalizedName: string): string[] {
  const groups: string[] = [];
  for (const [group, names] of Object.entries(TOOL_GROUPS)) {
    if (!Array.isArray(names)) {
      continue;
    }
    if (names.includes(normalizedName)) {
      groups.push(group);
    }
  }
  return groups;
}

export function buildToolDisclosureCatalog(tools: AgentTool[]): ToolDisclosureCatalog {
  const aliasMap = buildAliasMap();
  const entries: ToolDisclosureCatalogEntry[] = tools.map((tool) => {
    const normalizedName = normalizeToolName(tool.name);
    const summary = tool.description?.trim() || tool.label?.trim() || "";
    const aliases = Array.from(new Set(aliasMap.get(normalizedName) ?? []));
    const groups = resolveGroups(normalizedName);
    const keywords = Array.from(
      new Set([
        ...tokenize(normalizedName),
        ...aliases.flatMap((alias) => tokenize(alias)),
        ...tokenize(summary),
        ...groups.flatMap((group) => tokenize(group.replace(/^group:/, ""))),
      ]),
    );
    return {
      name: tool.name,
      normalizedName,
      summary,
      aliases,
      groups,
      schemaChars: estimateSchemaChars(tool),
      keywords,
    };
  });

  return {
    entries,
    byNormalizedName: new Map(entries.map((entry) => [entry.normalizedName, entry])),
  };
}

export function buildToolCategoryCoverage(params: {
  catalog: ToolDisclosureCatalog;
  activeToolNames: string[];
}): ToolCategoryCoverage[] {
  const activeSet = new Set(params.activeToolNames.map((name) => normalizeToolName(name)));
  const grouped = new Map<
    string,
    { label: string; total: number; active: number; activeToolNames: string[] }
  >();

  const ensureGroup = (group: string) => {
    const existing = grouped.get(group);
    if (existing) {
      return existing;
    }
    const created = {
      label: GROUP_LABELS[group] ?? group.replace(/^group:/, "").replace(/_/g, " "),
      total: 0,
      active: 0,
      activeToolNames: [] as string[],
    };
    grouped.set(group, created);
    return created;
  };

  for (const entry of params.catalog.entries) {
    const groups = entry.groups.length > 0 ? entry.groups : ["group:other"];
    for (const group of groups) {
      const row = ensureGroup(group);
      row.total += 1;
      if (activeSet.has(entry.normalizedName)) {
        row.active += 1;
        row.activeToolNames.push(entry.name);
      }
    }
  }

  return Array.from(grouped.entries())
    .map(([group, row]) => ({
      group,
      label: row.label,
      total: row.total,
      active: row.active,
      activeToolNames: row.activeToolNames.toSorted((a, b) => a.localeCompare(b)),
    }))
    .filter((row) => row.total > 0)
    .toSorted((a, b) => {
      if (b.active !== a.active) {
        return b.active - a.active;
      }
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return a.label.localeCompare(b.label);
    });
}

export function formatToolCategoryCoverageLines(coverage: ToolCategoryCoverage[]): string[] {
  if (coverage.length === 0) {
    return [];
  }
  return coverage.map((row) => `- ${row.label}: ${row.active}/${row.total} active`);
}
