import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const ListToolsToolSchema = Type.Object({
  tool: Type.Optional(Type.String()),
});

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function summarizeToFiveWords(description: string): string {
  const words = description.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 5).join(" ");
}

function buildListItem(tool: AnyAgentTool): { name: string; summary: string } {
  const source = (tool.description ?? tool.label ?? tool.name).trim();
  return {
    name: tool.name,
    summary: summarizeToFiveWords(source),
  };
}

function buildFullDetail(tool: AnyAgentTool) {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters ?? null,
  };
}

function createListToolsToolInternal(params: {
  tools: () => AnyAgentTool[];
  name: "list_tool" | "list_tools";
  label: string;
}) {
  return {
    name: params.name,
    label: params.label,
    description: "Discover available tools and inspect full tool details.",
    parameters: ListToolsToolSchema,
    execute: async (_toolCallId: string, args: Record<string, unknown>) => {
      const tools = params.tools();
      const requestedToolName = readStringParam(args, "tool", { allowEmpty: false });
      if (!requestedToolName) {
        return jsonResult({
          tools: tools.map(buildListItem),
        });
      }
      const normalized = normalizeName(requestedToolName);
      const found = tools.find((tool) => normalizeName(tool.name) === normalized);
      if (!found) {
        return jsonResult({
          error: `Tool not found: ${requestedToolName}`,
          availableTools: tools.map((tool) => tool.name).toSorted(),
        });
      }
      return jsonResult(buildFullDetail(found));
    },
  } as const;
}

export function createListToolsTool(params: { tools: () => AnyAgentTool[] }) {
  return createListToolsToolInternal({
    tools: params.tools,
    name: "list_tools",
    label: "List Tools",
  });
}

export function createListToolTool(params: { tools: () => AnyAgentTool[] }) {
  return createListToolsToolInternal({
    tools: params.tools,
    name: "list_tool",
    label: "List Tool",
  });
}
