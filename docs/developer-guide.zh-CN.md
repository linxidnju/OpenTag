# OpenTag 开发者指南

本文档放置面向贡献者、集成者和运维者的实现细节。主 [`README.zh-CN.md`](../README.zh-CN.md) 刻意保持面向普通使用者。

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

架构边界：

- Gateway 与 runtime adapter 分离。
- Slack 专属逻辑保留在 Slack gateway 和 Slack 工具模块内。
- Runtime 执行行为保留在 runtime adapters 内。
- Policy 决策保留在 policy engine 内。
- 持久化行为保留在 storage 和 memory 模块内。
- Channel-native 模型继续作为 session scope、context、permission 和 auditability 的来源。

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

按 fallback、静态健康状态、成本和工具能力做路由：

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

Runtime spec 可以声明保守元数据：

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

## Runtime Event 格式

Runtime adapter 会输出异步事件流，OpenTag 会将其规范化为 `opentag.runtime_event.v1`。Adapter 可以返回旧的文本事件，也可以返回 JSONL events：

```jsonl
{"type":"started","message":"planning"}
{"type":"text_delta","delta":"reading files"}
{"type":"token","text":"hello"}
{"type":"tool_call","name":"read_file","argumentsText":"README.md"}
{"type":"approval_request","reason":"Need to write files","risks":["write"]}
{"type":"artifact","path":"/workspace/report.md"}
{"type":"completed","output":"done"}
```

当前 engine 处理 `started`、`token`、`log`、`tool_call`、`tool_result`、`approval_request`、`artifact`、`usage`、`plan_update`、`completed` 和 `failed`。未知 adapter event 会作为脱敏日志保留。

Runtime events 会持久化到配置的数据目录，可以这样读取：

```bash
opentag runtime-events --config ./examples/opentag.config.example.json <run_id>
```

Patch 和 diff 输出也会被索引成本地 pull request candidates：

```bash
opentag pr-candidates --config ./examples/opentag.config.example.json --run <run_id>
```

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
GET  /v1/runs/:run_id/events
GET  /v1/artifacts
GET  /v1/pr-candidates
POST /v1/run
```

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

## 测试覆盖

```bash
npm run check
npm test
```

当前测试覆盖：

- Engine session lifecycle、approval、slash command 和 runtime override。
- Policy allow、deny、approval、blocked users、self approval、cwd roots 和 tool-call policy。
- Runtime run metadata 和 sandbox artifact collection。
- Slack message normalization、bot filtering、link cleaning 和 file metadata。
- Generic CLI text、JSONL 和 stdin prompt modes。
- FileStore sessions、messages、approvals、event dedupe、runs 和 artifacts。
- MCP initialize、tools/list 和 thread context。
- Admin API health、sessions、runs 和 artifacts。

Runtime 或 CLI 相关修改还应运行：

```bash
npm run smoke
npm run test:v01
```
