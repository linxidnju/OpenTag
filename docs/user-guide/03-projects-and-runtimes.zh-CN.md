# 配置项目和 Runtime

[English](./03-projects-and-runtimes.md) · 简体中文

OpenTag 需要知道 Slack 请求应该使用哪个本地项目，以及由哪个 runtime 处理请求。

## 项目绑定

设置命令会绑定项目：

```bash
opentag init --project . --runtime codex
```

列出已知项目：

```bash
opentag project list
```

添加项目：

```bash
opentag project add /path/to/project --runtime codex
```

切换当前项目：

```bash
opentag project use /path/to/project
```

移除项目：

```bash
opentag project remove /path/to/project
```

项目绑定存储在：

```text
~/.opentag/projects.json
项目内的 .opentag/project.json
```

## Allowed Roots

OpenTag 会在 runtime 执行前检查项目路径是否被允许。

允许一个 root：

```bash
opentag project allow-root /path/to/project
```

针对特定 Slack workspace 或 channel：

```bash
opentag project allow-root /path/to/project --workspace T123 --channel C123
```

修改 allowed roots 后重启 daemon：

```bash
opentag daemon restart
```

## Runtime 列表

列出已配置 runtimes 和可用性：

```bash
opentag runtime list
```

当前默认 runtime 会用 `*` 标记。

## 设置默认 Runtime

```bash
opentag runtime set codex
opentag runtime set opencode
opentag runtime set mock
```

这会更新本地 config 中的默认 runtime 和 channel runtime allowlist。

## 内置 Runtime 类型

OpenTag 包含这些 adapters：

| Runtime | CLI command | 说明 |
| --- | --- | --- |
| `mock` | none | 始终可用，适合 smoke tests。 |
| `codex` | `codex` | 以非交互模式运行 Codex。 |
| `opencode` | `opencode` | 运行 OpenCode。 |
| `openclaw` | `openclaw` | Generic CLI runtime。 |
| `hermes` | `hermes` | Generic CLI runtime。 |
| `claude-code` | `claude` | Core adapter layer 中可用。 |
| `docker` | `docker` | Core adapter layer 中可用于容器隔离。 |
| `http` | remote URL | Core adapter layer 中可用于远程 agent servers。 |

v0.1 生成的 config 包含 `mock`、`codex`、`opencode`、`openclaw` 和 `hermes`。

## 本地 Config 文件

默认 config：

```text
~/.opentag/config.json
```

重要字段：

```json
{
  "gateway": "slack",
  "slack": {
    "mode": "socket",
    "processThreadReplies": true,
    "processDirectMessages": true,
    "hydrateThreadContext": true
  },
  "workspaces": [
    {
      "workspaceId": "*",
      "channels": [
        {
          "channelId": "*",
          "defaultRuntime": "codex",
          "allowedRuntimes": ["mock", "codex", "opencode", "openclaw", "hermes"],
          "allowedRoots": ["."],
          "workspaceRoot": "."
        }
      ]
    }
  ]
}
```

真实团队使用时，请把 `*` 替换为 Slack `team_id` 和 channel ID。
