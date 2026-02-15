import { z } from "zod";

export const DiscordVoiceSttConfigSchema = z
  .object({
    provider: z.literal("openai").default("openai"),
    model: z.string().min(1).default("gpt-4o-mini-transcribe"),
    language: z.string().min(1).default("en"),
  })
  .strict()
  .default({
    provider: "openai",
    model: "gpt-4o-mini-transcribe",
    language: "en",
  });

export const DiscordVoiceTtsConfigSchema = z
  .object({
    provider: z.enum(["elevenlabs", "openai"]).default("openai"),
    voiceId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
  })
  .strict()
  .default({ provider: "openai" });

export const DiscordVoiceVadConfigSchema = z
  .object({
    silenceThresholdMs: z.number().nonnegative().default(800),
    minSpeechMs: z.number().nonnegative().default(250),
    energyThreshold: z.number().nonnegative().default(0.015),
  })
  .strict()
  .default({
    silenceThresholdMs: 800,
    minSpeechMs: 250,
    energyThreshold: 0.015,
  });

export const DiscordVoiceConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    autoJoin: z.boolean().default(false),
    autoDisconnectOnEmpty: z.boolean().default(true),
    stt: DiscordVoiceSttConfigSchema,
    tts: DiscordVoiceTtsConfigSchema,
    vad: DiscordVoiceVadConfigSchema,
    /** Name(s) that must appear in the transcription to trigger a response. Empty = respond to everything. */
    triggerNames: z
      .array(z.string())
      .default([])
      .transform((names) => [
        ...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0)),
      ]),
    /** System prompt injected at the start of every voice session. */
    voiceSystemPrompt: z.string().default(""),
    interruptible: z.boolean().default(true),
    maxConcurrentChannels: z.number().int().positive().default(2),
    allowedGuilds: z.array(z.string()).default([]),
    allowedChannels: z.array(z.string()).default([]),
  })
  .strict();

export type DiscordVoiceConfig = z.infer<typeof DiscordVoiceConfigSchema>;

export function parseDiscordVoiceConfig(config: unknown): DiscordVoiceConfig {
  return DiscordVoiceConfigSchema.parse(config ?? {});
}

export function resolveOpenAIApiKey(config: DiscordVoiceConfig): string | undefined {
  const raw = config as unknown as {
    openaiApiKey?: string;
    stt?: { apiKey?: string };
    tts?: { apiKey?: string; openaiApiKey?: string };
  };

  return (
    raw.openaiApiKey ??
    raw.stt?.apiKey ??
    raw.tts?.apiKey ??
    raw.tts?.openaiApiKey ??
    process.env.OPENAI_API_KEY
  );
}

export function resolveElevenLabsApiKey(config: DiscordVoiceConfig): string | undefined {
  const raw = config as unknown as {
    elevenLabsApiKey?: string;
    tts?: { apiKey?: string; elevenLabsApiKey?: string };
  };

  return (
    raw.elevenLabsApiKey ??
    raw.tts?.apiKey ??
    raw.tts?.elevenLabsApiKey ??
    process.env.ELEVENLABS_API_KEY
  );
}
