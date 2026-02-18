import { describe, expect, it, vi } from "vitest";
import * as capabilityRouting from "./capability-routing.js";
import { buildDelegationPrompt } from "./delegation-prompt.js";
import { buildSubagentSystemPrompt } from "./subagent-announce.js";

describe("buildDelegationPrompt", () => {
  it("builds Tier 1 prompt with fleet table and Full Orchestrator guidance", () => {
    const prompt = buildDelegationPrompt({
      depth: 1,
      maxDepth: 4,
      parentKey: "agent:main:subagent:parent",
      childSlotsAvailable: 3,
      maxChildrenPerAgent: 4,
      globalSlotsAvailable: 6,
      maxConcurrent: 8,
      fleet: [
        { id: "main", model: "anthropic/claude-sonnet-4", description: "General orchestrator" },
      ],
      providerSlots: [
        { provider: "openai", available: 7, active: 1, pending: 0, total: 1, max: 8 },
      ],
    });

    expect(prompt).toContain("Delegation Tier: Full Orchestrator");
    expect(prompt).toContain(
      "| Agent ID | Model | Description | Tags | Cost Tier | Typical Latency | Notes |",
    );
    expect(prompt).not.toContain("## Provider Slots");
  });

  it("builds Tier 2 prompt that marks children as leaf workers", () => {
    const prompt = buildDelegationPrompt({
      depth: 3,
      maxDepth: 4,
      parentKey: "agent:main:subagent:parent",
      childSlotsAvailable: 1,
      maxChildrenPerAgent: 2,
      globalSlotsAvailable: 2,
      maxConcurrent: 8,
      fleet: [{ id: "cheap", model: "openai/gpt-4.1-mini", description: "Budget worker" }],
    });

    expect(prompt).toContain("Delegation Tier: Last Delegator");
    expect(prompt).toContain("leaf workers");
  });

  it("renders provider slots table for delegators", () => {
    const prompt = buildDelegationPrompt({
      depth: 2,
      maxDepth: 4,
      parentKey: "agent:main:subagent:parent",
      childSlotsAvailable: 2,
      maxChildrenPerAgent: 4,
      globalSlotsAvailable: 5,
      maxConcurrent: 8,
      fleet: [{ id: "main", model: "anthropic/claude-sonnet-4", description: "General" }],
      providerSlots: [
        { provider: "google", available: 1, active: 2, pending: 0, total: 2, max: 3 },
        { provider: "openai", available: 6, active: 1, pending: 1, total: 2, max: 8 },
      ],
    });

    expect(prompt).toContain("## Provider Slots");
    expect(prompt).toContain("| Provider | Available | Active | Pending | Used | Max |");
    expect(prompt).toContain("| google | 1 | 2 | 0 | 2 | 3 |");
    expect(prompt).toContain("| openai | 6 | 1 | 1 | 2 | 8 |");
  });

  it("builds Tier 3 prompt with Leaf Worker constraints and no fleet table", () => {
    const prompt = buildDelegationPrompt({
      depth: 4,
      maxDepth: 4,
      parentKey: "agent:main:subagent:parent",
      childSlotsAvailable: 0,
      maxChildrenPerAgent: 2,
      globalSlotsAvailable: 0,
      maxConcurrent: 8,
      fleet: [{ id: "main", model: "anthropic/claude-sonnet-4", description: "General" }],
      providerSlots: [
        { provider: "google", available: 0, active: 2, pending: 1, total: 3, max: 3 },
      ],
    });

    expect(prompt).toContain("Delegation Tier: Leaf Worker");
    expect(prompt).toContain("Complete your task directly. Do not attempt to spawn subagents.");
    expect(prompt).not.toContain("## Provider Slots");
    expect(prompt).not.toContain(
      "| Agent ID | Model | Description | Tags | Cost Tier | Typical Latency | Notes |",
    );
  });

  it("renders fleet table rows with capability metadata", () => {
    const prompt = buildDelegationPrompt({
      depth: 1,
      maxDepth: 3,
      parentKey: "agent:main:subagent:parent",
      childSlotsAvailable: 2,
      maxChildrenPerAgent: 4,
      globalSlotsAvailable: 4,
      maxConcurrent: 8,
      fleet: [
        {
          id: "main",
          model: "anthropic/claude-opus-4",
          description: "Plans and routes",
          capabilities: {
            tags: ["orchestration", "planning"],
            costTier: "expensive",
            typicalLatency: "2m",
            notes: "high quality synthesis",
          },
        },
        { id: "worker", model: "openai/gpt-4.1-mini", description: "Implements fixes" },
      ],
    });

    expect(prompt).toContain(
      "| main | anthropic/claude-opus-4 | Plans and routes | orchestration, planning | expensive | 2m | high quality synthesis |",
    );
    expect(prompt).toContain("| worker | openai/gpt-4.1-mini | Implements fixes | - | - | - | - |");
  });

  it("includes capability routing rankings when fleet entries are ranked", () => {
    const prompt = buildDelegationPrompt({
      depth: 1,
      maxDepth: 4,
      parentKey: "agent:main:subagent:parent",
      childSlotsAvailable: 3,
      maxChildrenPerAgent: 4,
      globalSlotsAvailable: 6,
      maxConcurrent: 8,
      task: "Draft release notes for the changelog.",
      fleet: [
        {
          id: "writer",
          routing: {
            score: 9,
            costTier: "cheap",
            typicalLatency: "60s",
            matchedCardTitle: "Documentation",
            matchedTerms: ["release", "changelog"],
          },
          model: "openai/gpt-4.1",
          description: "Documentation and editing",
        },
        {
          id: "engineer",
          routing: {
            score: 5,
            costTier: "medium",
            typicalLatency: "120s",
            matchedCardTitle: "Code",
            matchedTerms: ["changelog"],
          },
          model: "anthropic/claude-opus-4",
          description: "Implementation",
        },
      ],
    });

    expect(prompt).toContain("## Capability Routing");
    expect(prompt).toContain('- Based on task: "Draft release notes for the changelog."');
    expect(prompt).toContain(
      "| 1 | writer | 9 | cheap | 60s | Documentation | release, changelog |",
    );
    expect(prompt).toContain("| 2 | engineer | 5 | medium | 120s | Code | changelog |");
  });
});

describe("buildSubagentSystemPrompt", () => {
  it("does not append delegation block for depth-1 subagents", () => {
    const prompt = buildSubagentSystemPrompt({
      requesterSessionKey: "agent:main:main",
      childSessionKey: "agent:main:subagent:depth1",
      task: "Do one scoped task",
    });

    expect(prompt).toContain("# Subagent Context");
    expect(prompt).not.toContain("## Delegation Tier:");
  });

  it("adds reporting nudges when sessions_spawn enables reporting flags", () => {
    const prompt = buildSubagentSystemPrompt({
      requesterSessionKey: "agent:main:main",
      childSessionKey: "agent:main:subagent:depth1",
      task: "Do one scoped task",
      completionReport: true,
      progressReporting: true,
    });

    expect(prompt).toContain("## Reporting Tools");
    expect(prompt).toContain("report_completion");
    expect(prompt).toContain("report_progress");
  });

  it("omits reporting section when sessions_spawn flags are not enabled", () => {
    const prompt = buildSubagentSystemPrompt({
      requesterSessionKey: "agent:main:main",
      childSessionKey: "agent:main:subagent:depth1",
      task: "Do one scoped task",
    });

    expect(prompt).not.toContain("## Reporting Tools");
    expect(prompt).not.toContain("report_completion");
    expect(prompt).not.toContain("report_progress");
  });

  it("uses suggestAgents to build ranked fleet for delegation prompts", () => {
    const suggestSpy = vi.spyOn(capabilityRouting, "suggestAgents").mockReturnValue([
      {
        id: "writer",
        model: "openai/gpt-4.1-mini",
        description: "Documentation worker",
        routing: {
          score: 9,
          matchedCardTitle: "Capabilities",
          matchedTerms: ["release", "changelog"],
          costTier: "cheap",
          typicalLatency: "45s",
        },
      },
    ]);

    const prompt = buildSubagentSystemPrompt({
      requesterSessionKey: "agent:main:subagent:parent",
      childSessionKey: "agent:main:subagent:parent:sub:child",
      task: "Draft release notes and changelog update",
    });

    expect(suggestSpy).toHaveBeenCalledWith(
      { hint: "Draft release notes and changelog update" },
      expect.any(Object),
    );
    expect(prompt).toContain("## Capability Routing");
    expect(prompt).toContain(
      "| 1 | writer | 9 | cheap | 45s | Capabilities | release, changelog |",
    );

    suggestSpy.mockRestore();
  });
});
