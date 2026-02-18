# Upstream Main 4-Day Cherry-Pick Sweep

Generated: 2026-02-18T18:05:56Z
Repo: /Users/treygoff/Development/openclaw
Compared: HEAD (3dc0dcea0) vs upstream/main (e583e716f)

## Classification

- Total commits on upstream/main in last 4 days: 2282
- Already present exactly in HEAD: 755
- Already present by patch-equivalent diff: 12
- Truly missing patch content (cherry-pick candidates): 1513
- Missing unclassified (merge commits): 2

## Full Exports

- Full classified list: /Users/treygoff/Development/openclaw/.codex/reports/up4_classified.tsv
- Full missing-patch list (all candidates): /Users/treygoff/Development/openclaw/.codex/reports/upstream4d_missing_patch.tsv
- Missing fix/feat/revert subset: /Users/treygoff/Development/openclaw/.codex/reports/upstream4d_missing_fix_feat.tsv
- Recommended high-priority subset: /Users/treygoff/Development/openclaw/.codex/reports/upstream4d_recommended_high.tsv

## Ready Cherry-Pick Scripts

- Full parity (all missing): /Users/treygoff/Development/openclaw/.codex/reports/upstream4d_missing_patch_cherry_all.sh
- High-priority set: /Users/treygoff/Development/openclaw/.codex/reports/upstream4d_cherry_high.sh
- Fix/feat/revert set: /Users/treygoff/Development/openclaw/.codex/reports/upstream4d_cherry_fix_feat.sh

## Recommended Cherry-Pick Sets

- High-priority now: 264 commits (security/runtime/protocol/channels/reverts)
- Broad product-impact set: 397 commits (all fix/feat/revert)
- Full parity set: 1513 commits

### High-Priority Preview (newest first, top 120)

- `95aa5480a` 2026-02-18T17:48:02Z — fix(telegram): correct onboarding import for chat lookup helper
- `fedebc245` 2026-02-18T17:47:13Z — fix(protocol): align bool-first AnyCodable equality/hash dispatch (#20233)
- `e9b4d86e3` 2026-02-18T17:39:54Z — fix(protocol): preserve AnyCodable booleans from JSON bridge (#20220)
- `d833dcd73` 2026-02-18T15:31:01+05:30 — fix(telegram): cron and heartbeat messages land in wrong chat instead of target topic (#19367)
- `33f30367e` 2026-02-18T13:39:40Z — fix(cli): include model and thinking fields in cron edit patch type
- `e71e9a55a` 2026-02-18T13:34:03Z — fix(cli): align runtime capture helper with RuntimeEnv signature
- `28b8101ee` 2026-02-18T13:15:00Z — fix(browser): handle IPv6 loopback auth and dedupe fetch auth tests
- `bb84452c6` 2026-02-18T12:43:46Z — fix(signal): restore mention-gating helper map typing
- `35016a380` 2026-02-18T04:55:40+01:00 — fix(sandbox): serialize registry mutations and lock usage
- `28bac46c9` 2026-02-18T04:55:31+01:00 — fix(security): harden safeBins path trust
- `442fdbf3d` 2026-02-18T04:53:09+01:00 — fix(security): block SSRF IPv6 transition bypasses
- `50e555353` 2026-02-18T04:53:09+01:00 — fix: align retry backoff semantics and test mock signatures
- `516046dba` 2026-02-18T04:51:25+01:00 — fix: avoid doctor token regeneration on invalid repairs
- `99db4d13e` 2026-02-18T04:48:08+01:00 — fix(gateway): guard cron webhook delivery against SSRF
- `cc29be8c9` 2026-02-18T04:44:56+01:00 — fix: serialize sandbox registry writes
- `8278903f0` 2026-02-18T04:40:42+01:00 — fix: update deep links handling
- `f25bbbc37` 2026-02-18T04:37:58+01:00 — feat: switch anthropic onboarding defaults to sonnet
- `34851a78b` 2026-02-18T03:48:18+01:00 — fix: route manual subagent spawn replies via OriginatingTo fallback
- `c90b09cb0` 2026-02-18T03:29:48+01:00 — feat(agents): support Anthropic 1M context beta header
- `b5f551d71` 2026-02-18T03:27:16+01:00 — fix(security): OC-06 prevent path traversal in config includes
- `d1c00dbb7` 2026-02-18T03:27:16+01:00 — fix: harden include confinement edge cases (#18652) (thanks @aether-ai-agent)
- `edf7d6af6` 2026-02-18T03:19:50+01:00 — fix: harden subagent completion announce retries
- `8984f3187` 2026-02-18T03:07:47Z — fix(agents): correct completion announce retry backoff schedule
- `289f215b3` 2026-02-18T03:00:27Z — fix(agents): make manual subagent completion announce deterministic
- `81db05962` 2026-02-18T02:59:40+01:00 — fix(subagents): always read latest assistant/tool output on subagent completion
- `0dd97feb4` 2026-02-18T02:57:33+01:00 — fix(subagents): include tool role in subagent completion output
- `fa4f66255` 2026-02-18T02:52:35+01:00 — fix(subagents): return completion message for manual session spawns
- `e2dd827ca` 2026-02-18T02:45:05+01:00 — fix: guarantee manual subagent spawn sends completion message
- `4134875c3` 2026-02-18T02:42:52Z — fix: route discord native subagent announce to channel target
- `c1928845a` 2026-02-18T02:35:58Z — fix: route native subagent spawns to target session
- `638853c6d` 2026-02-18T02:18:05+01:00 — fix(security): sanitize sandbox env vars before docker launch
- `5487c9ade` 2026-02-18T02:18:02+01:00 — feat(security): add sandbox env sanitization helpers + tests
- `6dcc052bb` 2026-02-18T02:09:40+01:00 — fix: stabilize model catalog and pi discovery auth storage compatibility
- `414b996b0` 2026-02-18T01:58:33+01:00 — fix(agents): make image resize logs single-line with size
- `f42e13c17` 2026-02-18T01:38:44+01:00 — feat(telegram): add forum topic creation support (#17035)
- `5bd95bef5` 2026-02-18T01:37:34Z — fix(protocol): regenerate swift gateway models
- `76949001e` 2026-02-18T01:35:37+01:00 — fix: compact skill paths in prompt (#14776) (thanks @bitfish3)
- `2e91552f0` 2026-02-18T01:31:11+01:00 — feat(agents): add generic provider api key rotation (#19587)
- `b05e89e5e` 2026-02-18T00:54:20+01:00 — fix(agents): make image sanitization dimension configurable
- `1d23934c0` 2026-02-18T00:50:22+01:00 — fix: follow-up slack streaming routing/tests (#9972) (thanks @natedenh)
- `f07bb8e8f` 2026-02-18T00:35:41+01:00 — fix(hooks): backport internal message hook bridge with safe delivery semantics
- `5acec7f79` 2026-02-18T00:08:27+01:00 — fix: wire agents.defaults.imageModel into media understanding auto-discovery
- `ae2c8f2cf` 2026-02-18T00:00:31+01:00 — feat(models): support anthropic sonnet 4.6
- `5c69e625f` 2026-02-17T23:59:20-05:00 — fix(cli): display correct model for sub-agents in sessions list (#18660)
- `c26cf6aa8` 2026-02-17T23:48:14+01:00 — feat(cron): add default stagger controls for scheduled jobs
- `dd4eb8bf6` 2026-02-17T23:48:14+01:00 — fix(cron): retry next-second schedule compute on undefined
- `442b45e54` 2026-02-17T23:47:29+01:00 — fix(gateway): make health monitor checks single-flight
- `96f7d35dd` 2026-02-17T23:47:24+01:00 — fix(gateway): block cross-session fallback in node event delivery
- `c4e9bb3b9` 2026-02-17T23:20:36+05:30 — fix: sanitize native command names for Telegram API (#19257)
- `bfc973636` 2026-02-17T20:08:50Z — feat: share to openclaw ios app (#19424)
- `32d12fcae` 2026-02-17T14:44:18+05:30 — feat(telegram): add channel_post support for bot-to-bot communication (#17857)
- `ae93bc9f5` 2026-02-17T14:29:41Z — fix(gateway): make stale token cleanup non-fatal
- `b20339a23` 2026-02-17T14:17:22-08:00 — fix(signal): canonicalize message targets in tool and inbound flows
- `b0d4c9b72` 2026-02-17T13:56:30Z — fix(discord): preserve DM lastRoute user target
- `7be63ec74` 2026-02-17T13:30:29+05:30 — fix: align tool execute arg parsing for hooks
- `9d9630c83` 2026-02-17T13:30:29+05:30 — fix: preserve telegram dm topic thread ids
- `60dc3741c` 2026-02-17T12:53:54+05:30 — fix: before_tool_call hook double-fires with abort signal (#16852)
- `583844ecf` 2026-02-17T12:36:15+05:30 — fix(telegram): avoid duplicate preview bubbles in partial stream mode (#18956)
- `e1015a519` 2026-02-17T11:39:58-08:00 — fix(bluebubbles): recover outbound message IDs and include sender metadata
- `81741c37f` 2026-02-17T11:24:08+09:00 — fix(gateway): remove watch-mode build/start race (#18782)
- `7ffc8f9f7` 2026-02-17T11:21:49+05:30 — fix(telegram): add initial message debounce for better push notifications (#18147)
- `5db95cd8d` 2026-02-17T10:40:13+02:00 — fix(extensions): revert openai codex auth plugin (PR #18009)
- `9f261f592` 2026-02-17T10:05:29-05:00 — revert: PR 18288 accidental merge (#19224)
- `11fcbadec` 2026-02-17T10:01:54-05:00 — fix(daemon): guard preferred node selection
- `4536a6e05` 2026-02-17T09:58:39-05:00 — revert(agents): revert base64 image validation (#19221)
- `f44e3b2a3` 2026-02-17T09:43:41-05:00 — revert: fix models set catalog validation (#19194)
- `dd0b78966` 2026-02-17T09:30:50-05:00 — fix(mattermost): surface reactions support
- `3211280be` 2026-02-17T09:25:18-05:00 — revert: per-model thinkingDefault override (#19195)
- `afd78133b` 2026-02-17T09:16:13-05:00 — fix(ui): revert PR #18093 directive tags (#19188)
- `19f8b6bf4` 2026-02-17T09:15:55+01:00 — fix: searchable model picker in configure (#19010) (thanks @bjesuiter)
- `d54e4af4a` 2026-02-17T09:15:01-05:00 — revert(agents): remove llms.txt discovery prompt (#19192)
- `e74ec2acd` 2026-02-17T08:48:11-05:00 — fix(cron): add spin-loop regression coverage
- `366da7569` 2026-02-17T08:47:25-05:00 — fix(cli): honor update restart overrides
- `dff869261` 2026-02-17T08:45:41-05:00 — fix(discord): normalize command allowFrom prefixes
- `111a24d55` 2026-02-17T08:44:24-05:00 — fix(daemon): scope token drift warnings
- `1f850374f` 2026-02-17T03:26:26+01:00 — fix(gateway): harden channel health monitor recovery
- `901d4cb31` 2026-02-17T03:19:42+01:00 — revert: accidental merge of OC-09 sandbox env sanitization change
- `fb6e415d0` 2026-02-17T03:10:36+01:00 — fix(agents): align session lock hold budget with run timeouts
- `9789dfd95` 2026-02-17T03:04:00+01:00 — fix(ui): correct usage range totals and muted styles
- `f24224683` 2026-02-17T03:00:01+01:00 — fix(subagents): pass group context in /subagents spawn
- `afa553325` 2026-02-17T02:55:46+01:00 — fix(mattermost): harden react remove flag parsing
- `742e6543c` 2026-02-17T02:46:24+01:00 — fix(ui): preserve locale bootstrap and trusted-proxy overview behavior
- `6244ef9ea` 2026-02-17T02:08:56+01:00 — fix: handle Windows and UNC bind mount parsing
- `c20ef582c` 2026-02-17T01:54:59+01:00 — fix: align cron session key routing (#18637) (thanks @vignesh07)
- `076df941a` 2026-02-17T00:17:01+01:00 — feat: add configurable tool loop detection
- `dacffd7ac` 2026-02-17T00:02:12+01:00 — fix(sandbox): parse Windows bind mounts in fs-path mapping
- `e997545d4` 2026-02-17T00:02:09+01:00 — fix(discord): apply proxy to app-id and allowlist REST lookups
- `de6cc05e7` 2026-02-17T00:01:53+01:00 — fix(cron): prevent spin loop when job completes within firing second (#17821)
- `1a9a2e396` 2026-02-17T00:01:30+01:00 — feat: Add GOALS.md and SOUVENIR.md template files
- `b4a90bb74` 2026-02-17T00:01:26+01:00 — fix(telegram): suppress message_thread_id for private chat sends (#17242)
- `2ed43fd7b` 2026-02-17T00:01:22+01:00 — fix(cron): resolve accountId from agent bindings in isolated sessions
- `7bb9a7dcf` 2026-02-17T00:01:07+01:00 — fix(telegram): wire sendPollTelegram into channel action handler (#16977)
- `068b9c974` 2026-02-17T00:01:03+01:00 — feat: wrap compaction generateSummary in retryAsync
- `45b3c883b` 2026-02-17T00:01:00+01:00 — fix: regenerate pnpm lockfile
- `990cf2d22` 2026-02-17T00:01:00+01:00 — fix(extensions): address greptile review comments for openai-codex-auth
- `4cd75d5d0` 2026-02-17T00:00:57+01:00 — fix: remove accidental openclaw link dependency
- `add3afb74` 2026-02-17T00:00:57+01:00 — feat: add /export-session command
- `f82a3d3e2` 2026-02-17T00:00:57+01:00 — fix: use resolveUserPath utility for tilde expansion
- `ffe700bf9` 2026-02-17T00:00:57+01:00 — fix: use proper pi-mono dark theme colors for export HTML
- `e20b87f1b` 2026-02-17T00:00:51+01:00 — fix: handle forum/topics in Telegram DM thread routing (#17980)
- `d64906918` 2026-02-17T00:00:47+01:00 — fix: add optional chaining to runResult.meta accesses to prevent crashes on aborted runs
- `57c8f6239` 2026-02-17T00:00:40+01:00 — fix(cron): reuse existing sessionId for webhook/cron sessions
- `952db1a3e` 2026-02-17T00:00:34+01:00 — fix(discord): route audioAsVoice payloads through voice message API
- `1fca7c392` 2026-02-17T00:00:30+01:00 — fix(discord): strip user:/discord:/pk: prefixes in command allowFrom
- `235794d9f` 2026-02-17T00:00:23+01:00 — fix(security): OC-09 credential theft via environment variable injection
- `3296a25cc` 2026-02-17T00:00:20+01:00 — fix: format compaction-safeguard.ts with oxfmt
- `65a1787f9` 2026-02-17T00:00:20+01:00 — fix: normalize paths to forward slashes for Windows RegExp compatibility
- `811c4f5e9` 2026-02-17T00:00:20+01:00 — feat: add post-compaction read audit (Layer 3)
- `c4f829411` 2026-02-17T00:00:20+01:00 — feat: append workspace critical rules to compaction summary
- `d0b33f23e` 2026-02-17T00:00:20+01:00 — fix: improve section extraction robustness (case-insensitive, H3, code blocks)
- `b1d5c7160` 2026-02-17T00:00:16+01:00 — fix(cli): use standalone script for service restart after update (#17225)
- `068260bbe` 2026-02-17T00:00:08+01:00 — fix: add api-version query param for Azure verification
- `960cc1151` 2026-02-17T00:00:08+01:00 — fix: add Azure AI Foundry URL support for custom providers
- `d6acd7157` 2026-02-17T00:00:08+01:00 — fix: session-memory hook finds previous session file after /new/reset
- `4e5a9d83b` 2026-02-17T00:00:03+01:00 — fix(gateway): preserve unbracketed IPv6 host headers
- `0e6daa2e6` 2026-02-16T23:59:59+01:00 — fix(browser): handle EADDRINUSE with automatic port fallback
- `8e55503d7` 2026-02-16T23:59:59+01:00 — fix(browser): track original port mapping for EADDRINUSE fallback
- `d0a5ee017` 2026-02-16T23:59:50+01:00 — fix: include token drift warning in JSON response
- `d6e85aa6b` 2026-02-16T23:59:50+01:00 — fix(daemon): warn on token drift during restart (#18018)
- `8af4712c4` 2026-02-16T23:59:44+01:00 — fix(cron): prevent spin loop when job completes within scheduled second (#17821)

### Missing Unclassified Merge Commits

- `5b3ecadec` 2026-02-18T00:51:04+01:00 — Merge remote-tracking branch 'origin/main'
- `bb9a539d1` 2026-02-18T00:49:30+01:00 — Merge remote-tracking branch 'prhead/feat/slack-text-streaming'
