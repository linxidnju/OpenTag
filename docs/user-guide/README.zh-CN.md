# OpenTag 用户指南

[English](./README.md) · 简体中文

OpenTag 让团队可以从 Slack 使用本地编码 Agent。安装完成后，你可以在 Slack channel、thread 或 DM 里提及 OpenTag bot，OpenTag 会把请求路由到本地 runtime，例如 Codex、OpenCode、OpenClaw、Hermes 或 mock runtime。

OpenTag 当前是 Slack-first 和 local-first。它使用 Slack App、Socket Mode、本地 daemon，以及 `~/.opentag` 下的项目配置。

## 本指南适合谁

- **团队用户**：希望直接从 Slack 向 OpenTag 求助。
- **Workspace owner**：需要安装 Slack App 并运行本地 daemon。
- **项目负责人**：需要决定 OpenTag 可以访问哪个仓库，以及使用哪个 runtime。

如果你要修改 OpenTag 内部实现，请阅读开发者文档。这个目录面向产品使用者。

## OpenTag 做什么

OpenTag 会把 Slack 消息变成 Agent session：

```text
Slack mention、thread、DM 或 /opentag command
  -> OpenTag local daemon
  -> session、policy、context 和 approval checks
  -> 选中的 runtime，例如 Codex 或 OpenCode
  -> Slack thread reply、audit records 和 artifacts
```

常见用途：

- 让 Agent 总结 Slack thread。
- 让 Agent 检查本地仓库。
- 让 Agent 提出代码修改方案。
- 让工作过程保留在同一个 Slack thread 里。
- 在写操作或高风险动作前要求审批。

## 当前产品边界

当前版本：`opentag` package `0.2.0`，包含 v0.1 本地设置流程。

当前支持：

- Slack Socket Mode 本地 daemon。
- Slack app mention、thread reply、DM 和 `/opentag`。
- 本地项目绑定。
- Runtime 选择和可用性检查。
- 针对 allowed roots、allowed runtimes、approval patterns 和 write-capable runtimes 的 policy checks。
- `~/.opentag` 下的本地文件存储。
- 面向开发者 MVP 的 Admin API 和 MCP server。

暂不包含：

- 托管式 OAuth 安装。
- 托管云 relay。
- 原生 Teams、Discord、Telegram、飞书或企业微信 adapter。
- 多租户 SaaS admin console。

## 快速路径

本地 Slack 设置：

```bash
npm install
npm link
opentag init --project . --runtime codex --open-slack
```

然后：

1. 从 `~/.opentag/slack-app-manifest.yml` 导入生成的 Slack manifest。
2. 在 `~/.opentag/.env` 中填写 Slack token。
3. 运行 `opentag doctor --strict`。
4. 运行 `opentag daemon start`。
5. 邀请 bot 进入 Slack channel 并提及它。

随时运行 `opentag next` 可以查看下一步设置提示。

## 指南目录

- [安装 OpenTag](./01-install.zh-CN.md)
- [在 Slack 中使用 OpenTag](./02-use-in-slack.zh-CN.md)
- [配置项目和 Runtime](./03-projects-and-runtimes.zh-CN.md)
- [管理和安全设置](./04-admin-and-safety.zh-CN.md)
- [故障排查](./05-troubleshooting.zh-CN.md)
- [FAQ](./06-faq.zh-CN.md)
