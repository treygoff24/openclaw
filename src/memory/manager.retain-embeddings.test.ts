import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";

vi.mock("chokidar", () => ({
  default: {
    watch: () => ({ on: () => {}, close: async () => {} }),
  },
  watch: () => ({ on: () => {}, close: async () => {} }),
}));

vi.mock("./sqlite-vec.js", () => ({
  loadSqliteVecExtension: async () => ({ ok: false, error: "sqlite-vec disabled in tests" }),
}));

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    requestedProvider: "openai",
    provider: {
      id: "mock",
      model: "mock-embed",
      embedQuery: async () => [0.1, 0.2, 0.3],
      embedBatch: async (texts: string[]) => texts.map(() => [1, 0, 0]),
    },
  }),
}));

describe("memory session stale cleanup retainEmbeddings", () => {
  let workspaceDir: string;
  let stateDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-mem-retain-"));
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-state-retain-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    process.env.OPENCLAW_STATE_DIR = stateDir;
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    delete process.env.OPENCLAW_STATE_DIR;
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  async function createManager(retainEmbeddings?: boolean): Promise<MemoryIndexManager> {
    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            experimental: { sessionMemory: true },
            sources: ["sessions"],
            provider: "openai",
            model: "mock-embed",
            store: { path: indexPath, vector: { enabled: false } },
            sync: {
              watch: false,
              onSessionStart: false,
              onSearch: false,
              sessions: {
                deltaBytes: 1,
                deltaMessages: 1,
                ...(retainEmbeddings === undefined ? {} : { retainEmbeddings }),
              },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const result = await getMemorySearchManager({ cfg, agentId: "main" });
    if (!result.manager) {
      throw new Error("manager missing");
    }
    return result.manager as unknown as MemoryIndexManager;
  }

  async function seedStaleSessionPath(pathValue: string): Promise<void> {
    const db = (
      manager as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db;
    db.prepare(`INSERT INTO files(path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`).run(
      pathValue,
      "sessions",
      "stale-hash",
      Date.now(),
      1,
    );
  }

  async function runSessionSyncPass(): Promise<void> {
    const internals = manager as unknown as {
      sessionsDirty: boolean;
      sessionsDirtyFiles: Set<string>;
    };
    internals.sessionsDirty = true;
    internals.sessionsDirtyFiles.add(
      path.join(stateDir, "agents", "main", "sessions", "ghost.jsonl"),
    );
    await manager?.sync({ reason: "session-delta" });
  }

  async function hasIndexedSessionPath(pathValue: string): Promise<boolean> {
    const db = (
      manager as unknown as {
        db: {
          prepare: (sql: string) => { get: (...args: unknown[]) => { path: string } | undefined };
        };
      }
    ).db;
    const row = db
      .prepare(`SELECT path FROM files WHERE path = ? AND source = ?`)
      .get(pathValue, "sessions");
    return Boolean(row);
  }

  it("deletes stale session paths when retainEmbeddings=false", async () => {
    manager = await createManager(false);
    await manager.sync({ reason: "bootstrap" });
    const stalePath = "sessions/orphan-default.jsonl";
    await seedStaleSessionPath(stalePath);

    await runSessionSyncPass();

    await expect(hasIndexedSessionPath(stalePath)).resolves.toBe(false);
  });

  it("retains stale session paths when retainEmbeddings=true", async () => {
    manager = await createManager(true);
    await manager.sync({ reason: "bootstrap" });
    const stalePath = "sessions/orphan-retained.jsonl";
    await seedStaleSessionPath(stalePath);

    await runSessionSyncPass();

    await expect(hasIndexedSessionPath(stalePath)).resolves.toBe(true);
  });

  it("retains stale session paths when retainEmbeddings is unset (default=true)", async () => {
    manager = await createManager();
    await manager.sync({ reason: "bootstrap" });
    const stalePath = "sessions/orphan-implicit-default.jsonl";
    await seedStaleSessionPath(stalePath);

    await runSessionSyncPass();

    await expect(hasIndexedSessionPath(stalePath)).resolves.toBe(true);
  });
});
