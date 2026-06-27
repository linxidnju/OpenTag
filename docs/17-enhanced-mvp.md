# OpenTag Enhanced MVP v0.2.0

本文记录从基础 MVP 到更完整 MVP 的增强内容。

## 目标

OpenTag v0.2.0 的目标是尽量复刻 Claude Tag 的团队协作体验：

1. Slack 频道里 `@OpenTag` 触发任务。
2. 每个 thread 映射一个长期 session。
3. 普通 thread reply 可以继续 steer 同一个 session。
4. Agent 运行在受控 runtime / sandbox 中。
5. 高风险行为进入 human approval。
6. 结果、审批、审计和 artifacts 都可追踪。
7. 不绑定单一 Agent，支持 Claude Code、Codex、OpenCode、自研 Agent、Docker、HTTP runtime。
8. 提供 MCP 和 Admin API，为后续 UI、agent-to-agent 工具调用、自动化平台接入留接口。

## 新增模块

### 1. Slack Gateway 增强

- Socket Mode / HTTP mode 二选一。
- `app_mention` 触发 session。
- thread reply 只继续已有 session。
- DM / MPIM 可以创建个人 session。
- Slash command 支持 session、approval、runtime 查询和 cancel。
- Approval button 支持 approve / deny / cancel。
- Thread hydration 支持拉取最近消息作为上下文。
- Event dedupe 避免 Slack retry 重复执行。

### 2. Session Engine 增强

- 单 session 串行队列，避免同一 thread 中多轮并发。
- `waiting_approval` 状态保留上下文，approval 通过后自动 resume。
- `cancelSession` 可中断正在执行的 runtime。
- Runtime event 支持：started、token、log、tool_call、approval_request、artifact、completed、failed。

### 3. Runtime Adapter 增强

| Adapter | 状态 | 说明 |
| --- | --- | --- |
| mock | 完成 | 测试和 smoke test |
| claude-code | 完成 | 解析 stream-json / JSONL 输出 |
| codex | 完成 | 支持 `codex exec` |
| opencode | 完成 | 支持 `opencode run` |
| generic-cli | 完成 | 支持 stdin prompt、text/jsonl 输出、env 注入 |
| docker | 完成 | 基于 Docker CLI，支持 readonly/rw mount、network none |
| http | 完成 | 适配远程 agent server |

### 4. Policy 增强

- blocked users。
- allowed users。
- allowed runtimes。
- deny patterns。
- approval patterns。
- write-capable runtime approval。
- static cwd allowed roots 校验。
- tool call allow / deny / approval policy。
- self approval 可关闭。

### 5. MCP Server

MCP stdio server 暴露 OpenTag 工具：

- `opentag.list_sessions`
- `opentag.get_thread_context`
- `opentag.append_audit`
- `opentag.request_approval`
- `opentag.post_slack_reply`

`post_slack_reply` 默认关闭，避免任意 MCP client 直接向 Slack 发消息。

### 6. Admin API

本地 Admin API 可用于调试、未来 UI、自动化集成：

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

### 7. FileStore 增强

新增持久化对象：

- incoming events
- sessions
- messages
- approvals
- runs
- artifacts
- audit logs

同时增加 message dedupe 和 event dedupe。

## 运行命令

```bash
npm install
npm run check
npm test
npm run smoke
npm run start:console
npm start
npm run start:admin
npm run mcp
```

## 当前测试覆盖

```text
30 tests passed
```

覆盖：

- Engine lifecycle。
- Approval resume。
- Slash commands。
- Policy。
- Runtime streaming / JSONL / stdin。
- Slack mapper。
- FileStore dedupe / runs / artifacts。
- Run metadata persistence and sandbox artifact collection。
- MCP tools。
- Admin API。

## 仍需生产化的部分

1. Slack OAuth 多租户安装流。
2. Postgres / Redis / queue worker。
3. Docker sandbox seccomp/AppArmor profile。
4. Web Admin UI。
5. Runtime resume/live steering 标准协议。
6. 完整 tool proxy + per-tool approval。
7. 文件上传、PR 创建、artifact upload。
