import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  runSpawnVerificationChecks,
} from "./spawn-verification.js";

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "openclaw-verification-"));
  try {
    return await callback(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("runSpawnVerificationChecks", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("skips when no artifacts are configured", async () => {
    const result = await runSpawnVerificationChecks({ contract: {} });

    expect(result).toMatchObject({
      status: "skipped",
      checks: [],
    });
  });

  it("checks that artifact files exist", async () => {
    const result = await withTempDir(async (dir) => {
      const missing = path.join(dir, "missing.json");
      return runSpawnVerificationChecks({
        contract: {
          artifacts: [{ path: missing, json: true }],
        },
      });
    });

    expect(result.status).toBe("failed");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      type: "artifact",
      passed: false,
      reason: "artifact_not_found",
      target: expect.stringMatching("missing.json"),
    });
  });

  it("checks minimum byte size", async () => {
    const result = await withTempDir(async (dir) => {
      const target = path.join(dir, "tiny.json");
      await fs.writeFile(target, "{}", "utf-8");
      return runSpawnVerificationChecks({
        contract: {
          artifacts: [
            {
              path: target,
              minBytes: 10,
            },
          ],
        },
      });
    });

    expect(result.status).toBe("failed");
    expect(result.checks[0]).toMatchObject({
      type: "artifact",
      passed: false,
      reason: "artifact_too_small (2 < 10 bytes)",
    });
  });

  it("validates JSON parseability", async () => {
    const result = await withTempDir(async (dir) => {
      const target = path.join(dir, "bad.json");
      await fs.writeFile(target, "{\n", "utf-8");
      return runSpawnVerificationChecks({
        contract: {
          artifacts: [
            {
              path: target,
              json: true,
            },
          ],
        },
      });
    });

    expect(result.status).toBe("failed");
    expect(result.checks[0]).toMatchObject({
      type: "artifact",
      passed: false,
      reason: "artifact_json_parse_failed",
    });
  });

  it("validates array minimum items", async () => {
    const result = await withTempDir(async (dir) => {
      const target = path.join(dir, "items.json");
      await fs.writeFile(target, "[1]", "utf-8");
      return runSpawnVerificationChecks({
        contract: {
          artifacts: [
            {
              path: target,
              json: true,
              minItems: 2,
            },
          ],
        },
      });
    });

    expect(result.status).toBe("failed");
    expect(result.checks[0]).toMatchObject({
      type: "artifact",
      passed: false,
      reason: "artifact_json_too_few_items (1 < 2)",
    });
  });

  it("validates requiredKeys for every JSON item", async () => {
    const result = await withTempDir(async (dir) => {
      const target = path.join(dir, "items.json");
      await fs.writeFile(
        target,
        JSON.stringify([{ id: 1, status: "ok" }, { status: "missing-id" }]),
        "utf-8",
      );
      return runSpawnVerificationChecks({
        contract: {
          artifacts: [
            {
              path: target,
              json: true,
              requiredKeys: ["id"],
            },
          ],
        },
      });
    });

    expect(result.status).toBe("failed");
    expect(result.checks[0]).toMatchObject({
      type: "artifact",
      passed: false,
      reason: "artifact_json_item_missing_required_key_1.id",
    });
  });

  it("fails when checks exceed timeout", async () => {
    vi.useRealTimers();
    const result = await withTempDir(async (dir) => {
      const target = path.join(dir, "slow.json");
      await fs.writeFile(target, "{}", "utf-8");
      let readFileCalled = false;

      const checks = runSpawnVerificationChecks({
        contract: {
          artifacts: [
            {
              path: target,
              json: true,
              minItems: 2,
            },
          ],
        },
        timeoutMs: 10,
        hooks: {
          readFile: async () => {
            readFileCalled = true;
            return new Promise(() => {
              // Never resolves, forcing timeout.
            });
          },
        },
      });
      const result = await checks;

      expect(readFileCalled).toBe(true);
      return result;
    });

    expect(result.status).toBe("failed");
    expect(result.checks[0]).toMatchObject({
      type: "artifact",
      target: "<verification>",
      passed: false,
      reason: "verification_timeout",
    });
  });

  it("uses the default timeout value when none is configured", () => {
    expect(DEFAULT_VERIFICATION_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
