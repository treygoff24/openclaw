import type { MsgContext } from "../auto-reply/templating.js";
import {
  recordSessionMetaFromInbound,
  type GroupKeyResolution,
  type SessionEntry,
  updateLastRoute,
} from "../config/sessions.js";

const DEFAULT_SESSION_META_DEBOUNCE_MS = 25;

type InboundSessionMetaWriteParams = {
  storePath: string;
  sessionKey: string;
  ctx: MsgContext;
  groupResolution?: GroupKeyResolution | null;
  createIfMissing?: boolean;
};

type PendingInboundSessionMetaWrite = {
  timer: ReturnType<typeof setTimeout>;
  write: InboundSessionMetaWriteParams;
  onErrors: Array<(err: unknown) => void>;
};

const pendingInboundSessionMetaWrites = new Map<string, PendingInboundSessionMetaWrite>();

export type InboundLastRouteUpdate = {
  sessionKey: string;
  channel: SessionEntry["lastChannel"];
  to: string;
  accountId?: string;
  threadId?: string | number;
};

function resolveSessionMetaDebounceMs(): number {
  const raw = process.env.OPENCLAW_SESSION_META_DEBOUNCE_MS?.trim();
  if (!raw) {
    return DEFAULT_SESSION_META_DEBOUNCE_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SESSION_META_DEBOUNCE_MS;
  }
  return Math.max(0, Math.floor(parsed));
}

function sessionMetaDebounceKey(
  params: Pick<InboundSessionMetaWriteParams, "storePath" | "sessionKey">,
) {
  return `${params.storePath}\u0000${params.sessionKey}`;
}

function scheduleSessionMetaWrite(
  params: InboundSessionMetaWriteParams & { onRecordError: (err: unknown) => void },
) {
  const write: InboundSessionMetaWriteParams = {
    storePath: params.storePath,
    sessionKey: params.sessionKey,
    ctx: params.ctx,
    groupResolution: params.groupResolution,
    createIfMissing: params.createIfMissing ?? true,
  };
  const debounceMs = resolveSessionMetaDebounceMs();
  if (debounceMs <= 0) {
    void recordSessionMetaFromInbound(write).catch(params.onRecordError);
    return;
  }

  const key = sessionMetaDebounceKey(write);
  const existing = pendingInboundSessionMetaWrites.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    existing.write = {
      ...existing.write,
      ctx: write.ctx,
      groupResolution: write.groupResolution,
      createIfMissing: Boolean(existing.write.createIfMissing || write.createIfMissing),
    };
    existing.onErrors.push(params.onRecordError);
    existing.timer = setTimeout(() => {
      const pending = pendingInboundSessionMetaWrites.get(key);
      if (!pending) {
        return;
      }
      pendingInboundSessionMetaWrites.delete(key);
      void recordSessionMetaFromInbound(pending.write).catch((err) => {
        for (const onError of pending.onErrors) {
          try {
            onError(err);
          } catch {
            // Avoid surfacing callback errors from fire-and-forget writes.
          }
        }
      });
    }, debounceMs);
    existing.timer.unref?.();
    return;
  }

  const timer = setTimeout(() => {
    const pending = pendingInboundSessionMetaWrites.get(key);
    if (!pending) {
      return;
    }
    pendingInboundSessionMetaWrites.delete(key);
    void recordSessionMetaFromInbound(pending.write).catch((err) => {
      for (const onError of pending.onErrors) {
        try {
          onError(err);
        } catch {
          // Avoid surfacing callback errors from fire-and-forget writes.
        }
      }
    });
  }, debounceMs);
  timer.unref?.();
  pendingInboundSessionMetaWrites.set(key, { timer, write, onErrors: [params.onRecordError] });
}

export async function recordInboundSession(params: {
  storePath: string;
  sessionKey: string;
  ctx: MsgContext;
  groupResolution?: GroupKeyResolution | null;
  createIfMissing?: boolean;
  updateLastRoute?: InboundLastRouteUpdate;
  onRecordError: (err: unknown) => void;
}): Promise<void> {
  const { storePath, sessionKey, ctx, groupResolution, createIfMissing } = params;
  scheduleSessionMetaWrite({
    storePath,
    sessionKey,
    ctx,
    groupResolution,
    createIfMissing,
    onRecordError: params.onRecordError,
  });

  const update = params.updateLastRoute;
  if (!update) {
    return;
  }
  await updateLastRoute({
    storePath,
    sessionKey: update.sessionKey,
    deliveryContext: {
      channel: update.channel,
      to: update.to,
      accountId: update.accountId,
      threadId: update.threadId,
    },
    ctx,
    groupResolution,
  });
}
