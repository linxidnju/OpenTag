# 在 Slack 中使用 OpenTag

[English](./02-use-in-slack.md) · 简体中文

Daemon 运行并且 Slack App 安装完成后，把 OpenTag bot 邀请到 channel：

```text
/invite @OpenTag
```

## 开始一个任务

在 channel 中提及 OpenTag：

```text
@OpenTag summarize this thread and list open decisions
```

OpenTag 会为这个 Slack thread 创建或继续一个 session。回复会留在同一个 thread 里，方便团队复盘工作过程。

## 继续一个 Thread

OpenTag 加入某个 thread 后，如果启用了 thread processing，这个 thread 里的普通回复可以继续已有 session。

示例：

```text
Now check whether the README explains this setup clearly.
```

OpenTag 不会从普通 channel 消息里自动开始新任务。要创建新任务，请使用 `@OpenTag` mention。

## 使用 Direct Messages

如果配置中启用了 direct messages，你可以 DM OpenTag：

```text
Summarize the current project and tell me what command starts it.
```

DM 会创建个人 session。

## Slash Commands

可以使用：

```text
/opentag help
/opentag runtimes
/opentag sessions
/opentag approvals
/opentag status <session_id>
/opentag cancel <session_id>
```

在 thread 里，这些命令很有用：

```text
/opentag status
/opentag context
/opentag runtimes
```

## 从 Slack 选择 Runtime

你可以请求 runtime override：

```text
/runtime codex inspect the repo and propose the next test to add
```

该 runtime 必须被 channel config 允许。

## 审批

有些请求在执行前可能需要审批，尤其是选中的 runtime 可以写文件，或请求匹配了高风险模式，例如：

```text
deploy
production
delete
push
```

需要审批时，OpenTag 会在 Slack 中发送按钮：

```text
Approve once
Deny
Cancel session
```

审批按钮只有在 Slack App 开启 interactivity 后才能工作。

## 好的请求方式

使用具体、可复盘的任务：

```text
@OpenTag read the recent thread and write a short implementation checklist.
```

```text
@OpenTag inspect the repo and explain which tests cover Slack message mapping.
```

```text
@OpenTag propose a patch plan only. Do not edit files yet.
```

对于写操作任务，请说明成功标准：

```text
@OpenTag update the user guide so setup and daemon commands match the current CLI, then run the docs check if available.
```

## OpenTag 能看到什么

根据配置，OpenTag 可以包含：

- 当前 Slack 消息。
- 最近的 thread context。
- Channel instructions。
- Channel memory。
- Runtime contract。
- 绑定的本地项目路径。

不要把 secret 粘贴到 Slack。OpenTag 会在本地存储 events、messages、approvals、runs 和 audit records。
