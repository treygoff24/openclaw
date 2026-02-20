import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { createListToolTool, createListToolsTool } from "./list-tools-tool.js";

function createFakeTool(name: string, description: string): AgentTool<unknown, unknown> {
  return {
    name,
    label: `${name}-label`,
    description,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
        },
      },
    },
    execute: async () => ({}) as AgentToolResult<unknown>,
  };
}

describe("list tools tool", () => {
  it("returns short summaries when called with no args", async () => {
    const tools = [
      createFakeTool(
        "read",
        "Read a file from disk and show contents line by line for quick inspection",
      ),
      createFakeTool("write", "Write text to a file with full overwrite semantics"),
    ];
    const listToolsTool = createListToolsTool({
      tools: () => tools,
    });

    const result = await listToolsTool.execute("call-list", {});
    const payload = (result.details ?? {}) as {
      tools?: Array<{ name: string; summary: string }>;
    };
    const summaries = payload.tools?.map((entry) => entry.summary) ?? [];

    expect(summaries).toEqual(["Read a file from disk", "Write text to a file"]);
    expect(summaries.every((summary) => summary.split(" ").filter(Boolean).length <= 5)).toBe(true);
  });

  it("returns full details for a requested tool", async () => {
    const tools = [
      createFakeTool(
        "read",
        "Read a file from disk and show contents line by line for quick inspection",
      ),
      createFakeTool("write", "Write text to a file with full overwrite semantics"),
    ];
    const listToolsTool = createListToolsTool({
      tools: () => tools,
    });

    const result = await listToolsTool.execute("call-detail", { tool: "read" });
    const payload = (result.details ?? {}) as {
      name?: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };

    expect(result.content[0]?.type).toBe("text");
    expect(payload.name).toBe("read");
    expect(payload.description).toBe(
      "Read a file from disk and show contents line by line for quick inspection",
    );
    expect(payload.parameters?.type).toBe("object");
  });

  it("keeps list_tool as a compatibility alias", async () => {
    const tools = [
      createFakeTool(
        "read",
        "Read a file from disk and show contents line by line for quick inspection",
      ),
    ];
    const listToolAlias = createListToolTool({
      tools: () => tools,
    });

    const result = await listToolAlias.execute("call-alias", {});
    const payload = (result.details ?? {}) as {
      tools?: Array<{ name: string; summary: string }>;
    };

    expect(payload.tools?.map((entry) => entry.name)).toEqual(["read"]);
  });

  it("returns the same not-found response with list_tool alias", async () => {
    const tools = [
      createFakeTool(
        "read",
        "Read a file from disk and show contents line by line for quick inspection",
      ),
    ];
    const listToolAlias = createListToolTool({
      tools: () => tools,
    });

    const result = await listToolAlias.execute("call-alias-missing", { tool: "nope" });
    const payload = (result.details ?? {}) as {
      error?: string;
      availableTools?: string[];
    };

    expect(payload.error).toContain("Tool not found: nope");
    expect(payload.availableTools).toEqual(["read"]);
  });

  it("returns a useful error and full list when tool is missing", async () => {
    const tools = [
      createFakeTool(
        "read",
        "Read a file from disk and show contents line by line for quick inspection",
      ),
      createFakeTool("write", "Write text to a file with full overwrite semantics"),
    ];
    const listToolsTool = createListToolsTool({
      tools: () => tools,
    });

    const result = await listToolsTool.execute("call-missing", { tool: "nope" });
    const payload = (result.details ?? {}) as {
      error?: string;
      availableTools?: string[];
    };

    expect(payload.error).toContain("Tool not found: nope");
    expect(payload.availableTools).toEqual(["read", "write"]);
  });
});
