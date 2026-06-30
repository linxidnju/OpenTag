# 管理和安全设置

[English](./04-admin-and-safety.md) · 简体中文

OpenTag 的设计目标是让 Slack 驱动的 Agent 工作可见、可复盘。当前产品是 local-first，因此大多数控制项位于 `~/.opentag/config.json`。

## Slack App 权限

生成的 Slack App 会请求最小核心 scopes：

```text
app_mentions:read
channels:history
groups:history
im:history
mpim:history
chat:write
commands
```

`reactions:write`、`files:write` 和 `chat:write.public` 等可选 scopes 只应在需要时添加。

## Channel Controls

每个 channel 可以定义：

```json
{
  "channelId": "C123",
  "defaultRuntime": "codex",
  "allowedRuntimes": ["mock", "codex"],
  "allowedUsers": [],
  "blockedUsers": [],
  "approvers": [],
  "allowedRoots": ["/path/to/project"],
  "workspaceRoot": "/path/to/project"
}
```

生产使用时，请使用具体 channel ID，不要使用 `*`。

## Approval Policy

v0.1 生成的 config 会为 write-capable runtime 开启审批：

```json
{
  "policy": {
    "requireApprovalForWriteAccess": true,
    "allowSelfApproval": true,
    "requireApprovalPatterns": ["deploy", "production", "delete", "push"],
    "denyPatterns": []
  }
}
```

使用 `requireApprovalPatterns` 定义需要暂停等待复核的请求。

使用 `denyPatterns` 定义永远不应运行的请求。

更严格的团队使用方式：

```json
{
  "allowSelfApproval": false,
  "approvers": ["U123", "U456"]
}
```

## Runtime Safety

OpenTag 会把不同 runtime 视为不同信任等级：

- `mock` 适合测试和 demo。
- `codex`、`opencode`、`openclaw` 和 `hermes` 可能会根据 runtime 行为和 sandbox 设置检查或修改本地文件。
- `docker` 在正确配置时可以隔离执行。
- `http` 会把工作委托给远程 agent server。

对于本地 Codex，生成的 runtime config 使用 workspace-write 风格执行。邀请大团队使用前，请检查绑定的项目路径和 approval policy。

Runtime 子进程默认继承过滤后的环境变量。变量名看起来像 secret 的值不会自动传递，例如 `SLACK_BOT_TOKEN`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`*_SECRET`、`*_TOKEN`、`*_PASSWORD` 或 `*_CREDENTIAL`。

如果某个 runtime 需要 credential，请在该 runtime config 中显式传入：

```json
{
  "env": {
    "OPENAI_API_KEY": "${env:OPENAI_API_KEY}"
  }
}
```

只传递 runtime 专用凭据。不要把 Slack bot token 或 Admin API token 传给 agent runtimes。

## 本地数据

OpenTag 会把数据存储在：

```text
~/.opentag/data
```

存储记录可能包括：

- Sessions。
- Messages。
- Incoming events。
- Approvals。
- Runs。
- Artifacts。
- Audit logs。

请把这个目录视为敏感团队工作数据。

## Admin API

生成的 config 会启用本地 Admin API：

```json
{
  "admin": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 8787,
    "requireToken": false
  }
}
```

本地使用时请保持绑定到 `127.0.0.1`。如果要暴露到 localhost 之外，请要求 token，并使用私有网络或带认证的反向代理。

## Secrets

不要提交：

```text
~/.opentag/.env
SLACK_BOT_TOKEN
SLACK_APP_TOKEN
SLACK_SIGNING_SECRET
OPENTAG_ADMIN_TOKEN
```

不要把 secrets 粘贴到 Slack 请求里。Slack 消息可能会成为 OpenTag context 和本地 audit data 的一部分。
