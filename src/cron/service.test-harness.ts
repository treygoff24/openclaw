import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

type CronTestLogger = {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const tempStoreDirs = new Set<string>();

async function removeStoreDir(dir: string) {
  await fs.rm(dir, {
    force: true,
    recursive: true,
    maxRetries: 20,
    retryDelay: 10,
  });
}

async function clearStoreDirs() {
  for (const dir of tempStoreDirs) {
    try {
      await removeStoreDir(dir);
    } finally {
      tempStoreDirs.delete(dir);
    }
  }
}

function clearLogger(logger: CronTestLogger) {
  logger.debug.mockClear();
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
}

export function createNoopLogger(): CronTestLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

export function createCronStoreHarness(opts: { prefix: string }) {
  const prefix = opts.prefix;

  return {
    makeStorePath: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
      const storePath = path.join(dir, "cron", "jobs.json");
      tempStoreDirs.add(dir);
      return {
        storePath,
        cleanup: async () => {
          await removeStoreDir(dir);
          tempStoreDirs.delete(dir);
        },
      };
    },
  };
}

export function installCronTestHooks(options?: { logger?: CronTestLogger }) {
  const logger = options?.logger;

  beforeEach(() => {
    if (logger) {
      clearLogger(logger);
    }
  });

  afterEach(async () => {
    if (logger) {
      clearLogger(logger);
    }
    await clearStoreDirs();
  });
}
