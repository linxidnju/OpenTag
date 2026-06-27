# OpenTag

> Open-source, channel-native agent gateway inspired by Claude Tag. Slack-first today; Teams / Discord and more agent runtimes later.

OpenTag 让团队可以在 Slack 频道、thread 或 DM 里直接 `@OpenTag` / 使用 `/opentag`，把任务安全地路由到 Claude Code、Codex、OpenCode、Docker 沙盒、HTTP Agent 或自研 CLI Agent。它重点解决三件事：

1. **把 Agent 接进协作工具**：Slack 里的 mention、thread、DM、slash command 都能变成可追踪的 agent session。
2. **把不同 Agent Runtime 抽象成统一接口**：Claude Code、Codex、OpenCode、Hermes Agent、OpenClaw、自研 CLI / HTTP Agent 都可以挂进来。
3. **把安全、审批、审计做成默认能力**：频道级权限、runtime 白名单、write approval、审计日志、artifact 收集、Admin API、MCP tool 都在 MVP 骨架里。

当前版本是 **Enhanced MVP v0.2.0**。它不是一次性 demo，而是一个可以继续工程化演进的最小完整产品骨架。

---

## 目录

- [OpenTag 是什么](#opentag-是什么)
- [架构概览](#架构概览)
- [已实现能力](#已实现能力)
- [快速开始](#快速开始)
- [接入 Slack](#接入-slack)
- [配置 Runtime](#配置-runtime)
- [CLI 用法](#cli-用法)
- [Admin API](#admin-api)
- [MCP Server](#mcp-server)
- [安全默认值](#安全默认值)
- [测试](#测试)
- [代码结构](#代码结构)
- [当前边界与下一步](#当前边界与下一步)

---

## OpenTag 是什么

OpenTag 的定位是：**把协作软件里的消息线程变成 Agent 的工作入口**。

你可以把它理解为一个 Slack-native 的 Agent Gateway：

```text
人 / 团队
  ↓
Slack channel / thread / DM / slash command
  ↓
OpenTag Gateway
  ↓
Session + Context + Policy + Approval
  ↓
Runtime Adapter
  ↓
Claude Code / Codex / OpenCode / Docker / HTTP Agent / Generic CLI
  ↓
Slack thread response + audit + artifacts + admin APIs
```

与直接在本地跑 agent 不同，OpenTag 更关注团队协作场景：

- 每个 Slack thread 对应一个可持续上下文的 session。
- 不同 channel 可以配置不同 workspace、runtime、权限和记忆。
- 写文件、部署、删除等高风险操作可以自动进入审批流。
- 所有输入、输出、审批、运行记录和 artifact 都可以审计。
- 未来可以扩展到 Teams、Discord、飞书、企业微信等协作平台。

---

## 架构概览

```text
Slack Socket Mode / HTTP Events / slash command / thread reply / DM
        ↓
Slack Gateway
  - event filter
  - event dedupe
  - thread hydration
  - approval actions
        ↓
OpenTag Engine
  - session queue
  - policy check
  - approval lifecycle
  - runtime lifecycle
        ↓
Context Builder
  - channel instructions
  - channel memory
  - recent thread context
  - runtime contract
        ↓
Runtime Adapter Layer
  - mock
  - claude-code
  - codex
  - opencode
  - generic-cli
  - docker
  - http
        ↓
Sandbox Manager + FileStore
        ↓
Slack replies + audit + runs + artifacts + MCP + Admin API
```

核心设计原则：

- **Channel-native**：Slack 不是简单通知层，而是 session、上下文、权限和审批入口。
- **Runtime-agnostic**：Agent runtime 可以替换，不把系统绑定到某一个 CLI 或模型。
- **Safety-first**：写操作、危险命令和敏感工具默认可被拦截或审批。
- **Auditable by default**：session、message、approval、event、run、artifact 都落盘。
- **Local-first MVP**：优先支持本地开发、Socket Mode 和文件存储，后续再演进到多租户 SaaS。

---

## 已实现能力

### 1. Slack Gateway

- 支持 Slack **Socket Mode**，本地开发不需要公网 Request URL。
- 支持 Slack **HTTP Events API**，适合线上 Webhook 部署。
- 支持 `app_mention` 创建或继续 thread session。
- 支持普通 Slack thread reply 继续已有 session，不会让普通频道消息误触发新任务。
- 支持 Slack DM / MPIM 消息创建个人 session。
- 支持 `/opentag` slash command：`help`、`sessions`、`approvals`、`runtimes`、`status`、`cancel`。
- 支持 Slack approval buttons：Approve once / Deny / Cancel session。
- 支持 thread context hydration：通过 `conversations.replies` 拉取 thread 上下文。
- 支持 event dedupe：基于 Slack `event_id` / `client_msg_id` / channel+ts 去重。
- 支持 bot / self / system / edited / deleted message 过滤，避免自循环。
- 支持 Slack link、channel mention、broadcast mention 清洗。
- 支持 Slack 长消息 chunking，默认按 3500 字以内分块发送。

### 2. Session / Context / Policy

- `platform + workspaceId + channelId + threadId` 映射一个 OpenTag session。
- 每个 session 串行执行 turn，避免同一个 thread 内并发写乱。
- 支持 runtime override：在 prompt 里使用 `/runtime <runtime_id>`。
- 支持频道级配置：`defaultRuntime`、`allowedRuntimes`、`allowedUsers`、`blockedUsers`、`approvers`、`allowedRoots`、`workspaceRoot`、`instructions`、`memory`。
- 支持全局 deny patterns 和 approval patterns。
- 支持 write-capable runtime 自动要求 approval。
- 支持 static `cwd` / workspace root allowed-roots 校验。
- 支持 self-approval 开关。
- Context Builder 会生成结构化 prompt，包含 channel scope、runtime contract、thread history 和当前请求。

### 3. Runtime Adapter

已内置 runtime adapter：

| Runtime | 用途 |
| --- | --- |
| `mock` | 本地 smoke test 和单元测试 |
| `claude-code` | 调用 `claude -p` / stream-json 输出 |
| `codex` | 调用 `codex exec` 非交互模式 |
| `opencode` | 调用 `opencode run` |
| `generic-cli` | 适配 Hermes Agent、OpenClaw、Python/Node 自研 Agent 等 CLI |
| `docker` | 用 Docker 隔离运行只读或可写 runtime |
| `http` | 适配远程 Agent Server |

Runtime 可以输出普通文本，也可以输出 JSONL 事件：

```jsonl
{"type":"started","message":"planning"}
{"type":"token","text":"hello"}
{"type":"tool_call","name":"read_file","argumentsText":"README.md"}
{"type":"approval_request","reason":"Need to write files","risks":["write"]}
{"type":"artifact","path":"/workspace/report.md"}
{"type":"completed","output":"done"}
```

### 4. Storage / Audit / Artifacts

- FileStore 持久化 `sessions`、`messages`、`approvals`、`events`、`runs`、`artifacts`、`audit.ndjson`。
- `appendMessage` 支持 message-level dedupe。
- `markEventSeen` / `recordIncomingEvent` 支持事件幂等。
- Runtime run 和 artifact 可通过 CLI / Admin API 查询，方便后续做 UI / dashboard。

---

## 快速开始

### 环境要求

- Node.js `>= 20.11.0`
- npm
- 如果要接真实 Slack，需要 Slack App、Bot Token、App-Level Token 和 Signing Secret
- 如果要使用具体 runtime，需要本机已安装对应 CLI：`claude` / `codex` / `opencode` / Docker 等

### 安装与本地检查

```bash
cd Code/OpenTag
npm install
npm run check
npm test
npm run smoke
```

### Console 模式

Console 模式不需要 Slack，适合先验证 engine、runtime 和 policy：

```bash
npm run start:console
```

也可以直接跑一次 mock runtime：

```bash
npm run run:mock
```

### Slack Socket Mode

```bash
cp examples/env.example .env
set -a
source .env
set +a
npm run doctor
npm start
```

默认 `npm start` 使用：

```text
examples/opentag.config.example.json
```

---

## 接入 Slack

详细步骤见：[`docs/14-slack-setup.md`](docs/14-slack-setup.md)

也可以直接导入示例 manifest：

```text
examples/slack-app-manifest.yaml
```

最小 Bot Token Scopes：

```text
app_mentions:read
channels:history
groups:history
im:history
mpim:history
chat:write
commands
```

Socket Mode 需要：

```bash
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

其中 App-Level Token 需要 `connections:write` scope。

HTTP 模式需要把 Slack 后台 URL 配到：

```text
Event Request URL:  POST /slack/events
Interactivity URL:  POST /slack/interactions
Slash Command URL: POST /slack/commands
```

本地开发推荐 Socket Mode；部署到公网服务时再切 HTTP Events API。

---

## 配置 Runtime

默认示例配置在：

```text
examples/opentag.config.example.json
```

### 切 Claude Code readonly

```json
{
  "defaultRuntime": "claude-code-readonly",
  "allowedRuntimes": ["mock", "claude-code-readonly"]
}
```

### 切 Codex workspace-write

建议保留 approval：

```json
{
  "defaultRuntime": "codex-workspace-write",
  "policy": {
    "requireApprovalForWriteAccess": true
  }
}
```

### 接自研 CLI Agent

适合 Hermes Agent、OpenClaw、Python / Node 自研 Agent：

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

### 接 Docker 隔离 runtime

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

### 接 HTTP Agent

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

## CLI 用法

项目通过 `bin/opentag.js` 暴露 CLI。常用命令：

```bash
# 启动 Slack gateway
npm start

# 启动 console gateway
npm run start:console

# 检查配置、环境变量和 runtime 可用性
npm run doctor

# 直接运行一次 mock runtime
npm run run:mock

# 启动 MCP stdio server
npm run mcp

# 启动本地 Admin API
OPENTAG_ADMIN_TOKEN=change-me npm run start:admin
```

在 Slack 里常用：

```text
@OpenTag 帮我看一下这个 repo 的测试为什么失败
/runtime codex-readonly 总结当前代码结构
/runtime codex-workspace-write 修复这个 bug，但修改前先说明计划
/opentag help
/opentag runtimes
/opentag sessions
/opentag approvals
/opentag status <session_id>
/opentag cancel <session_id>
```

---

## Admin API

启动本地 Admin API：

```bash
OPENTAG_ADMIN_TOKEN=change-me npm run start:admin
curl -H "Authorization: Bearer change-me" http://127.0.0.1:8787/healthz
```

Endpoints：

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

Admin API 适合后续接一个 Web Dashboard，用来查看 sessions、runs、approvals、artifacts 和 audit。

---

## MCP Server

OpenTag 内置 MCP stdio server：

```bash
npm run mcp
```

当前 tools：

- `opentag.list_sessions`
- `opentag.get_thread_context`
- `opentag.append_audit`
- `opentag.request_approval`
- `opentag.post_slack_reply`，默认关闭，开启后仍可要求 approval。

典型用途：让外部 agent 通过 MCP 读取 OpenTag thread context、写 audit、发起 approval 或回帖到 Slack。

---

## 安全默认值

- Slack token / signing secret 通过 env 注入，不写入代码。
- Socket Mode 与 HTTP 模式均通过 Slack Bolt 接入。
- 普通频道消息不会创建新 session，必须 `@OpenTag`；thread reply 只继续已有 session。
- 高风险 prompt 默认触发 approval：deploy、production、delete、drop table、push 等。
- 明显破坏性 prompt 默认 deny：`rm -rf /`、`mkfs`、`dd if=`、`drop database` 等。
- Write-capable runtime 默认要求 approval。
- Static cwd 必须在 channel `allowedRoots` 内。
- MCP Slack posting 默认关闭；开启后也可强制要求 approval。
- Docker runtime 示例默认 no-network、readonly mount。
- Runtime 输出、审批、artifact 和 audit 都会落盘，方便追溯。

---

## 测试

```bash
npm run check
npm test
```

当前覆盖：

- Engine session lifecycle / approval / slash command / runtime override。
- Policy allow / deny / approval / blocked user / self approval / cwd roots / tool-call policy。
- Runtime run metadata 和 sandbox artifact collection。
- Slack message normalization / bot filtering / link cleaning / files metadata。
- Generic CLI text / JSONL / stdin prompt。
- FileStore sessions / messages / approvals / event dedupe / runs / artifacts。
- MCP initialize / tools/list / get_thread_context。
- Admin API health / sessions / runs / artifacts。

---

## 代码结构

```text
bin/opentag.js
src/
  admin/AdminServer.js
  config/loadConfig.js
  core/
    OpenTagEngine.js
    PolicyEngine.js
    RuntimeRegistry.js
    SessionManager.js
    ContextBuilder.js
  gateways/
    slack/
    console/
  mcp/
    McpServerCore.js
    McpStdioServer.js
  runtimes/
    ClaudeCodeAdapter.js
    CodexAdapter.js
    OpenCodeAdapter.js
    GenericCliRuntimeAdapter.js
    DockerRuntimeAdapter.js
    HttpRuntimeAdapter.js
    MockRuntimeAdapter.js
  sandbox/SandboxManager.js
  storage/FileStore.js
  tools/ToolRegistry.js
  utils/
test/
examples/
docs/
```

---

## 当前边界与下一步

这已经是更完整的 MVP，但还不是生产级 SaaS。

当前边界：

- 还没有 Slack OAuth 多租户安装流。
- 还没有 Postgres / Redis / queue worker 的多实例部署方案。
- Docker sandbox 还不是容器池，也没有 seccomp / AppArmor profile 模板。
- Runtime 的 live steering 取决于底层 agent 是否支持 resume / interactive session。
- MCP tool approval 目前是工具级和事件级骨架，还不是完整 syscall / tool proxy。
- Admin API 还没有配套 Web UI。

建议下一阶段优先做：

1. **Slack OAuth 安装流**：支持多 workspace 安装、token 存储和 workspace 配置。
2. **Postgres / Redis 化**：把 FileStore、session queue、approval 状态迁到可多实例部署的存储。
3. **Docker sandbox hardening**：容器池、资源限制、seccomp / AppArmor、网络策略、artifact 上传。
4. **Admin Web UI**：查看 sessions、runs、approvals、artifacts、audit，并支持人工审批。
5. **Runtime resume 协议**：统一 Codex / Claude Code / OpenCode 等 runtime 的继续会话能力。
6. **更多 channel adapter**：Teams、Discord、飞书、企业微信。

---

## License

Apache-2.0
