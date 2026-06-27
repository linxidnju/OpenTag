# OpenTag Enhanced MVP Release Notes

本次增强的目标是把 OpenTag 从“能跑通 Slack -> Runtime -> thread reply”的原型，升级成一个更完整的 Claude Tag-like MVP。

## 新增/加固能力

### 1. Slack Gateway

- Socket Mode / HTTP Mode 统一通过 Slack Bolt 启动。
- `app_mention` 创建 session。
- thread reply 继续已有 session。
- DM / MPIM 消息可作为 personal session 入口。
- event dedupe，避免 Slack retry 造成重复执行。
- thread hydration，运行前读取 Slack thread 历史消息。
- slash command 委托给 OpenTag Engine。
- approval buttons 支持 approve / deny / cancel session。
- bot/self/system message 过滤，避免自触发循环。
- Slack API retry，对 rate limit / transient failure 做有限重试。

### 2. Engine

- 每个 session 使用串行队列。
- unknown runtime override 不创建 session。
- `/runtime <runtime-id> <request>` 支持单次 runtime override。
- thread 内 `/opentag status/context/runtimes/sessions/approvals/audit/cancel`。
- slash command 支持 sessions / runtimes / approvals / audit / status / cancel。
- approval approved 后自动 resume runtime。
- runtime `approval_request` 会把 session 切到 `waiting_approval`。
- runtime run 写入 runs store。
- runtime 完成/失败后收集 artifacts 并写审计。

### 3. Policy

- `allowedUsers` / `blockedUsers`。
- `allowedRuntimes`。
- deny patterns。
- approval patterns。
- runtime write-access approval。
- `allowSelfApproval=false`。
- static cwd / workspaceRoot / allowedRoots 校验。
- tool-call policy：`allowTools`、`denyTools`、`requireApprovalTools`、tool argument deny/approval pattern。

### 4. Context

- channel instructions。
- memory channel notes。
- hydrated Slack thread context。
- stored OpenTag thread context。
- Slack file metadata。
- prompt max length。
- secret redaction。

### 5. Runtime

- `mock`。
- Claude Code stream-json。
- Codex exec JSONL。
- OpenCode run。
- `generic-cli` text / JSONL / stdin。
- `docker` runtime。
- `http` runtime for Hermes / OpenClaw / custom agent。
- Runtime events: token, log, tool_call, approval_request, artifact, completed, failed。

### 6. Store

- sessions。
- messages with messageId dedupe。
- incoming events dedupe。
- approvals。
- runs。
- artifacts。
- audit.ndjson。

### 7. Sandbox / Artifacts

- per-run sandbox directory。
- `opentag-run.json` manifest。
- artifact collector。
- `cleanupOnComplete` / retention cleanup。
- workspaceRoot must exist if configured。
- cwd/allowedRoots policy check。

### 8. MCP / Admin

- MCP stdio server。
- OpenTag tools: list sessions, get thread context, append audit, request approval, optional Slack reply。
- Admin API: healthz, sessions, session detail, audit, approvals, runs, artifacts, cancel session。
- Admin API 默认绑定 `127.0.0.1`，支持 bearer token。

## Verification

```bash
npm test
npm run check
find src test scripts bin -name '*.js' -print0 | xargs -0 -n1 node --check
node ./bin/opentag.js run --config examples/opentag.config.example.json --runtime mock --prompt "hello enhanced OpenTag"
```

Current local result:

```text
30 tests passed
syntax check passed
repo check passed
mock smoke run passed
```

## Current MVP boundary

- FileStore 适合单机 MVP；生产多实例建议换 Postgres + Redis/Temporal。
- Runtime 仍以一次性 CLI/HTTP 调用为主；真正 live steering 需要 Runtime 自身支持 resume/session。
- Docker runtime 已可用，但还不是完整容器池；生产建议加 seccomp、只读 mount、资源限制和网络策略。
- MCP 默认禁止直接发 Slack，避免 tool 被 prompt injection 滥用。
- Artifact 目前默认记录本地文件 metadata；Slack 文件上传建议使用 Slack 新的 external upload 流程或接 S3/R2，不建议接旧 `files.upload`。

## Recommended next step

- Postgres store adapter。
- Redis/Temporal queue。
- stricter Docker sandbox with CPU/memory/process limits。
- OAuth installation flow for multi-workspace SaaS。
- per-tool approval proxy。
- artifact upload to Slack / S3 / R2。
