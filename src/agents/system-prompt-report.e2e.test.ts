import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type TSchema } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { buildSystemPromptReport } from "./system-prompt-report.js";

function tool(name: string, props: number): AgentTool<TSchema, unknown> {
  const properties: Record<string, TSchema> = {};
  for (let i = 0; i < props; i += 1) {
    properties[`field_${i}`] = Type.String();
  }
  return {
    name,
    label: name,
    description: `${name} description`,
    parameters: Type.Object(properties),
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
      bootstrapMaxChars: 8_000,
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
