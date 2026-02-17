import { describe, expect, it } from "vitest";
import { parseCompletionReport } from "./completion-report-parser.js";

describe("parseCompletionReport", () => {
  it("scans from the end and prefers latest case-insensitive fields", () => {
    const text = `
  status: partial
  confidence: low
  summary: Should be ignored by the older block
  Status: COMPLETE
  Confidence: High
  SUMMARY:
  - Final summary from the latest block
`;

    const parsed = parseCompletionReport(text);
    expect(parsed).toEqual({
      status: "complete",
      confidence: "high",
      summary: "Final summary from the latest block",
    });
  });

  it("skips fenced code blocks while scanning from end", () => {
    const text = `
  status: failed
  confidence: low
  summary: This result should win


  \`\`\`
  Status: complete
  Confidence: medium
  Summary: wrong
  \`\`\`
  artifacts:
  - /tmp/from-real.md - actual artifact
`;

    const parsed = parseCompletionReport(text);
    expect(parsed?.status).toBe("failed");
    expect(parsed?.confidence).toBe("low");
    expect(parsed?.summary).toBe("This result should win");
    expect(parsed?.artifacts).toEqual([
      {
        path: "/tmp/from-real.md",
        description: "actual artifact",
      },
    ]);
  });

  it("parses artifact/blocker/warning sections", () => {
    const text = `
  SUMMARY: Completed end-to-end validation.
  Artifacts:
  - /tmp/output.json - full output
  - /tmp/report.txt
  Blockers:
  - API key missing for optional feature
  - Third-party downtime
  Warnings:
  - Retry may be needed
  - Check quotas in billing
`;

    const parsed = parseCompletionReport(text);

    expect(parsed?.status).toBeUndefined();
    expect(parsed?.confidence).toBeUndefined();
    expect(parsed?.summary).toBe("Completed end-to-end validation.");
    expect(parsed?.artifacts).toEqual([
      { path: "/tmp/output.json", description: "full output" },
      { path: "/tmp/report.txt" },
    ]);
    expect(parsed?.blockers).toEqual([
      "API key missing for optional feature",
      "Third-party downtime",
    ]);
    expect(parsed?.warnings).toEqual(["Retry may be needed", "Check quotas in billing"]);
  });

  it("returns null for missing recognizable fields", () => {
    const text = `The run completed, but there was no parseable completion report block.`;
    const parsed = parseCompletionReport(text);
    expect(parsed).toBeNull();
  });

  it("ignores malformed scalar values but keeps valid fields", () => {
    const text = `
  status: done
  confidence: very_high
  summary: Still completed with malformed scalars
  blockers: - one
`;

    const parsed = parseCompletionReport(text);
    expect(parsed?.status).toBeUndefined();
    expect(parsed?.confidence).toBeUndefined();
    expect(parsed?.summary).toBe("Still completed with malformed scalars");
    expect(parsed?.blockers).toEqual(["one"]);
  });

  it("returns null when report has only malformed scalar values", () => {
    const text = `
  status: unknown
  confidence: uncertain
  blockers:
    -   
  warnings:
  -   
`;

    const parsed = parseCompletionReport(text);
    expect(parsed).toBeNull();
  });

  it("falls back to an earlier valid field if the latest is malformed", () => {
    const text = `
  status: complete
  confidence: high
  summary: Keep this older summary
  status: done
  confidence: very_high
  summary:
`;

    const parsed = parseCompletionReport(text);
    expect(parsed).toEqual({
      status: "complete",
      confidence: "high",
      summary: "Keep this older summary",
    });
  });
});
