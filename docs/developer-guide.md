# OpenTag Developer Guide

This document contains implementation-oriented details for contributors, integrators, and operators. The main [`README.md`](../README.md) is intentionally user-facing.

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
  - Task v1 normalization
  - TaskRouter runtime selection
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
  - RuntimeEvent v1 normalization
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

Route by fallback, static health, cost, and tools:

```json
{
  "defaultRuntime": "codex-readonly",
  "runtimeFallbacks": ["codex-workspace-write"],
  "routing": {
    "maxEstimatedCostUsd": 0.25,
    "preferLowestCost": false
  }
}
```

Runtime specs can advertise conservative metadata:

```json
{
  "codex-workspace-write": {
    "type": "codex",
    "capabilities": { "tools": ["shell", "file_write", "network"] },
    "cost": { "estimatedUsd": 0.15 },
    "health": { "status": "available" }
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

## Runtime Event Format

Runtime adapters emit an async event stream that OpenTag normalizes to `opentag.runtime_event.v1`. Adapters can return legacy text-like events or JSONL events:

```jsonl
{"type":"started","message":"planning"}
{"type":"text_delta","delta":"reading files"}
{"type":"token","text":"hello"}
{"type":"tool_call","name":"read_file","argumentsText":"README.md"}
{"type":"approval_request","reason":"Need to write files","risks":["write"]}
{"type":"artifact","path":"/workspace/report.md"}
{"type":"completed","output":"done"}
```

The engine currently handles `started`, `token`, `log`, `tool_call`, `tool_result`, `approval_request`, `artifact`, `usage`, `plan_update`, `completed`, and `failed`. Unknown adapter events are kept as redacted logs.

Runtime events are persisted under the configured data directory and can be read with:

```bash
opentag runtime-events --config ./examples/opentag.config.example.json <run_id>
```

Patch and diff outputs are also indexed as local pull request candidates:

```bash
opentag pr-candidates --config ./examples/opentag.config.example.json --run <run_id>
```

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
GET  /v1/runs/:run_id/events
GET  /v1/artifacts
GET  /v1/pr-candidates
POST /v1/run
```

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

## Test Coverage

```bash
npm run check
npm test
```

The current suite covers:

- Engine session lifecycle, approvals, slash commands, and runtime override.
- Policy allow, deny, approval, blocked users, self approval, cwd roots, and tool-call policy.
- Runtime run metadata and sandbox artifact collection.
- Slack message normalization, bot filtering, link cleaning, and file metadata.
- Generic CLI text, JSONL, and stdin prompt modes.
- FileStore sessions, messages, approvals, event dedupe, runs, and artifacts.
- MCP initialize, tools/list, and thread context.
- Admin API health, sessions, runs, and artifacts.

For runtime or CLI changes, also run:

```bash
npm run smoke
npm run test:v01
```
