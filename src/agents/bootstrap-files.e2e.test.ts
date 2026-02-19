import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearInternalHooks,
  registerInternalHook,
  type AgentBootstrapHookContext,
} from "../hooks/internal-hooks.js";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import { resolveBootstrapContextForRun, resolveBootstrapFilesForRun } from "./bootstrap-files.js";
import type { WorkspaceBootstrapFile } from "./workspace.js";

function registerExtraBootstrapFileHook() {
  registerInternalHook("agent:bootstrap", (event) => {
    const context = event.context as AgentBootstrapHookContext;
    context.bootstrapFiles = [
      ...context.bootstrapFiles,
      {
        name: "EXTRA.md",
        path: path.join(context.workspaceDir, "EXTRA.md"),
        content: "extra",
        missing: false,
      } as unknown as WorkspaceBootstrapFile,
    ];
  });
}

describe("resolveBootstrapFilesForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("applies bootstrap hook overrides", async () => {
    registerExtraBootstrapFileHook();

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const files = await resolveBootstrapFilesForRun({ workspaceDir });

    expect(files.some((file) => file.path === path.join(workspaceDir, "EXTRA.md"))).toBe(true);
  });

  it("filters bootstrap files to AGENTS.md and TOOLS.md for subagent sessions", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-subagent-filter-");
    await writeWorkspaceFile({ dir: workspaceDir, name: "AGENTS.md", content: "agents" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "TOOLS.md", content: "tools" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "SOUL.md", content: "persona" });

    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      sessionKey: "agent:main:subagent:child",
    });

    expect(files.map((file) => file.name).toSorted()).toEqual(["AGENTS.md", "TOOLS.md"]);
  });

  it("applies subagent allowlist when only sessionId is provided", async () => {
    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-subagent-session-id-");
    await writeWorkspaceFile({ dir: workspaceDir, name: "AGENTS.md", content: "agents" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "TOOLS.md", content: "tools" });
    await writeWorkspaceFile({ dir: workspaceDir, name: "SOUL.md", content: "persona" });

    const files = await resolveBootstrapFilesForRun({
      workspaceDir,
      sessionId: "agent:main:subagent:child",
    });

    expect(files.map((file) => file.name).toSorted()).toEqual(["AGENTS.md", "TOOLS.md"]);
  });
});

describe("resolveBootstrapContextForRun", () => {
  beforeEach(() => clearInternalHooks());
  afterEach(() => clearInternalHooks());

  it("returns context files for hook-adjusted bootstrap files", async () => {
    registerExtraBootstrapFileHook();

    const workspaceDir = await makeTempWorkspace("openclaw-bootstrap-");
    const result = await resolveBootstrapContextForRun({ workspaceDir });
    const extra = result.contextFiles.find(
      (file) => file.path === path.join(workspaceDir, "EXTRA.md"),
    );

    expect(extra?.content).toBe("extra");
  });
});
