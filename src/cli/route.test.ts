import { beforeEach, describe, expect, it, vi } from "vitest";

const { emitCliBannerMock } = vi.hoisted(() => ({ emitCliBannerMock: vi.fn() }));
const { ensureConfigReadyMock } = vi.hoisted(() => ({ ensureConfigReadyMock: vi.fn() }));
const { ensurePluginRegistryLoadedMock } = vi.hoisted(() => ({
  ensurePluginRegistryLoadedMock: vi.fn(),
}));
const { findRoutedCommandMock } = vi.hoisted(() => ({ findRoutedCommandMock: vi.fn() }));

vi.mock("./banner.js", () => ({ emitCliBanner: emitCliBannerMock }));
vi.mock("./program/config-guard.js", () => ({ ensureConfigReady: ensureConfigReadyMock }));
vi.mock("./plugin-registry.js", () => ({
  ensurePluginRegistryLoaded: ensurePluginRegistryLoadedMock,
}));
vi.mock("./program/routes.js", () => ({ findRoutedCommand: findRoutedCommandMock }));

const { tryRouteCli } = await import("./route.js");

describe("tryRouteCli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENCLAW_DISABLE_ROUTE_FIRST;
  });

  it("skips config guard for non-mutating routed commands", async () => {
    const run = vi.fn(async () => true);
    findRoutedCommandMock.mockReturnValueOnce({ loadPlugins: true, run });

    const routed = await tryRouteCli(["node", "openclaw", "status"]);

    expect(routed).toBe(true);
    expect(emitCliBannerMock).toHaveBeenCalledTimes(1);
    expect(ensureConfigReadyMock).not.toHaveBeenCalled();
    expect(ensurePluginRegistryLoadedMock).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(["node", "openclaw", "status"]);
  });

  it("runs config guard for mutating routed commands", async () => {
    const run = vi.fn(async () => true);
    findRoutedCommandMock.mockReturnValueOnce({ loadPlugins: false, run });

    const routed = await tryRouteCli(["node", "openclaw", "config", "unset", "foo.bar"]);

    expect(routed).toBe(true);
    expect(ensureConfigReadyMock).toHaveBeenCalledTimes(1);
    expect(ensurePluginRegistryLoadedMock).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(["node", "openclaw", "config", "unset", "foo.bar"]);
  });
});
