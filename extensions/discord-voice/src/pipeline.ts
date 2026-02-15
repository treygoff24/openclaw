import type { VoiceReceiver } from "@discordjs/voice";
import { EventEmitter } from "node:events";
import type { AgentBridge } from "./agent-bridge.js";
import type { PlaybackManager } from "./playback.js";
import type { WhisperSTT } from "./stt.js";
import type { TTSProvider } from "./tts.js";
import type { DiscordVoiceConfig, LoggerLike } from "./types.js";
import type { VoiceManager } from "./voice-manager.js";
import { AudioPipeline, type UtteranceEvent } from "./audio-pipeline.js";

type ChannelSession = {
  channelId: string;
  audioPipeline: AudioPipeline;
  activeUsers: Set<string>;
  onUtterance: (event: UtteranceEvent) => void;
  onSpeechStart: (event: { userId: string }) => void;
  onSpeechEnd: (event: { userId: string }) => void;
};

const FILLER_WORDS = new Set([
  "uh",
  "um",
  "ah",
  "eh",
  "er",
  "hmm",
  "hm",
  "mm",
  "mmm",
  "noise",
  "background noise",
]);

export class VoicePipeline extends EventEmitter {
  private readonly voiceManager: VoiceManager;
  private readonly stt: WhisperSTT;
  private readonly agentBridge: AgentBridge;
  private readonly tts: TTSProvider;
  private readonly playback: PlaybackManager;
  private readonly config: DiscordVoiceConfig;
  private readonly logger: LoggerLike;
  private readonly sessions = new Map<string, ChannelSession>();

  constructor(params: {
    voiceManager: VoiceManager;
    stt: WhisperSTT;
    agentBridge: AgentBridge;
    tts: TTSProvider;
    playback: PlaybackManager;
    config: DiscordVoiceConfig;
    logger: LoggerLike;
  }) {
    super();
    this.voiceManager = params.voiceManager;
    this.stt = params.stt;
    this.agentBridge = params.agentBridge;
    this.tts = params.tts;
    this.playback = params.playback;
    this.config = params.config;
    this.logger = params.logger;

    this.voiceManager.on("destroyed", ({ guildId }: { guildId: string }) => {
      this.cleanupSession(guildId);
    });
  }

  async startChannel(params: {
    channelId: string;
    guildId: string;
    adapterCreator: unknown;
  }): Promise<void> {
    const existing = this.sessions.get(params.guildId);
    if (existing) {
      if (existing.channelId === params.channelId) {
        this.logger.debug?.(
          `[discord-voice] Voice pipeline already active for guild ${params.guildId} channel ${params.channelId}`,
        );
        return;
      }

      await this.stopChannel(params.guildId);
    }

    const connection = await this.voiceManager.join({
      channelId: params.channelId,
      guildId: params.guildId,
      adapterCreator: params.adapterCreator,
    });

    try {
      const audioPipeline = new AudioPipeline(this.config.vad, this.logger);
      this.playback.attachToConnection(params.guildId, connection);

      const onUtterance = (event: UtteranceEvent) => {
        void this.handleUtterance(params.guildId, params.channelId, event);
      };

      const onSpeechStart = (event: { userId: string }) => {
        if (this.config.interruptible && this.playback.isPlaying(params.guildId)) {
          this.logger.debug?.(
            `[discord-voice] Interrupting playback in guild ${params.guildId} due to speech from user ${event.userId}`,
          );
          this.playback.stop(params.guildId);
        }

        this.emit("speechStart", {
          guildId: params.guildId,
          channelId: params.channelId,
          userId: event.userId,
        });
      };

      const onSpeechEnd = (event: { userId: string }) => {
        this.emit("speechEnd", {
          guildId: params.guildId,
          channelId: params.channelId,
          userId: event.userId,
        });
      };

      audioPipeline.on("utterance", onUtterance);
      audioPipeline.on("speechStart", onSpeechStart);
      audioPipeline.on("speechEnd", onSpeechEnd);

      this.sessions.set(params.guildId, {
        channelId: params.channelId,
        audioPipeline,
        activeUsers: new Set(),
        onUtterance,
        onSpeechStart,
        onSpeechEnd,
      });

      this.logger.info(
        `[discord-voice] Started voice pipeline for guild ${params.guildId} in channel ${params.channelId}`,
      );
    } catch (error) {
      await this.voiceManager.leave(params.guildId).catch(() => undefined);
      throw error;
    }
  }

  async stopChannel(guildId: string): Promise<void> {
    this.cleanupSession(guildId);
    await this.voiceManager.leave(guildId);
    this.logger.info(`[discord-voice] Stopped voice pipeline for guild ${guildId}`);
  }

  async destroy(): Promise<void> {
    const errors: string[] = [];

    for (const guildId of [...this.sessions.keys()]) {
      try {
        await this.stopChannel(guildId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        errors.push(`stopChannel(${guildId}): ${reason}`);
      }
    }

    try {
      this.playback.destroy();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`playback.destroy(): ${reason}`);
    }

    try {
      await this.voiceManager.destroy();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`voiceManager.destroy(): ${reason}`);
    }

    this.removeAllListeners();

    if (errors.length > 0) {
      throw new Error(
        `VoicePipeline destroy encountered ${errors.length} error(s): ${errors.join(" | ")}`,
      );
    }
  }

  handleUserJoin(guildId: string, userId: string, receiver: VoiceReceiver): void {
    const session = this.sessions.get(guildId);
    if (!session) {
      this.logger.debug?.(
        `[discord-voice] Ignoring user join for guild ${guildId}; no active voice pipeline session`,
      );
      return;
    }

    try {
      if (session.activeUsers.has(userId)) {
        session.audioPipeline.unsubscribeUser(userId);
      }
      session.audioPipeline.subscribeUser(userId, receiver);
      session.activeUsers.add(userId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[discord-voice] Failed to subscribe user ${userId} for guild ${guildId}: ${reason}`,
      );
    }
  }

  handleUserLeave(guildId: string, userId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) {
      return;
    }

    try {
      session.audioPipeline.unsubscribeUser(userId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[discord-voice] Failed to unsubscribe user ${userId} for guild ${guildId}: ${reason}`,
      );
    } finally {
      session.activeUsers.delete(userId);
    }
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  private cleanupSession(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session) {
      return;
    }

    session.audioPipeline.off("utterance", session.onUtterance);
    session.audioPipeline.off("speechStart", session.onSpeechStart);
    session.audioPipeline.off("speechEnd", session.onSpeechEnd);

    try {
      session.audioPipeline.destroy();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[discord-voice] Failed to destroy audio pipeline for guild ${guildId}: ${reason}`,
      );
    }

    try {
      this.playback.stop(guildId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[discord-voice] Failed to stop playback for guild ${guildId}: ${reason}`);
    }

    session.activeUsers.clear();
    this.sessions.delete(guildId);
  }

  private async handleUtterance(
    guildId: string,
    channelId: string,
    event: UtteranceEvent,
  ): Promise<void> {
    let text = "";
    try {
      const transcription = await this.stt.transcribe(event.audio);
      text = (transcription.text ?? "").trim();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[discord-voice] STT failed for user ${event.userId} in guild ${guildId}: ${reason}`,
      );
      return;
    }

    if (!text || this.isNoiseText(text)) {
      return;
    }

    // Name-gating: only respond if a trigger name is mentioned
    if (this.config.triggerNames.length > 0 && !this.containsTriggerName(text)) {
      this.logger.debug?.(
        `[discord-voice] Skipping utterance from ${event.userId} — no trigger name detected`,
      );
      return;
    }

    let responseText = "";
    try {
      const response = await this.agentBridge.processUtterance({
        text,
        userId: event.userId,
        userName: event.userId,
        guildId,
        channelId,
      });
      responseText = (response?.text ?? "").trim();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[discord-voice] Agent processing failed for user ${event.userId} in guild ${guildId}: ${reason}`,
      );
      return;
    }

    if (!responseText) {
      return;
    }

    try {
      const synthesis = await this.tts.synthesize(responseText);
      await this.playback.play(guildId, synthesis.audio, synthesis.format);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[discord-voice] TTS/playback failed for guild ${guildId} user ${event.userId}: ${reason}`,
      );
    }
  }

  private containsTriggerName(text: string): boolean {
    const lower = text.toLowerCase();
    return this.config.triggerNames.some((name) => lower.includes(name.toLowerCase()));
  }

  private isNoiseText(text: string): boolean {
    const normalized = text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) {
      return true;
    }

    const tokens = normalized.split(" ").filter(Boolean);
    if (tokens.length <= 2 && tokens.every((token) => FILLER_WORDS.has(token))) {
      return true;
    }

    return FILLER_WORDS.has(normalized);
  }
}
