# Runtime Adapter Templates

OpenTag is intentionally runtime-neutral. Start with one of these templates
before writing a custom adapter.

## Generic CLI Runtime

Use this when the agent is a local command that accepts a prompt and writes text,
JSONL, or files.

```json
{
  "my-agent": {
    "type": "generic-cli",
    "command": "my-agent",
    "args": ["run", "{prompt}"],
    "outputMode": "text",
    "cwd": "{workspaceDir}",
    "timeoutMs": 900000,
    "requiresApproval": true,
    "capabilities": {
      "tools": ["shell", "file_write", "network"]
    }
  }
}
```

## HTTP Agent Runtime

Use this when the agent is an HTTP service controlled by your team.

```json
{
  "my-http-agent": {
    "type": "http",
    "url": "http://127.0.0.1:9000/run",
    "method": "POST",
    "timeoutMs": 900000,
    "requiresApproval": true,
    "capabilities": {
      "tools": ["network"]
    }
  }
}
```

## MCP-Capable Agent Runtime

Use `generic-cli` or `http` for the process boundary, then expose OpenTag MCP
tools to the agent. The runtime should keep credentials explicit and avoid
passing Slack tokens unless the runtime config opts in.

```json
{
  "my-mcp-agent": {
    "type": "generic-cli",
    "command": "my-mcp-agent",
    "args": ["--mcp", "opentag", "--prompt", "{prompt}"],
    "outputMode": "jsonl",
    "requiresApproval": true,
    "env": {
      "OPENTAG_MCP": "enabled"
    },
    "capabilities": {
      "tools": ["shell", "file_write", "network"]
    }
  }
}
```

## Channel Profile Example

Attach runtimes to a channel through an Access Bundle:

```json
{
  "channelId": "CENG",
  "name": "eng",
  "profileName": "Engineering Access Bundle",
  "defaultRuntime": "codex",
  "allowedRuntimes": ["codex", "mock"],
  "allowedRoots": ["/repo/service"],
  "approvers": ["UOWNER"],
  "limits": {
    "maxDailyRuns": 25,
    "maxRuntimeMs": 900000,
    "maxArtifactBytes": 5000000
  },
  "policy": {
    "requireApprovalForWriteAccess": true,
    "allowSelfApproval": false
  }
}
```
