# Configure Projects and Runtimes

OpenTag needs to know which local project a Slack request should use and which runtime should handle the request.

## Project Binding

The setup command binds a project:

```bash
opentag init --project . --runtime codex
```

List known projects:

```bash
opentag project list
```

Add a project:

```bash
opentag project add /path/to/project --runtime codex
```

Switch the current project:

```bash
opentag project use /path/to/project
```

Remove a project:

```bash
opentag project remove /path/to/project
```

The project binding is stored in:

```text
~/.opentag/projects.json
.opentag/project.json inside the project
```

## Allowed Roots

OpenTag checks whether a project path is allowed before runtime execution.

Allow a root:

```bash
opentag project allow-root /path/to/project
```

For a specific Slack workspace or channel:

```bash
opentag project allow-root /path/to/project --workspace T123 --channel C123
```

Restart the daemon after changing allowed roots:

```bash
opentag daemon restart
```

## Runtime List

List configured runtimes and availability:

```bash
opentag runtime list
```

The selected default runtime is marked with `*`.

## Set the Default Runtime

```bash
opentag runtime set codex
opentag runtime set opencode
opentag runtime set mock
```

This updates the default runtime and channel runtime allowlist in the local config.

## Built-In Runtime Types

OpenTag includes adapters for:

| Runtime | CLI command | Notes |
| --- | --- | --- |
| `mock` | none | Always available, useful for smoke tests. |
| `codex` | `codex` | Runs Codex in non-interactive mode. |
| `opencode` | `opencode` | Runs OpenCode. |
| `openclaw` | `openclaw` | Generic CLI runtime. |
| `hermes` | `hermes` | Generic CLI runtime. |
| `claude-code` | `claude` | Available in the core adapter layer. |
| `docker` | `docker` | Available in the core adapter layer for container isolation. |
| `http` | remote URL | Available in the core adapter layer for remote agent servers. |

The v0.1 generated config includes `mock`, `codex`, `opencode`, `openclaw`, and `hermes`.

## Local Config File

Default config:

```text
~/.opentag/config.json
```

Important fields:

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
          "profileName": "Default Access Bundle",
          "defaultRuntime": "codex",
          "allowedRuntimes": ["mock", "codex", "opencode", "openclaw", "hermes"],
          "allowedRoots": ["."],
          "workspaceRoot": ".",
          "limits": {
            "maxDailyRuns": 25,
            "maxRuntimeMs": 900000,
            "maxArtifactBytes": 5000000
          }
        }
      ]
    }
  ]
}
```

For real team use, replace `*` with the Slack `team_id` and channel ID.

## Runtime Adapter Templates

For custom agents, start with the templates in
[`../runtime-adapter-templates.md`](../runtime-adapter-templates.md). The
recommended path is:

1. Use `generic-cli` for a local command agent.
2. Use `http` for a local or private agent service.
3. Expose OpenTag MCP tools only after the runtime boundary is stable.

Keep Slack credentials out of runtime processes unless the runtime config
explicitly opts in.
