# Security Policy

OpenTag routes chat requests to local or remote agent runtimes. Treat every runtime as privileged automation.

## MVP safety rules

- Start with the `mock` runtime.
- Use read-only runtime configurations first.
- Put write-capable runtimes behind `requireApprovalForWriteAccess`.
- Never expose Slack tokens, Codex keys, Anthropic keys, or runtime credentials to untrusted repositories or public channels.
- Run write-capable runtimes inside an isolated container or CI worker.
- Review `.opentag/data/audit.ndjson` regularly.

## Reporting vulnerabilities

Open an issue with reproduction details and affected runtime/gateway. Do not include secrets or real customer data.
