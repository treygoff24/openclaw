import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../config/config.js";
import { listAgentsForGateway } from "../../gateway/session-utils.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./sessions-helpers.js";

const AgentsListToolSchema = Type.Object({});

type AgentListEntry = {
  id: string;
  name?: string;
  configured: boolean;
};

export function createAgentsListTool(opts?: {
  agentSessionKey?: string;
  /** Explicit agent ID override for cron/hook sessions. */
  requesterAgentIdOverride?: string;
}): AnyAgentTool {
  return {
    label: "Agents",
    name: "agents_list",
    description: "List available agent ids you can target with sessions_spawn.",
    parameters: AgentsListToolSchema,
    execute: async () => {
      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const requesterInternalKey =
        typeof opts?.agentSessionKey === "string" && opts.agentSessionKey.trim()
          ? resolveInternalSessionKey({
              key: opts.agentSessionKey,
              alias,
              mainKey,
            })
          : alias;
      const requesterAgentId = normalizeAgentId(
        opts?.requesterAgentIdOverride ??
          parseAgentSessionKey(requesterInternalKey)?.agentId ??
          DEFAULT_AGENT_ID,
      );

      const configuredAgents = Array.isArray(cfg.agents?.list) ? cfg.agents?.list : [];
      const configuredIds = new Set(configuredAgents.map((entry) => normalizeAgentId(entry.id)));
      const configuredNameMap = new Map<string, string>();
      for (const entry of configuredAgents) {
        const name = entry?.name?.trim() ?? "";
        if (!name) {
          continue;
        }
        configuredNameMap.set(normalizeAgentId(entry.id), name);
      }

      const available = listAgentsForGateway(cfg).agents;
      const availableNameMap = new Map<string, string>();
      for (const entry of available) {
        if (entry.name?.trim()) {
          availableNameMap.set(entry.id, entry.name.trim());
        }
      }

      const all = new Set<string>([requesterAgentId]);
      for (const entry of available) {
        all.add(entry.id);
      }
      const allIds = Array.from(all);
      const rest = allIds
        .filter((id) => id !== requesterAgentId)
        .toSorted((a, b) => a.localeCompare(b));
      const ordered = [requesterAgentId, ...rest];
      const agents: AgentListEntry[] = ordered.map((id) => ({
        id,
        name: configuredNameMap.get(id) ?? availableNameMap.get(id),
        configured: configuredIds.has(id),
      }));

      return jsonResult({
        requester: requesterAgentId,
        allowAny: true,
        agents,
      });
    },
  };
}
