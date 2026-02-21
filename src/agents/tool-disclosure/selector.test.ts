import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type TSchema } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { buildToolDisclosureCatalog } from "./catalog.js";
import { selectToolsByIntent } from "./selector.js";

function createStubTool(name: string, description = ""): AgentTool<TSchema, unknown> {
  return {
    name,
    label: name,
    description,
    parameters: Type.Object({
      input: Type.String(),
    }),
    execute: async () => ({}) as AgentToolResult<unknown>,
  };
}

function buildCatalog() {
  return buildToolDisclosureCatalog([
    createStubTool("read", "Read file contents"),
    createStubTool("write", "Write file contents"),
    createStubTool("exec", "Run shell commands"),
    createStubTool("web_search", "Search the web"),
    createStubTool("session_status", "Show session status"),
  ]);
}

describe("selectToolsByIntent", () => {
  it("selects intent-matching tools", () => {
    const selection = selectToolsByIntent({
      mode: "auto_intent",
      prompt: "search the web for release notes",
      catalog: buildCatalog(),
      alwaysAllow: ["session_status"],
      stickyToolNames: [],
      maxActiveTools: 2,
      minConfidence: 0,
      lowConfidenceFallback: "full",
      stickyMaxTools: 4,
      stickyTurns: 4,
    });

    expect(selection.activeToolNames).toContain("web_search");
    expect(selection.activeToolNames).toContain("session_status");
    expect(selection.usedFallback).toBe(false);
  });

  it("enforces alwaysAllow even when prompt does not match", () => {
    const selection = selectToolsByIntent({
      mode: "auto_intent",
      prompt: "hello",
      catalog: buildCatalog(),
      alwaysAllow: ["session_status"],
      stickyToolNames: [],
      maxActiveTools: 1,
      minConfidence: 0,
      lowConfidenceFallback: "widen",
      stickyMaxTools: 4,
      stickyTurns: 4,
    });

    expect(selection.selectedBy.always).toContain("session_status");
  });

  it("merges sticky tools up to stickyMaxTools", () => {
    const selection = selectToolsByIntent({
      mode: "auto_intent",
      prompt: "edit file",
      catalog: buildCatalog(),
      alwaysAllow: [],
      stickyToolNames: ["exec", "read", "web_search"],
      maxActiveTools: 1,
      minConfidence: 0,
      lowConfidenceFallback: "full",
      stickyMaxTools: 2,
      stickyTurns: 4,
    });

    expect(selection.selectedBy.sticky).toHaveLength(2);
    expect(selection.activeToolNames).toContain("exec");
    expect(selection.activeToolNames).toContain("read");
  });

  it("falls back to full tools on low confidence when configured", () => {
    const catalog = buildCatalog();
    const selection = selectToolsByIntent({
      mode: "auto_intent",
      prompt: "do something maybe",
      catalog,
      alwaysAllow: [],
      stickyToolNames: [],
      maxActiveTools: 2,
      minConfidence: 0.95,
      lowConfidenceFallback: "full",
      stickyMaxTools: 4,
      stickyTurns: 4,
    });

    expect(selection.usedFallback).toBe(true);
    expect(selection.activeToolNames).toHaveLength(catalog.entries.length);
  });
});
