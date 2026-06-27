# 15. Runtime Adapter 指南

OpenTag v0.2.0 的 runtime adapter 是 Node.js async generator 接口。OpenTag Engine 不关心底层是 Claude Code、Codex、OpenCode、Docker、HTTP 还是自研 Agent，只消费统一 runtime events。

## 1. 统一接口

Adapter 需要实现：

```js
class RuntimeAdapter {
  constructor({ id, spec, logger }) {}

  describe() {
    return { id: this.id, type: this.spec.type, streaming: true };
  }

  async *run({ prompt, message, session, sandbox, signal }) {
    yield { type: "started", message: "runtime started" };
    yield { type: "token", text: "hello" };
    yield { type: "completed", output: "done" };
  }
}
```

OpenTag Engine 支持的事件：

```text
started
log
token
tool_call
approval_request
artifact
completed
failed
```

## 2. JSONL runtime event 协议

`generic-cli` / `claude-code` / `codex` adapter 都可以解析 JSONL：

```jsonl
{"type":"started","message":"planning"}
{"type":"token","text":"hello"}
{"type":"log","message":"debug info"}
{"type":"tool_call","name":"read_file","argumentsText":"README.md"}
{"type":"approval_request","reason":"Need to edit files","risks":["write"]}
{"type":"artifact","path":"/workspace/report.md","relativePath":"report.md"}
{"type":"completed","output":"done"}
{"type":"failed","error":"something failed"}
```

## 3. Claude Code Adapter

配置：

```json
"claude-code-readonly": {
  "type": "claude-code",
  "command": "claude",
  "outputFormat": "stream-json",
  "allowedTools": ["Read", "Glob", "Grep", "LS"],
  "permissionMode": "default",
  "timeoutMs": 600000
}
```

写权限版本建议保留 approval：

```json
"claude-code-write": {
  "type": "claude-code",
  "command": "claude",
  "outputFormat": "stream-json",
  "allowedTools": ["Read", "Glob", "Grep", "LS", "Edit", "MultiEdit", "Write", "Bash"],
  "permissionMode": "acceptEdits",
  "requiresApproval": true,
  "timeoutMs": 900000
}
```

## 4. Codex Adapter

Readonly：

```json
"codex-readonly": {
  "type": "codex",
  "command": "codex",
  "sandbox": "read-only",
  "json": true,
  "ephemeral": true,
  "timeoutMs": 600000
}
```

Workspace write：

```json
"codex-workspace-write": {
  "type": "codex",
  "command": "codex",
  "sandbox": "workspace-write",
  "json": true,
  "ephemeral": true,
  "requiresApproval": true,
  "timeoutMs": 900000
}
```

## 5. OpenCode Adapter

```json
"opencode": {
  "type": "opencode",
  "command": "opencode",
  "requiresApproval": true,
  "timeoutMs": 900000
}
```

当前适配 `opencode run` 一次性任务。后续可以升级到常驻 server / ACP / session resume。

## 6. Generic CLI Adapter

适合 Hermes Agent、OpenClaw、自研 Agent、脚本型 Agent。

```json
"my-agent": {
  "type": "generic-cli",
  "command": "node",
  "args": ["./agent.js"],
  "promptMode": "stdin",
  "outputMode": "jsonl",
  "requiresApproval": true,
  "env": {
    "MY_AGENT_MODE": "opentag"
  },
  "timeoutMs": 600000
}
```

`promptMode`：

- `stdin`：prompt 写入 stdin。
- `argv`：prompt 作为最后一个 argv。
- `env`：prompt 写入 `OPENTAG_PROMPT`。

`outputMode`：

- `text`：stdout 当作普通 token 流。
- `jsonl`：stdout 每行解析成 runtime event。

OpenTag 会注入环境变量：

```text
OPENTAG_SESSION_ID
OPENTAG_RUNTIME_ID
OPENTAG_THREAD_ID
OPENTAG_CHANNEL_ID
OPENTAG_WORKSPACE_ID
OPENTAG_SANDBOX_DIR
OPENTAG_WORKSPACE_ROOT
```

## 7. Docker Runtime Adapter

```json
"docker-node-readonly": {
  "type": "docker",
  "image": "node:22-alpine",
  "args": ["node", "-e", "process.stdin.pipe(process.stdout)"],
  "readOnly": true,
  "network": "none",
  "timeoutMs": 600000
}
```

Docker adapter 会执行类似：

```bash
docker run --rm -i --network none -v <workspaceRoot>:/workspace:ro -w /workspace node:22-alpine ...
```

生产建议：

- 默认 `readOnly: true`。
- 默认 `network: none`。
- 增加 CPU / memory / pids 限制。
- 增加 seccomp / AppArmor profile。
- 只 mount 必要目录。

## 8. HTTP Runtime Adapter

```json
"hermes-http": {
  "type": "http",
  "endpoint": "http://localhost:8788/v1/agent/run",
  "headers": {
    "authorization": "Bearer ${env:HERMES_API_KEY}"
  },
  "requiresApproval": true,
  "timeoutMs": 600000
}
```

HTTP runtime 请求体包含：

```json
{
  "prompt": "...",
  "session": { "id": "sess_x" },
  "message": { "userId": "U1" },
  "sandbox": { "dir": "...", "workspaceRoot": "..." }
}
```

返回可以是：

```json
{
  "output": "final answer"
}
```

或者：

```json
{
  "events": [
    { "type": "started", "message": "ok" },
    { "type": "completed", "output": "done" }
  ]
}
```

## 9. 新增自定义 Adapter

新增文件：

```text
src/runtimes/MyRuntimeAdapter.js
```

实现：

```js
export class MyRuntimeAdapter {
  constructor({ id, spec, logger }) {
    this.id = id;
    this.spec = spec;
    this.logger = logger;
  }

  describe() {
    return { id: this.id, type: "my-runtime", streaming: true };
  }

  async *run({ prompt, session, sandbox, signal }) {
    yield { type: "started", message: "My runtime started" };
    yield { type: "token", text: await myAgent(prompt) };
    yield { type: "completed", output: "done" };
  }
}
```

然后在 `src/core/RuntimeRegistry.js` 注册。
