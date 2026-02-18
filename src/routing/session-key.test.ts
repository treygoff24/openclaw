import { afterEach, describe, expect, it, vi } from "vitest";
import * as sessionKeyUtils from "../sessions/session-key-utils.js";
import { classifySessionKeyShape, getParentSubagentKey, getSubagentDepth } from "./session-key.js";

const maybeSetRegistryAccessor = (
  sessionKeyUtils as typeof sessionKeyUtils & {
    setRegistryAccessor?: (
      fn: ((key: string) => { depth?: number } | undefined) | undefined,
    ) => void;
  }
).setRegistryAccessor;

afterEach(() => {
  maybeSetRegistryAccessor?.(undefined);
});

describe("classifySessionKeyShape", () => {
  it("classifies empty keys as missing", () => {
    expect(classifySessionKeyShape(undefined)).toBe("missing");
    expect(classifySessionKeyShape("   ")).toBe("missing");
  });

  it("classifies valid agent keys", () => {
    expect(classifySessionKeyShape("agent:main:main")).toBe("agent");
    expect(classifySessionKeyShape("agent:research:subagent:worker")).toBe("agent");
  });

  it("classifies malformed agent keys", () => {
    expect(classifySessionKeyShape("agent::broken")).toBe("malformed_agent");
    expect(classifySessionKeyShape("agent:main")).toBe("malformed_agent");
  });

  it("treats non-agent legacy or alias keys as non-malformed", () => {
    expect(classifySessionKeyShape("main")).toBe("legacy_or_alias");
    expect(classifySessionKeyShape("custom-main")).toBe("legacy_or_alias");
    expect(classifySessionKeyShape("subagent:worker")).toBe("legacy_or_alias");
  });
});

describe("session key backward compatibility", () => {
  it("classifies legacy :dm: session keys as valid agent keys", () => {
    // Legacy session keys use :dm: instead of :direct:
    // Both should be recognized as valid agent keys
    expect(classifySessionKeyShape("agent:main:telegram:dm:123456")).toBe("agent");
    expect(classifySessionKeyShape("agent:main:whatsapp:dm:+15551234567")).toBe("agent");
    expect(classifySessionKeyShape("agent:main:discord:dm:user123")).toBe("agent");
  });

  it("classifies new :direct: session keys as valid agent keys", () => {
    expect(classifySessionKeyShape("agent:main:telegram:direct:123456")).toBe("agent");
    expect(classifySessionKeyShape("agent:main:whatsapp:direct:+15551234567")).toBe("agent");
    expect(classifySessionKeyShape("agent:main:discord:direct:user123")).toBe("agent");
  });
});

describe("getSubagentDepth", () => {
  it("returns 0 for non-subagent keys", () => {
    expect(getSubagentDepth("agent:main:main")).toBe(0);
    expect(getSubagentDepth("agent:main:telegram:direct:123")).toBe(0);
  });

  it("returns 0 for null/undefined/empty", () => {
    expect(getSubagentDepth(null)).toBe(0);
    expect(getSubagentDepth(undefined)).toBe(0);
    expect(getSubagentDepth("")).toBe(0);
    expect(getSubagentDepth("   ")).toBe(0);
  });

  it("returns 1 for depth-1 subagent keys", () => {
    expect(getSubagentDepth("agent:main:subagent:abc-123")).toBe(1);
    expect(getSubagentDepth("agent:research:subagent:def-456")).toBe(1);
  });

  it("returns 2 for depth-2 subagent keys", () => {
    expect(getSubagentDepth("agent:main:subagent:abc:sub:def")).toBe(2);
  });

  it("returns 3 for depth-3 subagent keys", () => {
    expect(getSubagentDepth("agent:main:subagent:abc:sub:def:sub:ghi")).toBe(3);
  });

  it("stops counting at unexpected segments", () => {
    expect(getSubagentDepth("agent:main:subagent:abc:thread:xyz")).toBe(1);
  });

  it("returns 0 when subagent sequence is malformed", () => {
    expect(getSubagentDepth("agent:main:subagent")).toBe(0);
    expect(getSubagentDepth("agent:main:subagent:")).toBe(0);
    expect(getSubagentDepth("agent:main:subagent:abc:sub")).toBe(0);
    expect(getSubagentDepth("agent:main:subagent::sub:def")).toBe(0);
    expect(getSubagentDepth("agent:main:subagent:abc:sub:")).toBe(0);
  });
});

describe("getSubagentDepth registry metadata", () => {
  it("prefers registry depth metadata when available", () => {
    const accessor = vi.fn(() => ({ depth: 3 }));
    maybeSetRegistryAccessor?.(accessor);

    const result = getSubagentDepth("agent:main:subagent:a:sub:b");
    expect(result).toBe(3);
    expect(accessor).toHaveBeenCalledWith("agent:main:subagent:a:sub:b");
  });

  it("falls back to key parsing when registry has no entry", () => {
    const accessor = vi.fn(() => undefined);
    maybeSetRegistryAccessor?.(accessor);

    expect(getSubagentDepth("agent:main:subagent:a:sub:b")).toBe(2);
    expect(accessor).toHaveBeenCalledTimes(1);
  });

  it("ignores registry accessor for non-subagent keys", () => {
    const accessor = vi.fn(() => ({ depth: 9 }));
    maybeSetRegistryAccessor?.(accessor);

    expect(getSubagentDepth("agent:main:main")).toBe(0);
    expect(accessor).not.toHaveBeenCalled();
  });
});

describe("getParentSubagentKey", () => {
  it("returns null for non-subagent keys", () => {
    expect(getParentSubagentKey("agent:main:main")).toBeNull();
    expect(getParentSubagentKey(null)).toBeNull();
    expect(getParentSubagentKey("")).toBeNull();
  });

  it("returns main key for depth-1 subagent", () => {
    expect(getParentSubagentKey("agent:main:subagent:abc-123")).toBe("agent:main:main");
    expect(getParentSubagentKey("agent:research:subagent:def")).toBe("agent:research:main");
  });

  it("returns depth-1 key for depth-2 subagent", () => {
    expect(getParentSubagentKey("agent:main:subagent:abc:sub:def")).toBe("agent:main:subagent:abc");
  });

  it("returns depth-2 key for depth-3 subagent", () => {
    expect(getParentSubagentKey("agent:main:subagent:abc:sub:def:sub:ghi")).toBe(
      "agent:main:subagent:abc:sub:def",
    );
  });

  it("returns null for malformed sub sequences", () => {
    expect(getParentSubagentKey("agent:main:subagent:abc:sub")).toBeNull();
    expect(getParentSubagentKey("agent:main:subagent:abc:sub:")).toBeNull();
    expect(getParentSubagentKey("agent:main:subagent")).toBeNull();
  });
});
