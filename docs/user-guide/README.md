# OpenTag User Guide

OpenTag lets a team use local coding agents from Slack. After installation, you can mention the OpenTag bot in a Slack channel, thread, or DM, and OpenTag routes the request to a local runtime such as Codex, OpenCode, OpenClaw, Hermes, or a mock runtime.

OpenTag is Slack-first and local-first today. It uses a Slack app, Socket Mode, a local daemon, and a project config under `~/.opentag`.

## Who This Guide Is For

- **Team users** who want to ask OpenTag for help from Slack.
- **Workspace owners** who need to install the Slack app and run the local daemon.
- **Project owners** who need to decide which repository and runtime OpenTag can use.

If you are changing OpenTag internals, use the development docs in `docs/`. This folder is for people using the product.

## What OpenTag Does

OpenTag turns Slack messages into agent sessions:

```text
Slack mention, thread, DM, or /opentag command
  -> OpenTag local daemon
  -> session, policy, context, and approval checks
  -> selected runtime such as Codex or OpenCode
  -> Slack thread reply, audit records, and artifacts
```

Common uses:

- Ask an agent to summarize a Slack thread.
- Ask an agent to inspect a local repository.
- Ask an agent to propose a code change.
- Keep work visible in the same Slack thread.
- Require approval before write-like or risky actions.

## Current Product Boundary

Current version: `opentag` package `0.2.0`, with a v0.1 local setup flow.

Supported today:

- Slack Socket Mode local daemon.
- Slack app mentions, thread replies, DMs, and `/opentag`.
- Local project binding.
- Runtime selection and runtime availability checks.
- Policy checks for allowed roots, allowed runtimes, approval patterns, and write-capable runtimes.
- Local file storage under `~/.opentag`.
- Admin API and MCP server in the developer-facing MVP.

Not included yet:

- Hosted OAuth install.
- Managed cloud relay.
- Native Teams, Discord, Telegram, Feishu, or WeCom adapters.
- Multi-tenant SaaS admin console.

## Quick Path

For a local Slack setup:

```bash
npm install
npm link
opentag setup --local --project . --runtime codex --open-slack
```

Then:

1. Import the generated Slack manifest from `~/.opentag/slack-app-manifest.yml`.
2. Copy `~/.opentag/.env.example` to `~/.opentag/.env`.
3. Fill the Slack token values.
4. Run `opentag doctor --strict`.
5. Run `opentag daemon start`.
6. Invite the bot to a Slack channel and mention it.

## Guide Contents

- [Install OpenTag](./01-install.md)
- [Use OpenTag in Slack](./02-use-in-slack.md)
- [Configure Projects and Runtimes](./03-projects-and-runtimes.md)
- [Admin and Safety Settings](./04-admin-and-safety.md)
- [Troubleshooting](./05-troubleshooting.md)
- [FAQ](./06-faq.md)

