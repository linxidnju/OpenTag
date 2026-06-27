# OpenTag MVP Implementation Notes

This repository implements a Slack-first MVP that mirrors the important Claude Tag product primitives without binding OpenTag to one model provider.

## Implemented primitives

- Channel-native Slack entry through `app_mention`.
- Thread-scoped sessions: `session_id = platform + workspace + channel + thread_ts`.
- Follow-up messages in the same Slack thread can continue the session.
- Runtime adapter interface for `mock`, `claude-code`, `codex`, `opencode`, `generic-cli`, and `http` runtimes.
- File-backed durable state for sessions, messages, approvals, and audit events.
- Ephemeral sandbox directory per run.
- Channel-scoped runtime allowlist, user allowlist, approval rules, and deny patterns.
- Slack interactive approval buttons.
- Streaming output aggregation to avoid spamming Slack.

## Runtime safety defaults

The example config defaults to `mock`. Read-only Claude Code and Codex adapters are included but must be explicitly selected with `/runtime claude-code-readonly ...` or `/runtime codex-readonly ...` after credentials and CLI tools are installed.

Write-capable runtimes should be added as separate runtime IDs and protected with `requireApprovalForWriteAccess: true`.

## CLI commands

```bash
npm test
npm run doctor
npm run start:console
npm run start
```

## Slack commands inside thread

```text
/opentag help
/opentag status
/opentag runtimes
/opentag cancel
/runtime codex-readonly summarize this repo
```
