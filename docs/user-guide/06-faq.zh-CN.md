# FAQ

[English](./06-faq.md) · 简体中文

## OpenTag 和 Claude Tag 一样吗？

不一样。OpenTag 借鉴了相似的用户想法：从协作工具里 tag 一个 Agent，并让工作过程保留在对话中。当前 OpenTag 代码是一个开源、local-first 的实现，重点支持 Slack 和可插拔 runtimes。

## OpenTag 需要公网服务器吗？

默认本地设置不需要。OpenTag 使用 Slack Socket Mode，所以 daemon 可以运行在你的机器上，不需要公网 Request URL。

Core Slack gateway 支持 HTTP Events API，但本地 v0.1 设置优先使用 Socket Mode。

## 非开发者可以使用吗？

Workspace owner 安装 Slack App 并启动 daemon 后，非开发者可以从 Slack 使用 OpenTag。当前安装流程仍然需要命令行设置。

## OpenTag 在哪里运行？

默认设置中，OpenTag 运行在启动以下命令的机器上：

```bash
opentag daemon start
```

这台机器拥有本地项目访问、runtime 执行、config、logs 和本地数据。

## 文件和日志存在哪里？

OpenTag 会把本地 config 和 state 写到：

```text
~/.opentag
```

Daemon logs：

```text
~/.opentag/opentag.log
```

Data：

```text
~/.opentag/data
```

## OpenTag 可以编辑我的仓库吗？

取决于选中的 runtime、sandbox 设置、allowed roots 和 approval policy。生成的 `codex` runtime 被配置为 write-capable，并默认要求审批。

使用 `mock` 可以做无写入的 smoke tests。

## 可以使用多个仓库吗？

可以。使用：

```bash
opentag project add /path/to/project
opentag project list
opentag project use /path/to/project
```

如果要按 channel 使用不同项目，请在 `~/.opentag/config.json` 中配置 `workspaceRoot` 和 `allowedRoots`。

## 可以使用多个 runtime 吗？

可以。使用：

```bash
opentag runtime list
opentag runtime set codex
```

Slack 用户也可以通过以下方式请求 runtime：

```text
/runtime codex do the task
```

该 runtime 必须出现在 channel 的 `allowedRuntimes` 中。

## OpenTag 会把我的代码发送到 Slack 吗？

OpenTag 会把 runtime 输出回复到 Slack。如果 runtime 总结代码或包含代码片段，这些文本会出现在 Slack 中。OpenTag 也可以在本地收集 artifacts。如果你不希望敏感内容被粘贴到 Slack，请在 prompt 中明确说明。

## 可以让团队使用 OpenTag 吗？

可以，但当前产品是 local-first。团队使用时：

- 在稳定机器上运行 daemon。
- 使用具体 Slack workspace 和 channel IDs。
- 限制 `allowedRoots`。
- 限制 `allowedRuntimes`。
- 配置 approvers。
- 让 Admin API 保持在 localhost，或为它加保护。
- 按团队策略备份或轮换 `~/.opentag/data`。

## 为什么普通 channel 聊天不会开始任务？

OpenTag 避免意外执行。在 channel 中，请使用 `@OpenTag` 开始任务。普通 thread replies 可以继续已有 OpenTag session。

## 生产使用前应该做什么？

- 替换 wildcard workspace 和 channel config。
- 如有需要，关闭 self-approval。
- 定义明确 approvers。
- 确认 Slack scopes 最小化。
- 测试 daemon restart 和 logs。
- 检查本地 audit data 的处理方式。
- 在允许 write-capable runtimes 前，先从 `mock` 或 read-only tasks 开始。
