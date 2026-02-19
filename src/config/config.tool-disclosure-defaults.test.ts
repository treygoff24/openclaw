import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { withTempHome } from "./test-helpers.js";
import { validateConfigObject } from "./validation.js";

describe("tool disclosure defaults", () => {
  it("injects defaults on load", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".openclaw");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(path.join(configDir, "openclaw.json"), JSON.stringify({}, null, 2));

      const cfg = loadConfig();
      expect(cfg.agents?.defaults?.toolDisclosure?.mode).toBe("off");
      expect(cfg.agents?.defaults?.toolDisclosure?.alwaysAllow).toEqual([
        "session_status",
        "read",
        "ls",
        "grep",
      ]);
      expect(cfg.agents?.defaults?.toolDisclosure?.maxActiveTools).toBe(12);
      expect(cfg.agents?.defaults?.toolDisclosure?.stickyMaxTools).toBe(12);
    });
  });

  it("accepts per-agent toolDisclosure overrides", () => {
    const validated = validateConfigObject({
      agents: {
        defaults: {
          toolDisclosure: { mode: "off" },
        },
        list: [
          {
            id: "main",
            toolDisclosure: {
              mode: "auto_intent",
              maxActiveTools: 8,
            },
          },
        ],
      },
    });

    expect(validated.ok).toBe(true);
  });
});
