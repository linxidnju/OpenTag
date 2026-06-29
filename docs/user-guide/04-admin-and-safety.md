# Admin and Safety Settings

OpenTag is designed to keep Slack-driven agent work visible and reviewable. The current product is local-first, so most controls live in `~/.opentag/config.json`.

## Slack App Permissions

The generated Slack app asks for the minimum core scopes:

```text
app_mentions:read
channels:history
groups:history
im:history
mpim:history
chat:write
commands
```

Optional scopes such as `reactions:write`, `files:write`, and `chat:write.public` should only be added when needed.

## Channel Controls

Each channel can define:

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

Use specific channel IDs for production usage instead of `*`.

## Approval Policy

The v0.1 generated config enables approval for write-capable runtime use:

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

Use `requireApprovalPatterns` for requests that should pause for review.

Use `denyPatterns` for requests that should never run.

For stricter team usage, set:

```json
{
  "allowSelfApproval": false,
  "approvers": ["U123", "U456"]
}
```

## Runtime Safety

OpenTag treats runtimes as different trust levels:

- `mock` is safe for tests and demos.
- `codex`, `opencode`, `openclaw`, and `hermes` may inspect or modify local files depending on runtime behavior and sandbox settings.
- `docker` can isolate execution when configured.
- `http` delegates work to a remote agent server.

For local Codex, the generated runtime config uses workspace-write style execution. Review the bound project path and approval policy before inviting a large team to use it.

Runtime child processes inherit a filtered environment by default. Variables whose names look like secrets, such as `SLACK_BOT_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`, or `*_CREDENTIAL`, are not passed through automatically.

If a runtime needs a credential, pass it explicitly in that runtime config:

```json
{
  "env": {
    "OPENAI_API_KEY": "${env:OPENAI_API_KEY}"
  }
}
```

Only pass runtime-specific credentials. Do not pass Slack bot tokens or the Admin API token to agent runtimes.

## Local Data

OpenTag stores data under:

```text
~/.opentag/data
```

Stored records can include:

- Sessions.
- Messages.
- Incoming events.
- Approvals.
- Runs.
- Artifacts.
- Audit logs.

Treat this directory as sensitive team work data.

## Admin API

The generated config enables a local Admin API:

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

Keep it bound to `127.0.0.1` for local use. If you expose it outside localhost, require a token and use a private network or reverse proxy with authentication.

## Secrets

Do not commit:

```text
~/.opentag/.env
SLACK_BOT_TOKEN
SLACK_APP_TOKEN
SLACK_SIGNING_SECRET
OPENTAG_ADMIN_TOKEN
```

Do not paste secrets into Slack requests. Slack messages can become part of OpenTag context and local audit data.
