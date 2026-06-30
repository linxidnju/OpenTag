# 故障排查

[English](./05-troubleshooting.md) · 简体中文

## 先检查所有内容

运行：

```bash
opentag doctor
```

严格校验：

```bash
opentag doctor --strict
```

如果 Slack tokens 还没准备好：

```bash
opentag doctor --strict --offline
```

机器可读诊断输出：

```bash
opentag doctor --strict --offline --json
```

普通 doctor 输出里的 `Next actions` 部分就是最短恢复清单。

## 找不到 CLI

在仓库中运行：

```bash
npm install
npm link
opentag help
```

如果不想使用 `npm link`，可以用 Node 直接运行：

```bash
node ./bin/opentag.mjs help
```

## Slack Token 检查失败

打开：

```bash
~/.opentag/.env
```

检查：

```text
SLACK_BOT_TOKEN starts with xoxb-
SLACK_APP_TOKEN starts with xapp-
SLACK_SIGNING_SECRET is filled
```

然后运行：

```bash
opentag slack test
```

## Slack 没有触发 OpenTag

检查：

- Daemon 正在运行：`opentag daemon status`。
- Bot 已被邀请到 channel。
- Slack App 已启用 Socket Mode。
- App 订阅了 `app_mention`、`message.channels`、`message.groups`、`message.im` 和 `message.mpim`。
- 你使用了 `@OpenTag` 来开始新的 channel task。
- 你正在一个已有 OpenTag session 的 thread 中回复。

读取 daemon 日志：

```bash
opentag daemon logs
```

## Approval Buttons 不工作

检查 Slack App interactivity。

Socket Mode 仍然要求在 Slack App settings 中启用 interactivity。如果 interactivity 被关闭，OpenTag 可以发送 approval request，但 Slack 不会把按钮动作发送回来。

## Runtime 缺失

运行：

```bash
opentag runtime list
```

如果缺少 `codex`，请安装 Codex，并确保它在 `PATH` 上。

切换到 mock 来确认 OpenTag 本身是否正常：

```bash
opentag runtime set mock
opentag daemon restart
```

## Codex 使用了错误项目

列出项目：

```bash
opentag project list
```

重新绑定目标项目：

```bash
opentag init --project /path/to/project --runtime codex
opentag daemon restart
```

检查：

```bash
cat ~/.opentag/config.json
```

## 配置改了但 Slack 行为没变

重启 daemon：

```bash
opentag daemon restart
```

OpenTag 会在 daemon 启动时读取 config。

## Daemon 无法持续运行

读取日志：

```bash
opentag daemon logs --lines 200
```

常见原因：

- 缺少 Slack env vars。
- Slack token 无效。
- 缺少 runtime CLI。
- Config JSON 无效。
- 项目路径不存在。

## 重置本地 OpenTag 状态

先停止 daemon：

```bash
opentag daemon stop
```

然后检查：

```bash
ls ~/.opentag
```

只有在确认不再需要本地 sessions、audit logs、config 或 project bindings 时，才删除相关文件。
