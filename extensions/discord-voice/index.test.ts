import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const agentCommand = vi.fn();
  const getGateway = vi.fn();
  const getGatewayBotUserId = vi.fn();
  const subscribeGatewayVoiceStateUpdates = vi.fn();
  const subscribeGatewayVoiceServerUpdates = vi.fn();
  const pipelineInstances: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  const voiceManagerInstances: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  const agentBridgeHandlers: Array<(params: unknown) => Promise<unknown>> = [];

  return {
    agentCommand,
    getGateway,
    getGatewayBotUserId,
    subscribeGatewayVoiceStateUpdates,
    subscribeGatewayVoiceServerUpdates,
    pipelineInstances,
    voiceManagerInstances,
    agentBridgeHandlers,
  };
});

vi.mock("../../src/commands/agent.js", () => ({
  agentCommand: mocks.agentCommand,
}));

vi.mock("../../src/discord/monitor/gateway-registry.js", () => ({
  getGateway: mocks.getGateway,
  getGatewayBotUserId: mocks.getGatewayBotUserId,
  subscribeGatewayVoiceStateUpdates: mocks.subscribeGatewayVoiceStateUpdates,
  subscribeGatewayVoiceServerUpdates: mocks.subscribeGatewayVoiceServerUpdates,
}));

vi.mock("openclaw/plugin-sdk", () => ({
  agentCommand: mocks.agentCommand,
  getGateway: mocks.getGateway,
  getGatewayBotUserId: mocks.getGatewayBotUserId,
  subscribeGatewayVoiceStateUpdates: mocks.subscribeGatewayVoiceStateUpdates,
  subscribeGatewayVoiceServerUpdates: mocks.subscribeGatewayVoiceServerUpdates,
}));

vi.mock("./src/voice-manager.js", () => {
  class VoiceManager {
    on = vi.fn();
    getActiveCount = vi.fn(() => 1);
    getConnection = vi.fn(() => ({ receiver: { id: "receiver-1" } }));

    constructor() {
      mocks.voiceManagerInstances.push({
        on: this.on,
        getActiveCount: this.getActiveCount,
        getConnection: this.getConnection,
      });
    }
  }

  return { VoiceManager };
});

vi.mock("./src/pipeline.js", () => {
  class VoicePipeline {
    startChannel = vi.fn(async () => undefined);
    stopChannel = vi.fn(async () => undefined);
    destroy = vi.fn(async () => undefined);
    getActiveCount = vi.fn(() => 1);
    handleUserJoin = vi.fn();
    handleUserLeave = vi.fn();

    constructor() {
      mocks.pipelineInstances.push({
        startChannel: this.startChannel,
        stopChannel: this.stopChannel,
        destroy: this.destroy,
        getActiveCount: this.getActiveCount,
        handleUserJoin: this.handleUserJoin,
        handleUserLeave: this.handleUserLeave,
      });
    }
  }

  return { VoicePipeline };
});

vi.mock("./src/agent-bridge.js", () => {
  class AgentBridge {
    setMessageHandler(handler: (params: unknown) => Promise<unknown>) {
      mocks.agentBridgeHandlers.push(handler);
    }
  }

  return { AgentBridge };
});

vi.mock("./src/stt.js", () => ({
  WhisperSTT: class WhisperSTT {},
}));

vi.mock("./src/tts.js", () => ({
  TTSProvider: class TTSProvider {},
}));

vi.mock("./src/playback.js", () => ({
  PlaybackManager: class PlaybackManager {},
}));

const { default: discordVoicePlugin } = await import("./index.js");

function createApi(pluginConfig: Record<string, unknown> = {}) {
  const gatewayMethods = new Map<string, (options: unknown) => Promise<void>>();
  const api = {
    config: {
      channels: {
        discord: {
          accounts: {
            default: {},
          },
        },
      },
    },
    pluginConfig,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    runtime: {},
    registerTool: vi.fn(),
    registerGatewayMethod: vi.fn((name: string, handler: (options: unknown) => Promise<void>) => {
      gatewayMethods.set(name, handler);
    }),
    registerService: vi.fn(),
  };

  return {
    api,
    gatewayMethods,
  };
}

function voiceStateEvent(params: {
  guildId: string;
  userId: string;
  channelId: string | null;
  isBot?: boolean;
}) {
  return {
    guild_id: params.guildId,
    user_id: params.userId,
    channel_id: params.channelId,
    session_id: `session-${params.userId}`,
    deaf: false,
    mute: false,
    self_deaf: false,
    self_mute: false,
    self_video: false,
    suppress: false,
    member: {
      user: {
        id: params.userId,
        bot: params.isBot === true,
      },
    },
  };
}

describe("discord-voice index wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pipelineInstances.length = 0;
    mocks.voiceManagerInstances.length = 0;
    mocks.agentBridgeHandlers.length = 0;

    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    mocks.agentCommand.mockResolvedValue({ payloads: [{ text: "Voice reply" }] });
    mocks.getGateway.mockReturnValue({ send: vi.fn() });
    mocks.getGatewayBotUserId.mockReturnValue("bot-1");
    mocks.subscribeGatewayVoiceStateUpdates.mockImplementation(() => () => undefined);
    mocks.subscribeGatewayVoiceServerUpdates.mockImplementation(() => () => undefined);
  });

  it("routes bridged voice messages through agentCommand and returns text", async () => {
    const { api } = createApi();
    discordVoicePlugin.register(api as never);

    const handler = mocks.agentBridgeHandlers[0];
    expect(handler).toBeTypeOf("function");

    const response = await handler({
      text: "[Voice] trey: hello",
      sessionKey: "discord:voice:g1:c1",
      userId: "u1",
      userName: "trey",
      channelId: "c1",
      guildId: "g1",
    });

    expect(mocks.agentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "[Voice] trey: hello",
        sessionKey: "discord:voice:g1:c1",
        channel: "discord",
        deliver: false,
        json: true,
      }),
      expect.objectContaining({ log: expect.any(Function), error: expect.any(Function) }),
    );
    expect(response).toEqual({ text: "Voice reply" });
  });

  it("forwards voiceSystemPrompt when configured", async () => {
    const { api } = createApi({ voiceSystemPrompt: "Keep responses concise." });
    discordVoicePlugin.register(api as never);

    const handler = mocks.agentBridgeHandlers[0];
    await handler({
      text: "[Voice] trey: hello",
      sessionKey: "discord:voice:g1:c1",
      userId: "u1",
      userName: "trey",
      channelId: "c1",
      guildId: "g1",
    });

    expect(mocks.agentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        extraSystemPrompt: "Keep responses concise.",
      }),
      expect.any(Object),
    );
  });

  it("gateway join resolves adapter creator without requiring caller adapter", async () => {
    const { api, gatewayMethods } = createApi();
    discordVoicePlugin.register(api as never);

    const joinHandler = gatewayMethods.get("discord-voice.join");
    expect(joinHandler).toBeTypeOf("function");

    const respond = vi.fn();
    await joinHandler?.({
      params: { guildId: "g1", channelId: "c1", accountId: "default" },
      respond,
    });

    const pipeline = mocks.pipelineInstances[0];
    expect(pipeline?.startChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: "g1",
        channelId: "c1",
        adapterCreator: expect.any(Function),
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        joined: true,
        guildId: "g1",
        channelId: "c1",
        accountId: "default",
      }),
    );
  });

  it("tracks voice joins/leaves and auto-disconnects when the last human leaves", async () => {
    const { api, gatewayMethods } = createApi();
    discordVoicePlugin.register(api as never);

    const joinHandler = gatewayMethods.get("discord-voice.join");
    await joinHandler?.({
      params: { guildId: "g1", channelId: "c1", accountId: "default" },
      respond: vi.fn(),
    });

    const stateSubscriber = mocks.subscribeGatewayVoiceStateUpdates.mock.calls.find(
      (call) => call[0] === "default",
    )?.[1] as ((event: ReturnType<typeof voiceStateEvent>) => void) | undefined;

    expect(stateSubscriber).toBeTypeOf("function");

    stateSubscriber?.(voiceStateEvent({ guildId: "g1", userId: "u1", channelId: "c1" }));

    const pipeline = mocks.pipelineInstances[0];
    const voiceManager = mocks.voiceManagerInstances[0];
    expect(voiceManager?.getConnection).toHaveBeenCalledWith("g1");
    expect(pipeline?.handleUserJoin).toHaveBeenCalledWith("g1", "u1", expect.any(Object));

    stateSubscriber?.(voiceStateEvent({ guildId: "g1", userId: "u1", channelId: null }));
    expect(pipeline?.handleUserLeave).toHaveBeenCalledWith("g1", "u1");

    await Promise.resolve();
    expect(pipeline?.stopChannel).toHaveBeenCalledWith("g1");
  });

  it("initializes the per-account voice-state listener once under concurrent joins", async () => {
    const { api, gatewayMethods } = createApi();
    discordVoicePlugin.register(api as never);

    const joinHandler = gatewayMethods.get("discord-voice.join");
    expect(joinHandler).toBeTypeOf("function");

    await Promise.all([
      joinHandler?.({
        params: { guildId: "g1", channelId: "c1", accountId: "default" },
        respond: vi.fn(),
      }),
      joinHandler?.({
        params: { guildId: "g2", channelId: "c2", accountId: "default" },
        respond: vi.fn(),
      }),
    ]);

    const accountScopedSubs = mocks.subscribeGatewayVoiceStateUpdates.mock.calls.filter(
      (call) => call[0] === "default",
    );
    expect(accountScopedSubs.length).toBe(1);
  });
});
