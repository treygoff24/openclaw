import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  parseAgentCapabilities,
  parseCapabilityCards,
  rankAgentsForTask,
  suggestAgents,
  type DelegationFleetEntry,
} from "./capability-routing.js";

describe("capability-routing", () => {
  it("parses capabilities metadata with normalized tags and cost tier", () => {
    const capabilities = parseAgentCapabilities({
      tags: [" Research ", "synthesis", "re", "SYNTHESIS"],
      costTier: "CHEAP",
      typicalLatency: " 90S ",
      notes: " Search-only workflow ",
    });

    expect(capabilities).toEqual({
      tags: ["research", "synthesis"],
      costTier: "cheap",
      typicalLatency: "90s",
      notes: "search-only workflow",
    });
  });

  it("parses valid capability cards with normalization and dedupe", () => {
    const cards = parseCapabilityCards([
      {
        id: "DOCS-1",
        title: "  Documentation  ",
        description: "Release Notes and changelog updates",
        keywords: ["Release", "Changelog", "Re", "release"],
      },
      {
        title: "Debugging",
        description: null,
        keywords: [123, "Test", "bugfix"],
      },
      {
        id: 12,
        description: "No title",
      },
      "not-a-card",
    ]);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual({
      id: "docs-1",
      title: "documentation",
      description: "release notes and changelog updates",
      keywords: ["release", "changelog"],
    });
    expect(cards[1]).toMatchObject({
      title: "debugging",
      keywords: ["test", "bugfix"],
    });
    expect(cards[1].description).toBeUndefined();
  });

  it("ranks a task against capability tags before card/description fallback", () => {
    const fleet: DelegationFleetEntry[] = [
      {
        id: "writer",
        description: "General documentation agent",
        capabilities: {
          tags: ["release notes", "changelog", "editing"],
          costTier: "cheap",
          typicalLatency: "60s",
          notes: "documentation specialist",
        },
      },
      {
        id: "engineer",
        description: "Code execution and runtime debugging",
        capabilities: {
          tags: ["bugfix", "testing"],
          costTier: "medium",
        },
        capabilityCards: [
          {
            title: "Debug",
            description: "Fix failing tests and hard issues",
            keywords: ["bug", "regression"],
          },
        ],
      },
    ];

    const ranked = rankAgentsForTask({
      task: "Prepare release notes and changelog summary",
      fleet,
    });

    expect(ranked[0].id).toBe("writer");
    expect(ranked[1].id).toBe("engineer");
    expect(ranked[0].routing?.score).toBeGreaterThan(ranked[1].routing?.score ?? 0);
    expect(ranked[0].routing?.matchedCardTitle).toBe("capabilities");
    expect(ranked[0].routing?.matchedTags).toEqual(["changelog", "release notes"]);
    expect(ranked[0].routing?.costTier).toBe("cheap");
  });

  it("falls back to agent description when capabilities are missing", () => {
    const fleet: DelegationFleetEntry[] = [
      {
        id: "no-match",
        description: "This agent handles deployment checks and release notes review",
      },
      {
        id: "docs-card",
        description: "Utility support",
      },
    ];

    const ranked = rankAgentsForTask({
      task: "Need release notes review",
      fleet,
    });

    expect(ranked).toHaveLength(2);
    expect(ranked[0].id).toBe("no-match");
    expect(ranked[0].routing?.matchedCardTitle).toBe("agent no-match description");
  });

  it("uses cost tier as a deterministic tie-breaker before agent id", () => {
    const fleet: DelegationFleetEntry[] = [
      {
        id: "zulu-expensive",
        description: "release notes summary",
        capabilities: { costTier: "expensive" },
      },
      {
        id: "alpha-free",
        description: "release notes summary",
        capabilities: { costTier: "free" },
      },
      {
        id: "omega-medium",
        description: "release notes summary",
        capabilities: { costTier: "medium" },
      },
    ];

    const ranked = rankAgentsForTask({ task: "release notes", fleet });

    expect(ranked.map((entry) => entry.id)).toEqual([
      "alpha-free",
      "omega-medium",
      "zulu-expensive",
    ]);
    expect(new Set(ranked.map((entry) => entry.routing?.score)).size).toBe(1);
  });

  it("suggests agents from config using a routing hint", () => {
    const config: OpenClawConfig = {
      agents: {
        list: [
          {
            id: "writer",
            model: "openai/gpt-4.1-mini",
            description: "Documentation specialist",
            capabilities: {
              tags: ["release notes", "changelog"],
              costTier: "cheap",
              typicalLatency: "45s",
            },
          },
          {
            id: "engineer",
            model: "anthropic/claude-opus-4",
            description: "Implementation specialist",
            capabilities: { tags: ["bugfix"], costTier: "medium" },
          },
        ],
      },
    };

    const ranked = suggestAgents("Draft release notes and changelog summary", config);

    expect(ranked.map((entry) => entry.id)).toEqual(["writer", "engineer"]);
    expect(ranked[0].routing?.matchedTags).toEqual(["changelog", "release notes"]);
    expect(ranked[0].model).toBe("openai/gpt-4.1-mini");
  });

  it("supports filtering suggested agents by id allowlist", () => {
    const config: OpenClawConfig = {
      agents: {
        list: [
          { id: "writer", description: "release notes writer" },
          { id: "engineer", description: "release notes engineer" },
          { id: "ops", description: "release notes ops" },
        ],
      },
    };

    const ranked = suggestAgents(
      {
        hint: "Need release notes support",
        filter: ["engineer", "ops"],
      },
      config,
    );

    expect(ranked.map((entry) => entry.id)).toEqual(["engineer", "ops"]);
  });

  it("supports maxMatches limit for top suggestions", () => {
    const config: OpenClawConfig = {
      agents: {
        list: [
          { id: "writer", description: "release notes writer" },
          { id: "engineer", description: "release notes engineer" },
          { id: "ops", description: "release notes ops" },
        ],
      },
    };

    const ranked = suggestAgents(
      {
        hint: "Need release notes support",
        maxMatches: 1,
      },
      config,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.id).toBe("engineer");
  });
});
