import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import type { GatewayRequestHandlerOptions, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import pluginManifest from "./openclaw.plugin.json" with { type: "json" };
import { AgentBridge } from "./src/agent-bridge.js";
import {
  DiscordVoiceConfigSchema,
  parseDiscordVoiceConfig,
  resolveElevenLabsApiKey,
  resolveOpenAIApiKey,
} from "./src/config.js";
import { VoicePipeline } from "./src/pipeline.js";
import { PlaybackManager } from "./src/playback.js";
import { WhisperSTT } from "./src/stt.js";
import { TTSProvider } from "./src/tts.js";
import { VoiceManager } from "./src/voice-manager.js";

const TOOL_ACTIONS = ["join", "leave", "leave_all", "status"] as const;

type DiscordVoiceRuntime = Pick<
  typeof import("openclaw/plugin-sdk"),
  | "agentCommand"
  | "getGateway"
  | "getGatewayBotUserId"
  | "subscribeGatewayVoiceStateUpdates"
  | "subscribeGatewayVoiceServerUpdates"
>;

type GatewayVoiceStateEvent = Parameters<
  DiscordVoiceRuntime["subscribeGatewayVoiceStateUpdates"]
>[1] extends (event: infer T) => void
  ? T
  : never;

type AgentDispatchResult = {
  payloads?: Array<{ text?: string | null } | null>;
};

type ActiveVoiceChannel = {
  channelId: string;
  accountId: string;
  botUserId: string;
};

type UserVoiceState = {
  channelId: string | null;
  isBot: boolean;
};

let discordVoiceRuntimePromise: Promise<DiscordVoiceRuntime> | null = null;

async function loadDiscordVoiceRuntime(): Promise<DiscordVoiceRuntime> {
  if (!discordVoiceRuntimePromise) {
    discordVoiceRuntimePromise = import("openclaw/plugin-sdk").then((mod) => ({
      agentCommand: mod.agentCommand,
      getGateway: mod.getGateway,
      getGatewayBotUserId: mod.getGatewayBotUserId,
      subscribeGatewayVoiceStateUpdates: mod.subscribeGatewayVoiceStateUpdates,
      subscribeGatewayVoiceServerUpdates: mod.subscribeGatewayVoiceServerUpdates,
    }));
  }
  return await discordVoiceRuntimePromise;
}

function jsonResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: {
    required: true;
    trim?: boolean;
    label?: string;
    allowEmpty?: boolean;
  },
): string;
function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: {
    required?: false;
    trim?: boolean;
    label?: string;
    allowEmpty?: boolean;
  },
): string | undefined;
function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: {
    required?: boolean;
    trim?: boolean;
    label?: string;
    allowEmpty?: boolean;
  } = {},
): string | undefined {
  const { required = false, trim = true, label = key, allowEmpty = false } = options;
  const raw = params[key];
  if (typeof raw !== "string") {
    if (required) {
      throw new Error(`${label} required`);
    }
    return undefined;
  }
  const value = trim ? raw.trim() : raw;
  if (!value && !allowEmpty) {
    if (required) {
      throw new Error(`${label} required`);
    }
    return undefined;
  }
  return value;
}

function resolveDefaultDiscordAccountIdLocal(config: OpenClawPluginApi["config"]): string {
  const accounts = config?.channels?.discord?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return "default";
  }
  const ids = Object.keys(accounts)
    .filter(Boolean)
    .toSorted((a, b) => a.localeCompare(b));
  if (ids.includes("default")) {
    return "default";
  }
  return ids[0] ?? "default";
}

function stringEnum<const T extends readonly string[]>(
  values: T,
  options?: { description?: string },
) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...(options ?? {}),
  });
}

const DiscordVoiceToolSchema = Type.Object(
  {
    action: stringEnum(TOOL_ACTIONS, {
      description: "Action to perform: join, leave, leave_all, status",
    }),
    channelId: Type.Optional(Type.String({ description: "Voice channel ID to join" })),
    guildId: Type.Optional(Type.String({ description: "Guild ID" })),
    accountId: Type.Optional(Type.String({ description: "Discord account ID" })),
  },
  { additionalProperties: false },
);

function toParamsRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function extractAgentReplyText(result: AgentDispatchResult | null | undefined): string {
  const payloads = result?.payloads ?? [];
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return "";
  }

  return payloads
    .map((payload) => (typeof payload?.text === "string" ? payload.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function resolveDiscordAccountId(
  config: OpenClawPluginApi["config"],
  input: Record<string, unknown>,
): string {
  const explicit = readStringParam(input, "accountId", { required: false })?.trim();
  return explicit || resolveDefaultDiscordAccountIdLocal(config);
}

function resolveHumanCountInTrackedChannel(params: {
  statesByUser: Map<string, UserVoiceState>;
  tracked: ActiveVoiceChannel;
}): number {
  let humans = 0;
  for (const [userId, state] of params.statesByUser.entries()) {
    if (userId === params.tracked.botUserId) {
      continue;
    }
    if (state.channelId === params.tracked.channelId && !state.isBot) {
      humans += 1;
    }
  }
  return humans;
}

const plugin = {
  id: "discord-voice",
  name: "Discord Voice",
  description: "Live voice conversations in Discord voice channels",
  configSchema: {
    parse: (v: unknown) => parseDiscordVoiceConfig(v),
    jsonSchema: pluginManifest.configSchema as Record<string, unknown>,
  },
  register(api: OpenClawPluginApi) {
    const config = parseDiscordVoiceConfig(api.pluginConfig);
    if (!config.enabled) {
      api.logger.info("[discord-voice] Plugin disabled");
      return;
    }

    const openaiKey = resolveOpenAIApiKey(config);
    if (!openaiKey) {
      api.logger.error("[discord-voice] Missing OPENAI_API_KEY (required for STT)");
      return;
    }

    const elevenLabsKey = resolveElevenLabsApiKey(config);

    const voiceManager = new VoiceManager(
      {
        maxConcurrentChannels: config.maxConcurrentChannels,
        allowedGuilds: config.allowedGuilds,
        allowedChannels: config.allowedChannels,
      },
      api.logger,
    );

    const stt = new WhisperSTT(
      {
        apiKey: openaiKey,
        model: config.stt.model,
        language: config.stt.language,
      },
      api.logger,
    );

    const tts = new TTSProvider(
      {
        provider: config.tts.provider,
        elevenlabsApiKey: elevenLabsKey,
        voiceId: config.tts.voiceId,
        modelId: config.tts.modelId,
        openaiApiKey: openaiKey,
        openaiVoice: config.tts.voiceId,
        openaiModel: config.tts.modelId,
      },
      api.logger,
    );

    const playback = new PlaybackManager(api.logger);
    const agentBridge = new AgentBridge({ responseTimeoutMs: 30_000 }, api.logger);

    const pipeline = new VoicePipeline({
      voiceManager,
      stt,
      agentBridge,
      tts,
      playback,
      config,
      logger: api.logger,
    });

    const activeChannels = new Map<string, ActiveVoiceChannel>();
    const guildVoiceStates = new Map<string, Map<string, UserVoiceState>>();
    const accountVoiceStateUnsubs = new Map<string, () => void>();
    const pendingVoiceStateListenerInits = new Map<string, Promise<void>>();
    const voiceSystemPrompt = config.voiceSystemPrompt.trim() || undefined;

    const getChannelStateMap = (guildId: string): Map<string, UserVoiceState> => {
      const existing = guildVoiceStates.get(guildId);
      if (existing) {
        return existing;
      }
      const next = new Map<string, UserVoiceState>();
      guildVoiceStates.set(guildId, next);
      return next;
    };

    const handleVoiceStateUpdate = (accountId: string, event: GatewayVoiceStateEvent) => {
      const guildId = event.guild_id?.trim();
      const userId = event.user_id?.trim();
      if (!guildId || !userId) {
        return;
      }

      const statesByUser = getChannelStateMap(guildId);
      const previous = statesByUser.get(userId);
      const nextChannelId = event.channel_id ?? null;
      const isBotFromEvent = event.member?.user?.bot === true;

      if (nextChannelId) {
        statesByUser.set(userId, {
          channelId: nextChannelId,
          isBot: isBotFromEvent || previous?.isBot === true,
        });
      } else {
        statesByUser.delete(userId);
        if (statesByUser.size === 0) {
          guildVoiceStates.delete(guildId);
        }
      }

      const tracked = activeChannels.get(guildId);
      if (!tracked || tracked.accountId !== accountId) {
        return;
      }

      if (userId === tracked.botUserId) {
        if (!nextChannelId) {
          activeChannels.delete(guildId);
        } else {
          tracked.channelId = nextChannelId;
        }
        return;
      }

      const previousChannelId = previous?.channelId ?? null;
      const joinedBotChannel =
        nextChannelId === tracked.channelId && previousChannelId !== tracked.channelId;
      const leftBotChannel =
        previousChannelId === tracked.channelId && nextChannelId !== tracked.channelId;

      if (joinedBotChannel) {
        api.logger.info(
          `[discord-voice] User ${userId} joined tracked voice channel ${tracked.channelId} in guild ${guildId}`,
        );
        const receiver = voiceManager.getConnection(guildId)?.receiver;
        if (receiver) {
          pipeline.handleUserJoin(guildId, userId, receiver);
        }
      }

      if (leftBotChannel) {
        api.logger.info(
          `[discord-voice] User ${userId} left tracked voice channel ${tracked.channelId} in guild ${guildId}`,
        );
        pipeline.handleUserLeave(guildId, userId);
      }

      if (!config.autoDisconnectOnEmpty) {
        return;
      }

      const humansRemaining = resolveHumanCountInTrackedChannel({ statesByUser, tracked });
      if (humansRemaining > 0) {
        return;
      }

      activeChannels.delete(guildId);
      void pipeline
        .stopChannel(guildId)
        .then(() => {
          api.logger.info(
            `[discord-voice] Auto-disconnected from guild ${guildId}: no humans left in channel ${tracked.channelId}`,
          );
        })
        .catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          api.logger.warn(`[discord-voice] Auto-disconnect failed for guild ${guildId}: ${reason}`);
        });
    };

    const ensureVoiceStateListenerForAccount = async (accountId: string): Promise<void> => {
      if (accountVoiceStateUnsubs.has(accountId)) {
        return;
      }
      const pending = pendingVoiceStateListenerInits.get(accountId);
      if (pending) {
        await pending;
        return;
      }

      const init = (async () => {
        const runtime = await loadDiscordVoiceRuntime();
        const unsubscribe = runtime.subscribeGatewayVoiceStateUpdates(accountId, (event) => {
          handleVoiceStateUpdate(accountId, event);
        });
        accountVoiceStateUnsubs.set(accountId, unsubscribe);
      })();
      pendingVoiceStateListenerInits.set(accountId, init);
      try {
        await init;
      } finally {
        pendingVoiceStateListenerInits.delete(accountId);
      }
    };

    const clearVoiceStateListeners = () => {
      for (const unsubscribe of accountVoiceStateUnsubs.values()) {
        unsubscribe();
      }
      accountVoiceStateUnsubs.clear();
    };

    const createAdapterCreator = async (params: {
      guildId: string;
      accountId: string;
    }): Promise<{ adapterCreator: DiscordGatewayAdapterCreator; botUserId: string }> => {
      const runtime = await loadDiscordVoiceRuntime();
      const gateway = runtime.getGateway(params.accountId);
      if (!gateway) {
        throw new Error(
          `Discord gateway for account "${params.accountId}" is unavailable. Is Discord monitor running?`,
        );
      }

      const botUserId = runtime.getGatewayBotUserId(params.accountId);
      if (!botUserId) {
        throw new Error(
          `Discord bot user id for account "${params.accountId}" is unavailable. Wait for gateway ready and retry.`,
        );
      }

      const adapterCreator: DiscordGatewayAdapterCreator = (methods) => {
        const unsubscribeVoiceState = runtime.subscribeGatewayVoiceStateUpdates(
          params.accountId,
          (event) => {
            if (event.guild_id !== params.guildId) {
              return;
            }
            if (event.user_id !== botUserId) {
              return;
            }
            methods.onVoiceStateUpdate(event);
          },
        );

        const unsubscribeVoiceServer = runtime.subscribeGatewayVoiceServerUpdates(
          params.accountId,
          (event) => {
            if (event.guild_id !== params.guildId) {
              return;
            }
            methods.onVoiceServerUpdate(event);
          },
        );

        return {
          sendPayload(payload: unknown): boolean {
            try {
              gateway.send(payload as Parameters<typeof gateway.send>[0], true);
              return true;
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              api.logger.warn(
                `[discord-voice] Failed to send Discord voice payload for guild ${params.guildId}: ${reason}`,
              );
              return false;
            }
          },
          destroy(): void {
            unsubscribeVoiceState();
            unsubscribeVoiceServer();
          },
        };
      };

      return { adapterCreator, botUserId };
    };

    const startGuildVoicePipeline = async (input: Record<string, unknown>) => {
      const channelId = readStringParam(input, "channelId", { required: true });
      const guildId = readStringParam(input, "guildId", { required: true });
      const accountId = resolveDiscordAccountId(api.config, input);

      await ensureVoiceStateListenerForAccount(accountId);
      const { adapterCreator, botUserId } = await createAdapterCreator({ guildId, accountId });

      await pipeline.startChannel({
        channelId,
        guildId,
        adapterCreator,
      });

      activeChannels.set(guildId, {
        channelId,
        accountId,
        botUserId,
      });

      return { channelId, guildId, accountId };
    };

    const stopGuildVoicePipeline = async (guildId: string) => {
      activeChannels.delete(guildId);
      await pipeline.stopChannel(guildId);
    };

    agentBridge.setMessageHandler(async (params) => {
      try {
        const runtime = await loadDiscordVoiceRuntime();
        const result = (await runtime.agentCommand(
          {
            message: params.text,
            sessionKey: params.sessionKey,
            channel: "discord",
            deliver: false,
            json: true,
            lane: `voice:${params.guildId}:${params.channelId}`,
            extraSystemPrompt: voiceSystemPrompt,
          },
          {
            log: () => {},
            error: (...args: unknown[]) => {
              api.logger.error(args.map((value) => String(value)).join(" "));
            },
            exit: () => {
              throw new Error("exit not supported for discord voice agent bridge");
            },
          },
        )) as AgentDispatchResult;

        const text = extractAgentReplyText(result);
        if (!text) {
          return null;
        }

        return { text };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        api.logger.warn(`[discord-voice] Agent dispatch failed: ${reason}`);
        return null;
      }
    });

    api.registerTool({
      name: "discord_voice",
      label: "Discord Voice",
      description:
        "Join or leave Discord voice channels for live voice conversation. " +
        "Use action=join with channelId and guildId to join, action=leave with guildId to leave, " +
        "action=leave_all to leave all active channels, and action=status for current state.",
      parameters: DiscordVoiceToolSchema,
      async execute(_id, params) {
        const input = toParamsRecord(params);

        try {
          const action = readStringParam(input, "action", { required: true });

          if (action === "join") {
            const joined = await startGuildVoicePipeline(input);
            return jsonResult({ success: true, action: "joined", ...joined });
          }

          if (action === "leave") {
            const guildId = readStringParam(input, "guildId", { required: true });
            await stopGuildVoicePipeline(guildId);
            return jsonResult({ success: true, action: "left", guildId });
          }

          if (action === "leave_all") {
            activeChannels.clear();
            await pipeline.destroy();
            return jsonResult({ success: true, action: "left_all" });
          }

          if (action === "status") {
            return jsonResult({
              activeChannels: pipeline.getActiveCount(),
              activeVoiceConnections: voiceManager.getActiveCount(),
            });
          }

          return jsonResult({ error: `Unknown action: ${action}` });
        } catch (err) {
          return jsonResult({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    });

    api.registerGatewayMethod(
      "discord-voice.join",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const input = toParamsRecord(params);
          const joined = await startGuildVoicePipeline(input);
          respond(true, { joined: true, ...joined });
        } catch (err) {
          respond(false, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "discord-voice.leave",
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        try {
          const input = toParamsRecord(params);
          const guildId = readStringParam(input, "guildId", { required: true });
          await stopGuildVoicePipeline(guildId);
          respond(true, { left: true, guildId });
        } catch (err) {
          respond(false, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    );

    api.registerGatewayMethod(
      "discord-voice.status",
      async ({ respond }: GatewayRequestHandlerOptions) => {
        try {
          respond(true, {
            activeChannels: pipeline.getActiveCount(),
            activeVoiceConnections: voiceManager.getActiveCount(),
          });
        } catch (err) {
          respond(false, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    );

    api.registerService({
      id: "discord-voice",
      start: async () => {
        api.logger.info("[discord-voice] Service started");
      },
      stop: async () => {
        clearVoiceStateListeners();
        activeChannels.clear();
        guildVoiceStates.clear();
        await pipeline.destroy();
        api.logger.info("[discord-voice] Service stopped");
      },
    });

    api.logger.info("[discord-voice] Plugin registered");
  },
};

export default plugin;
export { DiscordVoiceConfigSchema, extractAgentReplyText };
