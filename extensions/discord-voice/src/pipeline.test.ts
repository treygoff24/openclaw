import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordVoiceConfig, LoggerLike } from "./types.js";
import { parseDiscordVoiceConfig } from "./config.js";
import { VoicePipeline } from "./pipeline.js";

const audioPipelineMock = vi.hoisted(() => {
  class MockEmitter {
    private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();

    on(event: string, handler: (...args: unknown[]) => void): this {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, new Set());
      }
      this.handlers.get(event)?.add(handler);
      return this;
    }

    off(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers.get(event)?.delete(handler);
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      const listeners = this.handlers.get(event);
      if (!listeners || listeners.size === 0) {
        return false;
      }
      for (const handler of listeners) {
        handler(...args);
      }
      return true;
    }
  }

  const instances: MockAudioPipeline[] = [];

  class MockAudioPipeline extends MockEmitter {
    subscribeUser = vi.fn();
    unsubscribeUser = vi.fn();
    destroy = vi.fn();

    constructor(
      readonly _config: unknown,
      readonly _logger: unknown,
    ) {
      super();
      instances.push(this);
    }
  }

  return {
    instances,
    MockAudioPipeline,
  };
});

vi.mock("./audio-pipeline.js", () => ({
  AudioPipeline: audioPipelineMock.MockAudioPipeline,
}));

type MockAudioPipeline = InstanceType<typeof audioPipelineMock.MockAudioPipeline>;

type TestHarness = {
  pipeline: VoicePipeline;
  voiceManager: EventEmitter & {
    join: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  stt: { transcribe: ReturnType<typeof vi.fn> };
  agentBridge: { processUtterance: ReturnType<typeof vi.fn> };
  tts: { synthesize: ReturnType<typeof vi.fn> };
  playback: {
    attachToConnection: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    isPlaying: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  logger: LoggerLike;
  ttsAudio: Buffer;
};

const DEFAULT_CONFIG = parseDiscordVoiceConfig({});

function createConfig(overrides: Partial<DiscordVoiceConfig> = {}): DiscordVoiceConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    stt: {
      ...DEFAULT_CONFIG.stt,
      ...(overrides.stt ?? {}),
    },
    tts: {
      ...DEFAULT_CONFIG.tts,
      ...(overrides.tts ?? {}),
    },
    vad: {
      ...DEFAULT_CONFIG.vad,
      ...(overrides.vad ?? {}),
    },
  };
}

function createLogger(): LoggerLike {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createHarness(configOverrides: Partial<DiscordVoiceConfig> = {}): TestHarness {
  const voiceManager = new EventEmitter() as TestHarness["voiceManager"];
  const connection = { id: "conn-1" };

  voiceManager.join = vi.fn(async () => connection);
  voiceManager.leave = vi.fn(async () => undefined);
  voiceManager.destroy = vi.fn(async () => undefined);

  const stt = {
    transcribe: vi.fn(async () => ({ text: "hello there" })),
  };

  const agentBridge = {
    processUtterance: vi.fn(async () => ({ text: "agent reply", sessionKey: "session-1" })),
  };

  const ttsAudio = Buffer.from("tts-audio");
  const tts = {
    synthesize: vi.fn(async () => ({ audio: ttsAudio, format: "mp3" as const })),
  };

  const playback = {
    attachToConnection: vi.fn(),
    play: vi.fn(async () => undefined),
    stop: vi.fn(),
    isPlaying: vi.fn(() => false),
    destroy: vi.fn(),
  };

  const logger = createLogger();

  const pipeline = new VoicePipeline({
    voiceManager: voiceManager as never,
    stt: stt as never,
    agentBridge: agentBridge as never,
    tts: tts as never,
    playback: playback as never,
    config: createConfig(configOverrides),
    logger,
  });

  return {
    pipeline,
    voiceManager,
    stt,
    agentBridge,
    tts,
    playback,
    logger,
    ttsAudio,
  };
}

function getAudioPipelineInstance(index = 0): MockAudioPipeline {
  const instance = audioPipelineMock.instances[index];
  if (!instance) {
    throw new Error(`Expected audio pipeline instance at index ${index}`);
  }
  return instance;
}

async function flushPipelineWork(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("VoicePipeline", () => {
  beforeEach(() => {
    audioPipelineMock.instances.length = 0;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs full utterance -> STT -> agent -> TTS -> playback flow", async () => {
    const harness = createHarness();
    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();
    const pcm = Buffer.from("pcm-user-audio");

    audioPipeline.emit("utterance", {
      userId: "user-1",
      audio: pcm,
      durationMs: 1200,
    });

    await flushPipelineWork();

    expect(harness.stt.transcribe).toHaveBeenCalledWith(pcm);
    expect(harness.agentBridge.processUtterance).toHaveBeenCalledWith({
      text: "hello there",
      userId: "user-1",
      userName: "user-1",
      guildId: "g1",
      channelId: "c1",
    });
    expect(harness.tts.synthesize).toHaveBeenCalledWith("agent reply");
    expect(harness.playback.play).toHaveBeenCalledWith("g1", harness.ttsAudio, "mp3");
  });

  it("skips processing when transcription is empty", async () => {
    const harness = createHarness();
    harness.stt.transcribe.mockResolvedValue({ text: "   " });

    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();
    audioPipeline.emit("utterance", {
      userId: "user-1",
      audio: Buffer.from("pcm"),
      durationMs: 600,
    });

    await flushPipelineWork();

    expect(harness.agentBridge.processUtterance).not.toHaveBeenCalled();
    expect(harness.tts.synthesize).not.toHaveBeenCalled();
    expect(harness.playback.play).not.toHaveBeenCalled();
  });

  it("skips processing when trigger names are configured and no trigger is mentioned", async () => {
    const harness = createHarness({ triggerNames: ["ren"] });
    harness.stt.transcribe.mockResolvedValue({ text: "what is the weather?" });

    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();
    audioPipeline.emit("utterance", {
      userId: "user-1",
      audio: Buffer.from("pcm"),
      durationMs: 600,
    });

    await flushPipelineWork();

    expect(harness.agentBridge.processUtterance).not.toHaveBeenCalled();
    expect(harness.tts.synthesize).not.toHaveBeenCalled();
    expect(harness.playback.play).not.toHaveBeenCalled();
  });

  it("skips TTS and playback when agent returns null", async () => {
    const harness = createHarness();
    harness.agentBridge.processUtterance.mockResolvedValue(null);

    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();
    audioPipeline.emit("utterance", {
      userId: "user-1",
      audio: Buffer.from("pcm"),
      durationMs: 800,
    });

    await flushPipelineWork();

    expect(harness.agentBridge.processUtterance).toHaveBeenCalledTimes(1);
    expect(harness.tts.synthesize).not.toHaveBeenCalled();
    expect(harness.playback.play).not.toHaveBeenCalled();
  });

  it("recovers after STT errors", async () => {
    const harness = createHarness();
    harness.stt.transcribe
      .mockRejectedValueOnce(new Error("transient stt failure"))
      .mockResolvedValueOnce({ text: "second pass" });

    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();
    audioPipeline.emit("utterance", {
      userId: "user-1",
      audio: Buffer.from("pcm-1"),
      durationMs: 300,
    });
    audioPipeline.emit("utterance", {
      userId: "user-1",
      audio: Buffer.from("pcm-2"),
      durationMs: 350,
    });

    await flushPipelineWork();

    expect(harness.stt.transcribe).toHaveBeenCalledTimes(2);
    expect(harness.agentBridge.processUtterance).toHaveBeenCalledTimes(1);
    expect(harness.logger.warn).toHaveBeenCalled();
  });

  it("logs TTS errors and keeps pipeline alive", async () => {
    const harness = createHarness();
    harness.tts.synthesize.mockRejectedValue(new Error("tts unavailable"));

    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();
    audioPipeline.emit("utterance", {
      userId: "user-1",
      audio: Buffer.from("pcm"),
      durationMs: 700,
    });

    await flushPipelineWork();

    expect(harness.agentBridge.processUtterance).toHaveBeenCalledTimes(1);
    expect(harness.playback.play).not.toHaveBeenCalled();
    expect(harness.logger.error).toHaveBeenCalled();
  });

  it("interrupts playback on speechStart when interruptible is enabled", async () => {
    const harness = createHarness({ interruptible: true });
    harness.playback.isPlaying.mockReturnValue(true);

    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();
    audioPipeline.emit("speechStart", { userId: "speaker-1" });

    expect(harness.playback.stop).toHaveBeenCalledWith("g1");
  });

  it("subscribes and unsubscribes users through channel session", async () => {
    const harness = createHarness();
    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();
    const receiver = { subscribe: vi.fn() };

    harness.pipeline.handleUserJoin("g1", "user-1", receiver as never);
    harness.pipeline.handleUserLeave("g1", "user-1");

    expect(audioPipeline.subscribeUser).toHaveBeenCalledWith("user-1", receiver);
    expect(audioPipeline.unsubscribeUser).toHaveBeenCalledWith("user-1");
  });

  it("stopChannel cleans up the session", async () => {
    const harness = createHarness();
    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();

    await harness.pipeline.stopChannel("g1");

    expect(audioPipeline.destroy).toHaveBeenCalledTimes(1);
    expect(harness.playback.stop).toHaveBeenCalledWith("g1");
    expect(harness.voiceManager.leave).toHaveBeenCalledWith("g1");
    expect(harness.pipeline.getActiveCount()).toBe(0);
  });

  it("destroy cleans up all active channels", async () => {
    const harness = createHarness();

    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });
    await harness.pipeline.startChannel({
      guildId: "g2",
      channelId: "c2",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const first = getAudioPipelineInstance(0);
    const second = getAudioPipelineInstance(1);

    await harness.pipeline.destroy();

    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
    expect(harness.voiceManager.leave).toHaveBeenCalledTimes(2);
    expect(harness.playback.destroy).toHaveBeenCalledTimes(1);
    expect(harness.voiceManager.destroy).toHaveBeenCalledTimes(1);
    expect(harness.pipeline.getActiveCount()).toBe(0);
  });

  it("processes concurrent speakers independently", async () => {
    const harness = createHarness();
    harness.stt.transcribe.mockImplementation(async (audio: Buffer) => ({
      text: audio.toString("utf8"),
    }));
    harness.agentBridge.processUtterance.mockImplementation(
      async (params: { text: string; userId: string }) => ({
        text: `reply:${params.userId}:${params.text}`,
        sessionKey: "session-concurrent",
      }),
    );
    harness.tts.synthesize.mockImplementation(async (text: string) => ({
      audio: Buffer.from(text),
      format: "mp3" as const,
    }));

    await harness.pipeline.startChannel({
      guildId: "g1",
      channelId: "c1",
      adapterCreator: { sendPayload: vi.fn(), destroy: vi.fn() },
    });

    const audioPipeline = getAudioPipelineInstance();

    audioPipeline.emit("utterance", {
      userId: "u1",
      audio: Buffer.from("alpha"),
      durationMs: 500,
    });
    audioPipeline.emit("utterance", {
      userId: "u2",
      audio: Buffer.from("beta"),
      durationMs: 550,
    });

    await flushPipelineWork();

    expect(harness.stt.transcribe).toHaveBeenCalledTimes(2);
    expect(harness.agentBridge.processUtterance).toHaveBeenCalledTimes(2);
    expect(harness.tts.synthesize).toHaveBeenCalledTimes(2);
    expect(harness.playback.play).toHaveBeenCalledTimes(2);

    const users = harness.agentBridge.processUtterance.mock.calls
      .map((call) => call[0]?.userId)
      .filter(Boolean);
    expect(new Set(users)).toEqual(new Set(["u1", "u2"]));
  });
});
