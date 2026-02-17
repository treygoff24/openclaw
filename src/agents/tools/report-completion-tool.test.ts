import { describe, expect, it } from "vitest";
import { COMPLETION_STATUSES, CONFIDENCE_LEVELS } from "../completion-report-parser.js";
import { createReportCompletionTool } from "./report-completion-tool.js";

describe("report_completion tool", () => {
  it("uses optional string enums and keeps summary required", async () => {
    const tool = createReportCompletionTool();
    const schema = tool.parameters as {
      type?: string;
      anyOf?: unknown;
      oneOf?: unknown;
      allOf?: unknown;
      required?: string[];
      properties?: {
        status?: { type?: string; enum?: string[] };
        confidence?: { type?: string; enum?: string[] };
        summary?: { type?: string };
      };
    };

    expect(schema.type).toBe("object");
    expect(schema.anyOf).toBeUndefined();
    expect(schema.oneOf).toBeUndefined();
    expect(schema.allOf).toBeUndefined();
    expect(schema.required).toEqual(["summary"]);
    expect(schema.properties?.status).toMatchObject({
      type: "string",
      enum: Array.from(COMPLETION_STATUSES),
    });
    expect(schema.properties?.confidence).toMatchObject({
      type: "string",
      enum: Array.from(CONFIDENCE_LEVELS),
    });
    expect(schema.properties?.summary?.type).toBe("string");

    const result = await tool.execute("call-1", {
      summary: "Completed task",
    });
    const payload = result.details as {
      summary: string;
      status?: unknown;
      confidence?: unknown;
    };
    expect(payload.summary).toBe("Completed task");
    expect(payload.status).toBeUndefined();
    expect(payload.confidence).toBeUndefined();
  });

  it("normalizes enum-like fields and artifact/blocker/warning lists", async () => {
    const tool = createReportCompletionTool();
    const result = await tool.execute("call-2", {
      status: " COMPLETE ",
      confidence: "HIGH",
      summary: "Finished with warnings",
      artifacts: [{ path: " /tmp/output.json ", description: " " }],
      blockers: ["missing env", "  "],
      warnings: "retry recommended",
    });

    const payload = result.details as {
      summary: string;
      status?: string;
      confidence?: string;
      artifacts?: Array<{ path: string; description?: string }>;
      blockers?: string[];
      warnings?: string[];
    };

    expect(payload).toEqual({
      summary: "Finished with warnings",
      status: "complete",
      confidence: "high",
      artifacts: [{ path: "/tmp/output.json" }],
      blockers: ["missing env"],
      warnings: ["retry recommended"],
    });
  });

  it("requires summary", () => {
    const tool = createReportCompletionTool();
    return expect(tool.execute("call-3", { status: "complete" })).rejects.toThrow(
      /summary required/,
    );
  });
});
