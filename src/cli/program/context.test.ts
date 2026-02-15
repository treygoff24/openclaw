import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveCliChannelOptionsMock } = vi.hoisted(() => ({
  resolveCliChannelOptionsMock: vi.fn(() => ["telegram", "discord"]),
}));

vi.mock("../channel-options.js", () => ({
  resolveCliChannelOptions: resolveCliChannelOptionsMock,
}));

const { createProgramContext } = await import("./context.js");

describe("createProgramContext", () => {
  beforeEach(() => {
    resolveCliChannelOptionsMock.mockClear();
    resolveCliChannelOptionsMock.mockReturnValue(["telegram", "discord"]);
  });

  it("lazily resolves channel options and memoizes the result", () => {
    const ctx = createProgramContext();

    expect(resolveCliChannelOptionsMock).not.toHaveBeenCalled();

    expect(ctx.messageChannelOptions).toBe("telegram|discord");
    expect(resolveCliChannelOptionsMock).toHaveBeenCalledTimes(1);

    expect(ctx.agentChannelOptions).toBe("last|telegram|discord");
    expect(ctx.channelOptions).toEqual(["telegram", "discord"]);
    expect(resolveCliChannelOptionsMock).toHaveBeenCalledTimes(1);
  });
});
