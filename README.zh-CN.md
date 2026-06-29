# OpenTag：面向团队频道的 Agent Gateway

> OpenTag 是一个开源、channel-native 的团队 Agent 网关。它把 Slack channel、thread、DM 和 slash command 变成可审计的 Agent session，并把任务安全路由到 Claude Code、Codex、OpenCode、Docker 沙盒、HTTP Agent 或通用 CLI Agent。

[English](README.md) · [简体中文](README.zh-CN.md) · [用户指南](docs/user-guide/README.md) · [安全](SECURITY.md) · [贡献指南](CONTRIBUTING.md)

---

## OpenTag 是什么

OpenTag 不是又一个聊天机器人，而是一个给团队协作频道使用的共享 Agent Gateway。

团队可以在 Slack 里 `@OpenTag`，在同一个 thread 中持续补充上下文，把任务交给指定 runtime，在高风险操作前要求审批，并保留消息、运行、审批、artifact 和审计日志。

```text
Slack 里的团队
  -> channel / thread / DM / slash command
  -> OpenTag Gateway
  -> session + context + policy + approval
  -> runtime adapter
  -> Claude Code / Codex / OpenCode / Docker / HTTP / generic CLI
  -> thread reply + audit + artifacts + admin APIs
```

当前实现是 Slack-first 的 Node.js MVP。架构上坚持 channel-native 和 runtime-agnostic，后续可以扩展到更多协作平台和 Agent runtime，而不会把核心引擎绑定到 Slack 或某一个模型厂商。

---

## 为什么需要 OpenTag

Agent CLI 很强，但团队任务通常开始于共享频道，而不是某个人的终端。OpenTag 解决的就是这个断点。

- **Channel-native**：channel、thread、workspace 和 user identity 决定 session 范围、权限、上下文和审计。
- **Runtime-agnostic**：Claude Code、Codex、OpenCode、Docker、HTTP Agent、自研 CLI 都通过统一 adapter contract 接入。
- **安全优先**：写权限 runtime、危险 prompt、文件根目录和 Slack 回帖都可以由 policy 与 approval 控制。
- **默认可审计**：session、message、event、approval、run、artifact、audit record 都会持久化。
- **Local-first MVP**：Socket Mode、文件存储、mock runtime、console gateway 和确定性测试，方便本地验证。

---

## 产品能力

### Slack Gateway

- `@OpenTag` 从 Slack channel 创建或继续 Agent session。
- thread reply 会继续已有 session，不会把普通频道消息误触发成任务。
- 支持 DM / MPIM 创建个人 session。
- `/opentag` 支持 `help`、`sessions`、`approvals`、`runtimes`、`status`、`cancel` 等运维命令。
- Slack approval buttons 支持 approve、deny、cancel。

### Runtime Adapter

| Runtime | 用途 |
| --- | --- |
| `mock` | 本地测试和 smoke run |
| `claude-code` | Claude Code CLI |
| `codex` | Codex CLI 非交互执行 |
| `opencode` | OpenCode CLI |
| `generic-cli` | Hermes Agent、OpenClaw 或自研 CLI |
| `docker` | 容器隔离 runtime |
| `http` | 远程 Agent Server |

### Policy、Memory 与 Audit

- channel 级 runtime allowlist、user allowlist、approvers、instructions、memory、workspace roots、allowed roots。
- prompt 内可用 `/runtime <runtime_id>` 切换 runtime。
- 高风险请求可触发 approval 或 deny。
- FileStore 持久化 sessions、messages、events、approvals、runs、artifacts、audit logs。
- 内置 MCP server 与 Admin API，便于外部工具和未来 dashboard 接入。

---

## 快速开始

OpenTag 要求 Node.js `>=20.11.0`。

```bash
npm install
npm run check
npm test
npm run smoke
```

不接 Slack，本地 console 模式运行：

```bash
npm run start:console
```

执行一次 mock runtime：

```bash
npm run run:mock
```

使用示例配置启动 Slack gateway：

```bash
cp examples/env.example .env
set -a
source .env
set +a
npm run doctor
npm start
```

真实 Slack 测试需要基于 `examples/slack-app-manifest.yaml` 创建 Slack App，并提供：

```bash
SLACK_APP_TOKEN=xapp-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

---

## Slack 使用示例

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

## 架构

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

架构边界：

- Gateway 与 runtime adapter 分离。
- Slack 专属逻辑保留在 Slack gateway 和 Slack 工具模块内。
- Runtime 执行行为保留在 runtime adapters 内。
- Policy 决策保留在 policy engine 内。
- 持久化行为保留在 storage 和 memory 模块内。
- Channel-native 模型继续作为 session scope、context、permission 和 auditability 的来源。

---

## 仓库结构

```text
bin/                 CLI 入口
src/                 Core engine、gateway、runtime、storage、policy、MCP、Admin API
test/                Node 测试套件
examples/            Slack manifest、env、OpenTag config 示例
docs/user-guide/     用户安装与运维指南
scripts/             本地检查和 smoke 脚本
README.md            英文项目主页
README.zh-CN.md      中文项目主页
```

常用文档：

- [`docs/user-guide/README.md`](docs/user-guide/README.md) - 用户指南
- [`examples/env.example`](examples/env.example) - 环境变量示例
- [`examples/opentag.config.example.json`](examples/opentag.config.example.json) - runtime 与 channel 配置示例
- [`examples/slack-app-manifest.yaml`](examples/slack-app-manifest.yaml) - Slack App manifest
- [`SECURITY.md`](SECURITY.md) - 安全说明
- [`CONTRIBUTING.md`](CONTRIBUTING.md) - 贡献指南

---

## 开发命令

```bash
npm install
npm run check
npm test
npm run smoke
npm run start:console
```

常用脚本：

| Command | 用途 |
| --- | --- |
| `npm run check` | 仓库 sanity check |
| `npm test` | Node 测试套件 |
| `npm run smoke` | mock runtime smoke test |
| `npm run run:mock` | 执行一次 mock runtime |
| `npm run doctor` | 配置和环境检查 |
| `npm run start:console` | 本地 console gateway，无需 Slack |
| `npm start` | 使用示例配置启动 Slack gateway |
| `npm run mcp` | MCP stdio server |
| `npm run start:admin` | 本地 Admin API |
| `npm run test:v01` | v0.1 CLI smoke test |

---

## Runtime 配置

默认示例配置在：

```text
examples/opentag.config.example.json
```

切到 Claude Code read-only：

```json
{
  "defaultRuntime": "claude-code-readonly",
  "allowedRuntimes": ["mock", "claude-code-readonly"]
}
```

切到 Codex workspace-write，并保留 approval：

```json
{
  "defaultRuntime": "codex-workspace-write",
  "policy": {
    "requireApprovalForWriteAccess": true
  }
}
```

接入自研 CLI Agent：

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

接入 Docker 隔离 runtime：

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

接入 HTTP Agent：

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

## Runtime Event 格式

Runtime adapter 可以返回普通文本，也可以返回 JSONL events：

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

---

## MCP Server

启动 MCP stdio server：

```bash
npm run mcp
```

当前 tools：

- `opentag.list_sessions`
- `opentag.get_thread_context`
- `opentag.append_audit`
- `opentag.request_approval`
- `opentag.post_slack_reply`，默认关闭，开启后仍可要求 approval

典型用途：外部 agent 可以通过受控工具读取 OpenTag thread context、写 audit、发起 approval 或回帖到 Slack。

---

## 安全模型

OpenTag 的目标是让高风险 Agent 行为可见、可控、可追溯。

- secret 通过环境变量和示例文件注入，不提交真实凭据。
- channel 配置控制 runtime allowlist、allowed users、approvers、workspace roots 和 instructions。
- write-capable runtime 可以要求执行前审批。
- 危险 prompt pattern 可以在进入 runtime 前被 deny。
- static working directory 必须位于配置的 allowed roots 内。
- Docker runtime 示例默认倾向 no-network 和 read-only。
- runtime 输出、审批、artifact 和 audit record 会持久化，方便复盘。

更多见 [`SECURITY.md`](SECURITY.md)。

---

## 当前状态

OpenTag 当前是 Enhanced MVP v0.2.0，适合本地开发、Slack-first 实验、runtime adapter 开发、policy 设计和架构验证。

它还不是生产级 SaaS。主要缺口包括 Slack OAuth 多 workspace 安装、可多实例部署的持久化存储、queue worker、容器隔离加固、Admin Web UI，以及统一 runtime resume 协议。

---

## 路线图

近期优先级：

1. Slack OAuth 安装流与 workspace 级 token 存储。
2. Postgres / Redis 存储与多实例 session queue。
3. Docker sandbox hardening：资源限制、seccomp / AppArmor、网络策略。
4. Admin Web UI：sessions、approvals、runs、artifacts、audit logs。
5. Codex、Claude Code、OpenCode 和 generic adapters 的统一 runtime resume 协议。
6. Teams、Discord、Telegram、飞书、企业微信等更多 channel adapters。

---

## License

Apache-2.0. See [`LICENSE`](LICENSE).
