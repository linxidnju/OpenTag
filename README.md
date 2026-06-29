# OpenTag: Channel-Native Agent Gateway

> OpenTag is an open-source, channel-native agent gateway for teams. It turns Slack channels, threads, DMs, and commands into auditable agent sessions that can run Claude Code, Codex, OpenCode, Docker sandboxes, HTTP agents, and generic CLI agents.

[English](README.md) · [简体中文](README.zh-CN.md) · [User Guide](docs/user-guide/README.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

---

## What Is OpenTag

OpenTag is not another chatbot. It is a shared agent gateway for collaboration channels.

Teams can mention `@OpenTag` in Slack, continue the work inside the same thread, route the task to a configured runtime, require approvals for risky actions, and keep a durable audit trail of messages, runs, approvals, and artifacts.

```text
Team in Slack
  -> channel / thread / DM / slash command
  -> OpenTag Gateway
  -> session + context + policy + approval
  -> runtime adapter
  -> Claude Code / Codex / OpenCode / Docker / HTTP / generic CLI
  -> thread reply + audit + artifacts + admin APIs
```

The current implementation is a Slack-first Node.js MVP. The architecture is channel-native and runtime-agnostic, so additional channels and agent runtimes can be added without binding the core engine to Slack or to a single model vendor.

---

## Why OpenTag

Agent CLIs are powerful, but most team work starts in a shared channel, not in one developer's terminal. OpenTag bridges that gap.

- **Channel-native by design**: channel, thread, workspace, and user identity define session scope, permissions, context, and auditability.
- **Runtime-agnostic**: Claude Code, Codex, OpenCode, Docker, HTTP agents, and internal CLIs are runtime adapters behind one contract.
- **Safety-first defaults**: write-capable runtimes, dangerous prompts, filesystem roots, and Slack posting can be guarded by policy and approval.
- **Auditable teamwork**: sessions, messages, events, approvals, runs, artifacts, and audit records are persisted.
- **Local-first MVP**: Socket Mode, file-backed storage, mock runtime, console gateway, and deterministic tests make it easy to run locally.

---

## Product Tour

### Slack Gateway

- `@OpenTag` starts or continues an agent session from a Slack channel.
- Thread replies continue an existing session without turning every channel message into a task.
- DMs and MPIM conversations can create personal sessions.
- `/opentag` supports operational commands such as `help`, `sessions`, `approvals`, `runtimes`, `status`, and `cancel`.
- Slack approval buttons support approve, deny, and cancel flows.

### Runtime Adapters

| Runtime | Purpose |
| --- | --- |
| `mock` | Deterministic local tests and smoke runs |
| `claude-code` | Claude Code CLI execution |
| `codex` | Codex CLI non-interactive execution |
| `opencode` | OpenCode CLI execution |
| `generic-cli` | Hermes Agent, OpenClaw, or internal CLIs |
| `docker` | Isolated container runtime |
| `http` | Remote agent server integration |

### Policy, Memory, And Audit

- Channel-level runtime allowlists, user allowlists, approvers, instructions, memory, workspace roots, and allowed roots.
- Runtime override with `/runtime <runtime_id>`.
- Approval and deny patterns for risky requests.
- FileStore persistence for sessions, messages, events, approvals, runs, artifacts, and audit logs.
- MCP server and Admin API hooks for external tools and future dashboards.

---

## Quick Start

OpenTag requires Node.js `>=20.11.0`.

```bash
npm install
npm run check
npm test
npm run smoke
```

Run locally without Slack:

```bash
npm run start:console
```

Run a one-shot mock runtime:

```bash
npm run run:mock
```

Run the Slack gateway with the example config:

```bash
cp examples/env.example .env
set -a
source .env
set +a
npm run doctor
npm start
```

For real Slack testing, create a Slack app from `examples/slack-app-manifest.yaml` and provide:

```bash
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

---

## Use From Slack

```text
@OpenTag summarize the failing tests in this repo
/runtime codex-readonly explain the current project structure
/runtime codex-workspace-write fix this bug, but propose the plan before editing
/opentag help
/opentag runtimes
/opentag sessions
/opentag approvals
/opentag status <session_id>
/opentag cancel <session_id>
```

---

## Architecture

```text
Slack Socket Mode / HTTP Events / slash command / thread reply / DM
        |
        v
Slack Gateway
  - event filtering
  - event dedupe
  - thread hydration
  - approval actions
        |
        v
OpenTag Engine
  - session queue
  - policy checks
  - approval lifecycle
  - runtime lifecycle
        |
        v
Context Builder
  - channel instructions
  - channel memory
  - recent thread context
  - runtime contract
        |
        v
Runtime Adapter Layer
  - mock / claude-code / codex / opencode
  - generic-cli / docker / http
        |
        v
Sandbox Manager + FileStore
        |
        v
Slack replies + audit + runs + artifacts + MCP + Admin API
```

Design boundaries:

- Gateways stay separate from runtime adapters.
- Slack-specific behavior stays inside Slack gateway and Slack utility modules.
- Runtime execution stays inside runtime adapters.
- Policy decisions stay inside the policy engine.
- Persistence stays inside storage and memory modules.
- The channel-native model remains the source of session scope, context, permissions, and auditability.

---

## Repository Layout

```text
bin/                 CLI entrypoints
src/                 Core engine, gateways, runtimes, storage, policy, MCP, Admin API
test/                Node test suite
examples/            Example Slack manifest, env, and OpenTag config
docs/user-guide/     User-facing setup and operations guide
scripts/             Local checks and smoke scripts
README.md            English project overview
README.zh-CN.md      Chinese project overview
```

Useful docs:

- [`docs/user-guide/README.md`](docs/user-guide/README.md) - user guide
- [`examples/env.example`](examples/env.example) - environment variables
- [`examples/opentag.config.example.json`](examples/opentag.config.example.json) - example runtime and channel config
- [`examples/slack-app-manifest.yaml`](examples/slack-app-manifest.yaml) - Slack app manifest
- [`SECURITY.md`](SECURITY.md) - security policy
- [`CONTRIBUTING.md`](CONTRIBUTING.md) - contribution guide

---

## Development Commands

```bash
npm install
npm run check
npm test
npm run smoke
npm run start:console
```

Useful scripts:

| Command | Purpose |
| --- | --- |
| `npm run check` | Repository sanity checks |
| `npm test` | Node test suite |
| `npm run smoke` | Mock runtime smoke test |
| `npm run run:mock` | One-shot mock runtime execution |
| `npm run doctor` | Configuration and environment checks |
| `npm run start:console` | Local console gateway, no Slack required |
| `npm start` | Slack gateway with the example config |
| `npm run mcp` | MCP stdio server |
| `npm run start:admin` | Local Admin API |
| `npm run test:v01` | v0.1 CLI smoke test |

---

## Runtime Configuration

The default example config is:

```text
examples/opentag.config.example.json
```

Use Claude Code in read-only mode:

```json
{
  "defaultRuntime": "claude-code-readonly",
  "allowedRuntimes": ["mock", "claude-code-readonly"]
}
```

Use Codex with workspace-write access and approval:

```json
{
  "defaultRuntime": "codex-workspace-write",
  "policy": {
    "requireApprovalForWriteAccess": true
  }
}
```

Add an internal CLI agent:

```json
{
  "my-agent": {
    "type": "generic-cli",
    "command": "node",
    "args": ["./agent.js"],
    "promptMode": "stdin",
    "outputMode": "jsonl",
    "requiresApproval": true
  }
}
```

Add an isolated Docker runtime:

```json
{
  "docker-node-readonly": {
    "type": "docker",
    "image": "node:22-alpine",
    "args": ["node", "-e", "process.stdin.pipe(process.stdout)"],
    "readOnly": true,
    "network": "none"
  }
}
```

Add an HTTP agent:

```json
{
  "hermes-http": {
    "type": "http",
    "endpoint": "http://localhost:8788/v1/agent/run",
    "headers": {
      "authorization": "Bearer ${env:HERMES_API_KEY}"
    },
    "requiresApproval": true
  }
}
```

---

## Runtime Event Format

Runtime adapters can return plain text or JSONL events:

```jsonl
{"type":"started","message":"planning"}
{"type":"token","text":"hello"}
{"type":"tool_call","name":"read_file","argumentsText":"README.md"}
{"type":"approval_request","reason":"Need to write files","risks":["write"]}
{"type":"artifact","path":"/workspace/report.md"}
{"type":"completed","output":"done"}
```

---

## Admin API

Start the local Admin API:

```bash
OPENTAG_ADMIN_TOKEN=change-me npm run start:admin
curl -H "Authorization: Bearer change-me" http://127.0.0.1:8787/healthz
```

Endpoints:

```text
GET  /healthz
GET  /v1/runtimes
GET  /v1/sessions
GET  /v1/sessions/:id
GET  /v1/sessions/:id/messages
POST /v1/sessions/:id/cancel
GET  /v1/audit
GET  /v1/approvals
GET  /v1/runs
GET  /v1/artifacts
POST /v1/run
```

---

## MCP Server

Start the MCP stdio server:

```bash
npm run mcp
```

Current tools:

- `opentag.list_sessions`
- `opentag.get_thread_context`
- `opentag.append_audit`
- `opentag.request_approval`
- `opentag.post_slack_reply`, disabled by default and still approval-capable when enabled

Typical use: external agents can read OpenTag thread context, write audit records, request approvals, or post back to Slack through governed tools.

---

## Security Model

OpenTag is designed to make risky agent behavior visible and controllable.

- Secrets are injected through environment variables and example files, not committed.
- Channel configuration controls runtime allowlists, allowed users, approvers, workspace roots, and instructions.
- Write-capable runtimes can require approval before execution.
- Dangerous prompt patterns can be denied before reaching a runtime.
- Static working directories must remain inside configured allowed roots.
- Docker runtime examples default toward no-network and read-only execution.
- Runtime outputs, approvals, artifacts, and audit records are persisted for review.

See [`SECURITY.md`](SECURITY.md) for security reporting and implementation-facing guidance.

---

## Current Status

OpenTag is an Enhanced MVP v0.2.0. It is useful for local development, Slack-first experimentation, runtime adapter work, policy design, and architecture validation.

It is not yet a production SaaS. The main gaps are Slack OAuth multi-workspace installation, durable multi-instance storage, queue workers, hardened container isolation, Admin Web UI, and a unified runtime resume protocol.

---

## Roadmap

Near-term priorities:

1. Slack OAuth installation and workspace-level token storage.
2. Postgres / Redis storage and multi-instance session queues.
3. Docker sandbox hardening with resource limits, seccomp / AppArmor profiles, and network policy.
4. Admin Web UI for sessions, approvals, runs, artifacts, and audit logs.
5. Runtime resume protocol across Codex, Claude Code, OpenCode, and generic adapters.
6. Additional channel adapters such as Teams, Discord, Telegram, Feishu, and WeCom.

---

## License

Apache-2.0. See [`LICENSE`](LICENSE).
