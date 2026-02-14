import { describe, expect, it } from "vitest";
import {
  resolveDiscordChannelConfig,
  resolveDiscordChannelConfigWithFallback,
  type DiscordGuildEntryResolved,
} from "./allow-list.js";

describe("discord channel allowlist resolution", () => {
  const channelParams = {
    channelId: "1471919621530714225",
    channelName: "red-team",
    channelSlug: "red-team",
  };

  it("treats empty channel maps as no allowlist", () => {
    const guildInfo: DiscordGuildEntryResolved = {
      id: "1466858867391729746",
      channels: {},
    };

    const direct = resolveDiscordChannelConfig({
      guildInfo,
      ...channelParams,
    });
    const withFallback = resolveDiscordChannelConfigWithFallback({
      guildInfo,
      ...channelParams,
    });

    expect(direct).toBeNull();
    expect(withFallback).toBeNull();
  });

  it("still blocks unmatched channels when an allowlist exists", () => {
    const guildInfo: DiscordGuildEntryResolved = {
      id: "1466858867391729746",
      channels: {
        "123456789012345678": { allow: true },
      },
    };

    const resolved = resolveDiscordChannelConfigWithFallback({
      guildInfo,
      ...channelParams,
    });

    expect(resolved).toEqual({ allowed: false });
  });

  it("resolves wildcard channel entries when configured", () => {
    const guildInfo: DiscordGuildEntryResolved = {
      id: "1466858867391729746",
      channels: {
        "*": { allow: true, requireMention: false },
      },
    };

    const resolved = resolveDiscordChannelConfigWithFallback({
      guildInfo,
      ...channelParams,
    });

    expect(resolved?.allowed).toBe(true);
    expect(resolved?.requireMention).toBe(false);
  });
});
