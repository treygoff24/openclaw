import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReportProgressTool } from "./tools/report-progress-tool.js";

type ProgressLine = {
  runId: string;
  phase: string;
  percentComplete?: number;
  level?: string;
  metrics?: Record<string, string | number>;
  updatedAt: string;
};

async function readProgressLines(filePath: string): Promise<ProgressLine[]> {
  const raw = await fs.readFile(filePath, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProgressLine);
}

async function waitForProgressLines(
  filePath: string,
  expectedLines: number,
): Promise<ProgressLine[]> {
  const deadline = Date.now() + 500;
  let lines: ProgressLine[] = [];
  while (Date.now() < deadline) {
    try {
      lines = await readProgressLines(filePath);
      if (lines.length >= expectedLines) {
        return lines;
      }
    } catch {
      // file may not exist until first append completes
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return lines;
}

function progressFilePath(stateDir: string, runId: string): string {
  return path.join(stateDir, "progress", `${runId}.jsonl`);
}

describe("report progress tool", () => {
  let stateDir = "";
  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-report-progress-tool-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("returns immediately when persistence is slow (non-blocking)", async () => {
    const tool = createReportProgressTool({
      runId: "run-non-blocking",
      stateDir,
    });

    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(fs, "appendFile").mockImplementation(() => new Promise(() => {}));

    const outcome = (await Promise.race([
      tool.execute("tool-call-1", {
        phase: "initializing",
      }),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 25)),
    ])) as { details?: { status: string } } | "timeout";

    if (outcome === "timeout") {
      expect.fail("report_progress call blocked on write path");
    }

    expect(outcome.details).toMatchObject({ status: "accepted" });
  });

  it("rate limits progress writes to 1 update per 30 seconds per run", async () => {
    const now = { value: Date.now() };
    vi.spyOn(Date, "now").mockImplementation(() => now.value);

    const tool = createReportProgressTool({
      runId: "run-rate-limit",
      stateDir,
    });

    const first = await tool.execute("tool-call-1", {
      phase: "start",
    });
    now.value += 10_000;
    const second = await tool.execute("tool-call-2", {
      phase: "mid",
    });
    now.value += 20_001;
    const third = await tool.execute("tool-call-3", {
      phase: "continue",
    });

    expect(first.details).toMatchObject({ status: "accepted", runId: "run-rate-limit" });
    expect(second.details).toMatchObject({ status: "rate_limited", runId: "run-rate-limit" });
    expect(third.details).toMatchObject({ status: "accepted", runId: "run-rate-limit" });

    const lines = await waitForProgressLines(progressFilePath(stateDir, "run-rate-limit"), 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ phase: "start" });
    expect(lines[1]).toMatchObject({ phase: "continue" });
  });

  it("appends one JSONL entry per persisted progress update", async () => {
    const now = { value: 1_700_000_000_000 };
    vi.spyOn(Date, "now").mockImplementation(() => now.value);

    const tool = createReportProgressTool({
      runId: "run-jsonl",
      stateDir,
    });

    const first = await tool.execute("tool-call-1", {
      phase: "collecting",
      level: "L0_operational",
      percentComplete: 12,
      metrics: {
        filesChecked: 4,
        status: "ok",
      },
    });

    now.value += 35_000;
    const second = await tool.execute("tool-call-2", {
      phase: "analyzing",
      level: "L1_plan_update",
      percentComplete: 75,
      metrics: {
        retries: 1,
      },
    });

    const lines = await waitForProgressLines(progressFilePath(stateDir, "run-jsonl"), 2);

    expect(first.details).toMatchObject({ status: "accepted" });
    expect(second.details).toMatchObject({ status: "accepted" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      runId: "run-jsonl",
      phase: "collecting",
      level: "L0_operational",
      percentComplete: 12,
    });
    expect(lines[1]).toMatchObject({
      runId: "run-jsonl",
      phase: "analyzing",
      level: "L1_plan_update",
      percentComplete: 75,
    });
    expect(lines[0].metrics).toMatchObject({ filesChecked: 4 });
    expect(lines[0].metrics).toHaveProperty("status", "ok");
    expect(lines[1].metrics).toMatchObject({ retries: 1 });
    expect(lines[0].updatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
