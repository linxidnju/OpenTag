# 14. Slack App 设置指南

OpenTag v0.2.0 支持两种 Slack transport：

1. **Socket Mode**：推荐本地开发和自部署早期使用，不需要公网 Request URL。
2. **HTTP Events API**：推荐线上服务部署，需要公网 HTTPS URL。

## 1. 创建 Slack App

在 Slack App settings 中创建 app，然后导入：

```text
examples/slack-app-manifest.yaml
```

manifest 默认启用 Socket Mode。

## 2. Scopes

最小 scopes：

```text
app_mentions:read
channels:history
groups:history
im:history
mpim:history
chat:write
commands
```

可选：

```text
reactions:write
files:write
chat:write.public
```

默认不要开太多权限。`chat:write.public` 只在 bot 需要向未加入的 public channel 发消息时考虑。

## 3. Event subscriptions

订阅：

```text
app_mention
message.channels
message.groups
message.im
message.mpim
```

OpenTag 的处理策略：

- `app_mention`：创建或继续 thread session。
- `message.channels/groups`：只继续已有 thread session，不会创建新任务。
- `message.im/mpim`：在 `slack.processDirectMessages=true` 时可以创建个人 session。

## 4. Socket Mode 本地开发

需要两个 token：

```bash
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_APP_TOKEN="xapp-..."
export SLACK_SIGNING_SECRET="..."
```

启动：

```bash
npm install
npm run doctor
npm start
```

默认 `examples/opentag.config.example.json` 已经设置：

```json
{
  "slack": {
    "mode": "socket"
  }
}
```

## 5. HTTP Events API 部署

把配置改为：

```json
{
  "slack": {
    "mode": "http",
    "port": 3000
  }
}
```

然后在 Slack App 后台设置：

```text
Event Request URL:       https://YOUR_DOMAIN/slack/events
Interactivity URL:       https://YOUR_DOMAIN/slack/interactions
Slash Command URL:       https://YOUR_DOMAIN/slack/commands
```

本地临时测试：

```bash
ngrok http 3000
```

或者：

```bash
cloudflared tunnel --url http://localhost:3000
```

## 6. Channel 配置

把 Slack payload 中的：

```text
team_id -> workspaceId
channel -> channelId
```

填入 `examples/opentag.config.example.json` 的 `workspaces` 配置。MVP 示例使用 `*` 通配 workspace/channel，方便本地测试；正式使用建议配置具体 team/channel。

## 7. Slash command

OpenTag 支持：

```text
/opentag help
/opentag runtimes
/opentag sessions [limit]
/opentag approvals [pending|approved|denied]
/opentag audit [session_id] [limit]
/opentag status <session_id>
/opentag cancel <session_id>
```

Thread 内还支持：

```text
/opentag status
/opentag context
/opentag runtimes
/runtime <runtime-id> <request>
```

## 8. Approval buttons

当 policy 判定需要审批时，OpenTag 会在 thread 中发送按钮：

```text
Approve once
Deny
Cancel session
```

Slack Interactivity 必须开启，否则按钮不会回调到 OpenTag。

## 9. 常见问题

### Socket Mode 连接不上

检查：

- App-Level Token 是否以 `xapp-` 开头。
- App-Level Token 是否带 `connections:write` scope。
- `settings.socket_mode_enabled` 是否为 true。
- `SLACK_BOT_TOKEN` 是否是 bot token。

### HTTP URL verification 失败

检查：

- 服务是否能公网访问。
- Request URL 是否是 `/slack/events`。
- HTTPS 证书是否正常。
- `SLACK_SIGNING_SECRET` 是否正确。

### 收到事件但不回复

检查：

- bot 是否被邀请进 channel。
- channel 是否被 `allowedUsers` / `blockedUsers` / `allowedRuntimes` 限制。
- 普通频道消息不会创建新 session；需要 `@OpenTag`。
- thread reply 只会继续已有 OpenTag session。

### Approval button 没反应

检查：

- Interactivity 是否开启。
- Interactivity URL 是否正确。
- Socket Mode 下是否已经启用 interactivity。
- OpenTag server log 是否有 Slack Bolt error。
