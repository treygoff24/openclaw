import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { buildSystemPromptReport } from "./system-prompt-report.js";

function tool(name: string, props: number): AgentTool<unknown, unknown> {
  const properties: Record<string, { type: string }> = {};
  for (let i = 0; i < props; i += 1) {
    properties[`field_${i}`] = { type: "string" };
  }
  return {
    name,
    label: name,
    description: `${name} description`,
    parameters: {
      type: "object",
      properties,
    },
    execute: async () => ({}) as AgentToolResult<unknown>,
  };
}

describe("buildSystemPromptReport", () => {
  it("reports full vs active tool schema sizes", () => {
    const activeTools = [tool("read", 1), tool("session_status", 1)];
    const fullTools = [...activeTools, tool("web_search", 3)];

    const report = buildSystemPromptReport({
      source: "run",
      generatedAt: Date.now(),
      systemPrompt:
        "Tool names are case-sensitive. Call tools exactly as listed.\n- read\nTOOLS.md does not control tool availability; it is user guidance for how to use external tools.",
      bootstrapFiles: [],
      injectedFiles: [],
      skillsPrompt: "",
      activeTools,
      fullToolsEstimate: fullTools,
      toolDisclosure: {
        mode: "auto_intent",
        selectionConfidence: 0.72,
        selectedBy: {
          always: ["session_status"],
          sticky: [],
          intent: ["read"],
        },
      },
    });

    expect(report.tools.disclosureMode).toBe("auto_intent");
    expect(report.tools.fullCount).toBe(3);
    expect(report.tools.activeCount).toBe(2);
    expect(report.tools.schemaCharsFullEstimate).toBeGreaterThan(report.tools.schemaCharsActive);
    expect(report.tools.schemaCharsSaved).toBeGreaterThan(0);
    expect(report.tools.selectionConfidence).toBeCloseTo(0.72, 2);
    expect(report.tools.selectedBy.always).toContain("session_status");
    expect(report.tools.selectedBy.intent).toContain("read");
  });
});
