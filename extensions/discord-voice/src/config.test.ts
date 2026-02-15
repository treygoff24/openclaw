import { describe, expect, it, vi } from "vitest";
import {
  DiscordVoiceConfigSchema,
  parseDiscordVoiceConfig,
  resolveElevenLabsApiKey,
  resolveOpenAIApiKey,
} from "./config.js";

describe("DiscordVoiceConfigSchema", () => {
  it("parses default config", () => {
    const parsed = parseDiscordVoiceConfig({});

    expect(parsed).toEqual({
      enabled: true,
      autoJoin: false,
      autoDisconnectOnEmpty: true,
      stt: {
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
        language: "en",
      },
      tts: {
        provider: "openai",
      },
      vad: {
        silenceThresholdMs: 800,
        minSpeechMs: 250,
        energyThreshold: 0.015,
      },
      triggerNames: [],
      voiceSystemPrompt: "",
      interruptible: true,
      maxConcurrentChannels: 2,
      allowedGuilds: [],
      allowedChannels: [],
    });
  });

  it("applies custom overrides", () => {
    const parsed = parseDiscordVoiceConfig({
      enabled: false,
      autoJoin: true,
      autoDisconnectOnEmpty: false,
      stt: { provider: "openai", model: "whisper-1", language: "es" },
      tts: { provider: "elevenlabs", voiceId: "voice_123", modelId: "eleven_turbo_v2" },
      vad: { silenceThresholdMs: 1_200, minSpeechMs: 400, energyThreshold: 0.04 },
      triggerNames: [" Ren ", "ren", "", "assistant"],
      voiceSystemPrompt: "  keep it short  ",
      interruptible: false,
      maxConcurrentChannels: 6,
      allowedGuilds: ["guild-1"],
      allowedChannels: ["chan-1", "chan-2"],
    });

    expect(parsed.enabled).toBe(false);
    expect(parsed.autoJoin).toBe(true);
    expect(parsed.autoDisconnectOnEmpty).toBe(false);
    expect(parsed.stt.model).toBe("whisper-1");
    expect(parsed.stt.language).toBe("es");
    expect(parsed.tts.provider).toBe("elevenlabs");
    expect(parsed.tts.voiceId).toBe("voice_123");
    expect(parsed.vad.silenceThresholdMs).toBe(1_200);
    expect(parsed.triggerNames).toEqual(["Ren", "ren", "assistant"]);
    expect(parsed.voiceSystemPrompt).toBe("  keep it short  ");
    expect(parsed.interruptible).toBe(false);
    expect(parsed.maxConcurrentChannels).toBe(6);
    expect(parsed.allowedGuilds).toEqual(["guild-1"]);
    expect(parsed.allowedChannels).toEqual(["chan-1", "chan-2"]);
  });

  it("rejects invalid values", () => {
    expect(() =>
      DiscordVoiceConfigSchema.parse({
        vad: { silenceThresholdMs: -1, minSpeechMs: 250, energyThreshold: 0.015 },
      }),
    ).toThrow();

    expect(() =>
      DiscordVoiceConfigSchema.parse({
        stt: { provider: "unknown", model: "whisper-1", language: "en" },
      }),
    ).toThrow();
  });

  it("resolves API keys from env vars", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-from-env");
    vi.stubEnv("ELEVENLABS_API_KEY", "elevenlabs-from-env");

    const parsed = parseDiscordVoiceConfig({});

    expect(resolveOpenAIApiKey(parsed)).toBe("openai-from-env");
    expect(resolveElevenLabsApiKey(parsed)).toBe("elevenlabs-from-env");
  });
});
