import type { GatewayPlugin } from "@buape/carbon/gateway";
import type {
  GatewayVoiceServerUpdateDispatchData,
  GatewayVoiceStateUpdateDispatchData,
} from "discord-api-types/v10";

/**
 * Module-level registry of active Discord GatewayPlugin instances.
 * Bridges the gap between agent tool handlers (which only have REST access)
 * and the gateway WebSocket (needed for operations like updatePresence).
 * Follows the same pattern as presence-cache.ts.
 */
type GatewayEntry = {
  gateway: GatewayPlugin;
  botUserId?: string;
};

// Use globalThis to ensure a single shared registry across all module instances
// (extensions loaded via jiti may get their own copy of this module otherwise)
const GLOBAL_KEY = Symbol.for("openclaw.discord.gateway-registry");

type RegistryGlobals = {
  gatewayRegistry: Map<string, GatewayEntry>;
  voiceStateListeners: Map<string, Set<VoiceStateUpdateListener>>;
  voiceServerListeners: Map<string, Set<VoiceServerUpdateListener>>;
};

type VoiceStateUpdateListener = (event: GatewayVoiceStateUpdateDispatchData) => void;
type VoiceServerUpdateListener = (event: GatewayVoiceServerUpdateDispatchData) => void;

function getOrCreateGlobals(): RegistryGlobals {
  const g = globalThis as unknown as Record<symbol, RegistryGlobals | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      gatewayRegistry: new Map<string, GatewayEntry>(),
      voiceStateListeners: new Map<string, Set<VoiceStateUpdateListener>>(),
      voiceServerListeners: new Map<string, Set<VoiceServerUpdateListener>>(),
    };
  }
  return g[GLOBAL_KEY];
}

const { gatewayRegistry, voiceStateListeners, voiceServerListeners } = getOrCreateGlobals();

// Sentinel key for the default (unnamed) account. Uses a prefix that cannot
// collide with user-configured account IDs.
const DEFAULT_ACCOUNT_KEY = "\0__default__";

function resolveAccountKey(accountId?: string): string {
  return accountId ?? DEFAULT_ACCOUNT_KEY;
}

function normalizeBotUserId(botUserId?: string): string | undefined {
  const trimmed = botUserId?.trim();
  return trimmed ? trimmed : undefined;
}

/** Register a GatewayPlugin instance for an account. */
export function registerGateway(
  accountId: string | undefined,
  gateway: GatewayPlugin,
  opts?: { botUserId?: string },
): void {
  gatewayRegistry.set(resolveAccountKey(accountId), {
    gateway,
    botUserId: normalizeBotUserId(opts?.botUserId),
  });
}

/**
 * Update bot user id metadata for a registered gateway account.
 * Safe no-op when no gateway is registered.
 */
export function setGatewayBotUserId(accountId: string | undefined, botUserId?: string): void {
  const key = resolveAccountKey(accountId);
  const existing = gatewayRegistry.get(key);
  if (!existing) {
    return;
  }
  gatewayRegistry.set(key, {
    ...existing,
    botUserId: normalizeBotUserId(botUserId),
  });
}

/** Unregister a GatewayPlugin instance for an account. */
export function unregisterGateway(accountId?: string): void {
  const key = resolveAccountKey(accountId);
  gatewayRegistry.delete(key);
  voiceStateListeners.delete(key);
  voiceServerListeners.delete(key);
}

/** Get the GatewayPlugin for an account. Returns undefined if not registered. */
export function getGateway(accountId?: string): GatewayPlugin | undefined {
  return gatewayRegistry.get(resolveAccountKey(accountId))?.gateway;
}

/** Get the current bot user id for an account. Returns undefined if unavailable. */
export function getGatewayBotUserId(accountId?: string): string | undefined {
  return gatewayRegistry.get(resolveAccountKey(accountId))?.botUserId;
}

/** Subscribe to Discord VoiceStateUpdate relay events for an account. */
export function subscribeGatewayVoiceStateUpdates(
  accountId: string | undefined,
  listener: VoiceStateUpdateListener,
): () => void {
  const key = resolveAccountKey(accountId);
  const listeners = voiceStateListeners.get(key) ?? new Set<VoiceStateUpdateListener>();
  listeners.add(listener);
  voiceStateListeners.set(key, listeners);

  return () => {
    const next = voiceStateListeners.get(key);
    if (!next) {
      return;
    }
    next.delete(listener);
    if (next.size === 0) {
      voiceStateListeners.delete(key);
    }
  };
}

/** Subscribe to Discord VoiceServerUpdate relay events for an account. */
export function subscribeGatewayVoiceServerUpdates(
  accountId: string | undefined,
  listener: VoiceServerUpdateListener,
): () => void {
  const key = resolveAccountKey(accountId);
  const listeners = voiceServerListeners.get(key) ?? new Set<VoiceServerUpdateListener>();
  listeners.add(listener);
  voiceServerListeners.set(key, listeners);

  return () => {
    const next = voiceServerListeners.get(key);
    if (!next) {
      return;
    }
    next.delete(listener);
    if (next.size === 0) {
      voiceServerListeners.delete(key);
    }
  };
}

/** Publish a VoiceStateUpdate event to account subscribers. */
export function publishGatewayVoiceStateUpdate(
  accountId: string | undefined,
  event: GatewayVoiceStateUpdateDispatchData,
): void {
  const listeners = voiceStateListeners.get(resolveAccountKey(accountId));
  if (!listeners || listeners.size === 0) {
    return;
  }

  for (const listener of listeners) {
    listener(event);
  }
}

/** Publish a VoiceServerUpdate event to account subscribers. */
export function publishGatewayVoiceServerUpdate(
  accountId: string | undefined,
  event: GatewayVoiceServerUpdateDispatchData,
): void {
  const listeners = voiceServerListeners.get(resolveAccountKey(accountId));
  if (!listeners || listeners.size === 0) {
    return;
  }

  for (const listener of listeners) {
    listener(event);
  }
}

/** Clear all registered gateways (for testing). */
export function clearGateways(): void {
  gatewayRegistry.clear();
  voiceStateListeners.clear();
  voiceServerListeners.clear();
}
