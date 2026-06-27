# 13. OpenTag MVP 实现说明

## 1. 这版代码复刻了 Claude Tag 的哪些核心机制

Claude Tag-like 体验可以拆成 5 个机制：

1. **频道原生触发**：用户在 Slack channel 中 `@OpenTag`，不需要切换到单独网页。
2. **Thread session**：任务在 Slack thread 中持续推进，团队成员能看到过程和结果。
3. **Channel scope**：每个频道绑定自己的 runtime、cwd、allowed users、memory notes 和高风险审批规则。
4. **Agent runtime 可替换**：OpenTag core 不关心底层是 Claude Code、Codex、OpenCode 还是自研 Agent。
5. **Auditability**：事件、消息、runtime 输出、审批都写入 SQLite。

## 2. 请求链路

```text
Slack POST /slack/events
  -> verify HMAC signature
  -> url_verification / event_callback
  -> normalize app_mention/message
  -> insert event with event_id dedupe
  -> ack Slack immediately
  -> worker queue
  -> policy authorize
  -> get/create thread session
  -> append message
  -> build context
  -> approval check
  -> runtime.start(input)
  -> render progress/final into Slack thread
  -> write audit
```

## 3. 为什么不用 Slack Bolt

MVP 采用 Python 标准库实现 HTTP server 和 Slack Web API client，原因是：

- 方便开源用户直接跑，不需要依赖安装复杂 SDK。
- 核心逻辑透明，方便后续迁移到 FastAPI、Bolt、Socket Mode 或 SaaS 多租户架构。
- 单元测试更稳定。

后续如果要做 Marketplace/SaaS，建议增加：

- OAuth install flow。
- token store。
- workspace installation 表。
- Web framework adapter。
- 队列服务，如 Redis/RQ、Celery、Temporal。

## 4. Session 状态机

```text
active
  -> running
  -> completed
  -> failed
  -> waiting_approval
  -> cancelled

completed / failed 在 followup_window_seconds 内仍可被 thread reply 继续使用。
```

普通 `message` 不会创建 session，只会进入已有 thread session。这一点非常重要，否则 bot 会监听整个频道并制造噪音。

## 5. Approval 机制

配置里的 `require_approval_patterns` 命中后：

1. session 进入 `waiting_approval`。
2. 写入 approvals 表。
3. Slack thread 发按钮：Approve once / Deny / Cancel session。
4. 用户点击后进入 `/slack/interactions`。
5. server ack 后后台处理 approval。
6. Approve once 会跳过当前 prompt 的 approval check 并继续执行 runtime。

## 6. Audit 事件

典型 audit event：

```text
event_received
approval_requested
approval_approved
runtime_started
runtime_plan_update
runtime_text_delta
runtime_message
runtime_usage
runtime_completed
runtime_failed
orchestrator_failed
policy_denied
```

## 7. 生产化建议

下一阶段建议优先做：

1. Postgres 替换 SQLite。
2. Redis/Temporal 替换内存 queue。
3. Sandbox runner：Docker/firecracker/CI runner。
4. Runtime permission proxy，接管 tool-level approval。
5. Socket Mode transport。
6. OAuth install flow 和 Admin Console。
7. MCP server，让 Claude Code/Codex/OpenCode 都能通过 MCP 读写 OpenTag channel context。
