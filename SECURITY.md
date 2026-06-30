# Security Policy

OpenTag routes chat requests to local or remote agent runtimes. Treat every runtime as privileged automation.

## MVP Safety Rules

- Start with the `mock` runtime.
- Use read-only runtime configurations first.
- Put write-capable runtimes behind `requireApprovalForWriteAccess`.
- Never expose Slack tokens, Codex keys, Anthropic keys, or runtime credentials to untrusted repositories or public channels.
- Run write-capable runtimes inside an isolated container or CI worker.
- Review `.opentag/data/audit.ndjson` regularly.

## Secrets And Screenshots

Do not commit real values for:

```text
SLACK_BOT_TOKEN
SLACK_APP_TOKEN
SLACK_SIGNING_SECRET
SLACK_USER_TOKEN
OPENTAG_ADMIN_TOKEN
OPENAI_API_KEY
ANTHROPIC_API_KEY
```

Keep `~/.opentag/.env` local. Use `examples/env.example` and documentation placeholders such as `xoxb-...`, `xapp-...`, and `change-me`.

Before committing screenshots, redact visible app IDs, client IDs, client secrets, signing secrets, verification tokens, workspace-private data, user information, and channel content. Screenshots in `docs/pic/` are only for setup tutorials and must remain sanitized.

The detailed Slack setup tutorials live in [`docs/user-guide/01-install.md`](docs/user-guide/01-install.md) and [`docs/user-guide/01-install.zh-CN.md`](docs/user-guide/01-install.zh-CN.md). Keep screenshots there instead of embedding long setup flows in the root README.

## Reporting Vulnerabilities

Open an issue with reproduction details and affected runtime/gateway. Do not include secrets or real customer data.
