import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache, loadConfig } from "./io.js";

const BASE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

async function withTempConfig(run: (configPath: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-config-cache-"));
  const configPath = path.join(dir, "openclaw.json");
  try {
    await run(configPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function withEnv(
  updates: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(updates)) {
    previous.set(key, process.env[key]);
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function writeGatewayPort(configPath: string, port: number): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify({ gateway: { port } }, null, 2));
}

describe("loadConfig cache", () => {
  beforeEach(() => {
    clearConfigCache();
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME_MS);
  });

  afterEach(() => {
    clearConfigCache();
    vi.useRealTimers();
  });

  it("uses default cache across closely spaced loadConfig calls", async () => {
    await withTempConfig(async (configPath) => {
      await writeGatewayPort(configPath, 19001);

      await withEnv(
        {
          OPENCLAW_CONFIG_PATH: configPath,
          OPENCLAW_CONFIG_CACHE_MS: undefined,
          OPENCLAW_DISABLE_CONFIG_CACHE: undefined,
        },
        async () => {
          expect(loadConfig().gateway?.port).toBe(19001);

          await writeGatewayPort(configPath, 20002);
          vi.setSystemTime(BASE_TIME_MS + 500);

          expect(loadConfig().gateway?.port).toBe(19001);
        },
      );
    });
  });

  it("disables cache when OPENCLAW_DISABLE_CONFIG_CACHE is set", async () => {
    await withTempConfig(async (configPath) => {
      await writeGatewayPort(configPath, 19001);

      await withEnv(
        {
          OPENCLAW_CONFIG_PATH: configPath,
          OPENCLAW_CONFIG_CACHE_MS: undefined,
          OPENCLAW_DISABLE_CONFIG_CACHE: "1",
        },
        async () => {
          expect(loadConfig().gateway?.port).toBe(19001);

          await writeGatewayPort(configPath, 20002);
          vi.setSystemTime(BASE_TIME_MS + 100);

          expect(loadConfig().gateway?.port).toBe(20002);
        },
      );
    });
  });
});
