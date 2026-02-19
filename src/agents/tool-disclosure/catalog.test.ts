import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { buildToolCategoryCoverage, buildToolDisclosureCatalog } from "./catalog.js";

function createStubTool(params: {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}): AgentTool<unknown, unknown> {
  return {
    name: params.name,
    label: params.name,
    description: params.description ?? "",
    parameters: params.parameters ?? {},
    execute: async () => ({}) as AgentToolResult<unknown>,
  };
}

describe("tool disclosure catalog", () => {
  it("includes aliases, groups, and schema size estimates", () => {
    const tools = [
      createStubTool({
        name: "exec",
        description: "Run shell commands",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
        },
      }),
      createStubTool({
        name: "web_search",
        description: "Search the web",
      }),
    ];

    const catalog = buildToolDisclosureCatalog(tools);
    const execEntry = catalog.byNormalizedName.get("exec");
    const webEntry = catalog.byNormalizedName.get("web_search");

    expect(execEntry).toBeTruthy();
    expect(execEntry?.aliases).toContain("bash");
    expect(execEntry?.groups).toContain("group:runtime");
    expect(execEntry?.schemaChars).toBeGreaterThan(0);
    expect(webEntry?.groups).toContain("group:web");
  });

  it("builds category coverage for active subsets", () => {
    const tools = [
      createStubTool({ name: "read" }),
      createStubTool({ name: "write" }),
      createStubTool({ name: "web_search" }),
    ];
    const catalog = buildToolDisclosureCatalog(tools);
    const coverage = buildToolCategoryCoverage({
      catalog,
      activeToolNames: ["read", "web_search"],
    });

    const fs = coverage.find((entry) => entry.group === "group:fs");
    const web = coverage.find((entry) => entry.group === "group:web");
    expect(fs?.total).toBe(2);
    expect(fs?.active).toBe(1);
    expect(web?.total).toBe(1);
    expect(web?.active).toBe(1);
  });
});
