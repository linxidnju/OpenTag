![OpenTag banner](docs/banner.png)

# OpenTag

> An open-source, channel-native agent gateway for teams.

[English](README.md) · [简体中文](README.zh-CN.md) · [User Guide](docs/user-guide/README.md) · [Security](SECURITY.md)

OpenTag brings AI agents into the place where team work already happens: Slack channels and threads.

Instead of running an agent from one person's terminal and pasting results back into chat, a team can mention `@OpenTag`, discuss the task in the same thread, approve risky actions when needed, and keep the outcome visible to everyone who has access to that channel.

---

## What You Can Do

- Ask an agent to investigate a bug from a Slack thread.
- Let teammates add context before or during the agent run.
- Route work to different agent backends such as Codex, Claude Code, OpenCode, Docker-based agents, HTTP agents, or custom CLIs.
- Use channel-level rules so different projects can have different permissions, memories, and default agents.
- Require approvals before write actions or risky operations.
- Keep a record of sessions, decisions, outputs, and generated artifacts.

OpenTag is designed for team workflows where context, permission, and accountability matter.

---

## How It Feels In Slack

```text
@OpenTag summarize why this deployment failed

@OpenTag check this thread and draft the fix plan

/runtime codex-readonly explain the current project structure

/opentag sessions
/opentag approvals
/opentag status <session_id>
```

The agent replies in the same Slack thread, so the work stays connected to the original discussion.

---

## Why OpenTag

Most AI coding and automation tools are built around a single local operator. OpenTag is built around shared channels.

- **Shared by default**: the conversation, context, and result stay in the team thread.
- **Channel-aware**: each channel can have its own project, instructions, memory, permissions, and default runtime.
- **Agent-flexible**: use the agent runtime that fits the task instead of locking the team into one backend.
- **Approval-ready**: sensitive actions can pause for human review.
- **Auditable**: sessions, messages, approvals, outputs, and artifacts can be reviewed later.

---

## Quick Start

OpenTag requires Node.js `>=20.11.0`.

```bash
npm install
npm run smoke
```

Try OpenTag locally without Slack:

```bash
npm run start:console
```

Start the Slack gateway with the example configuration:

```bash
cp examples/env.example .env
set -a
source .env
set +a
npm run doctor
npm start
```

For Slack setup, start with:

- [`docs/user-guide/01-install.md`](docs/user-guide/01-install.md)
- [`examples/env.example`](examples/env.example)
- [`examples/slack-app-manifest.yaml`](examples/slack-app-manifest.yaml)

---

## What Is Included

- Slack gateway for mentions, thread replies, DMs, slash commands, and approvals.
- Local console mode for trying OpenTag without Slack.
- Runtime options for mock runs, Codex, Claude Code, OpenCode, Docker, HTTP agents, and generic CLI agents.
- Channel configuration for default runtime, allowed runtimes, allowed users, approvers, instructions, memory, and workspace roots.
- Local storage for sessions, messages, approvals, runs, audit records, and artifacts.
- Admin and integration surfaces for teams that want to build deeper workflows.

---

## User Guide

- [`docs/user-guide/README.md`](docs/user-guide/README.md) - guide index
- [`docs/user-guide/01-install.md`](docs/user-guide/01-install.md) - install and Slack setup
- [`docs/user-guide/02-use-in-slack.md`](docs/user-guide/02-use-in-slack.md) - day-to-day Slack usage
- [`docs/user-guide/03-projects-and-runtimes.md`](docs/user-guide/03-projects-and-runtimes.md) - projects and runtime choices
- [`docs/user-guide/04-admin-and-safety.md`](docs/user-guide/04-admin-and-safety.md) - approvals, safety, and operations
- [`docs/user-guide/05-troubleshooting.md`](docs/user-guide/05-troubleshooting.md) - common issues
- [`docs/user-guide/06-faq.md`](docs/user-guide/06-faq.md) - FAQ

For implementation details, see [`docs/developer-guide.md`](docs/developer-guide.md).

---

## Safety Model

OpenTag is meant to make agent work visible and controllable in a team setting.

- Secrets should be supplied through environment variables, not committed to the repository.
- Channels can limit who can use OpenTag and which runtimes are allowed.
- Write-capable or risky actions can require approval.
- Workspaces and filesystem roots can be restricted by configuration.
- Runs, approvals, artifacts, and audit records are kept for review.

See [`SECURITY.md`](SECURITY.md) for security reporting and project security guidance.

---

## Current Status

OpenTag is an MVP for Slack-first team agent workflows. It is suitable for local trials, internal team experiments, and runtime integration work.

It is not yet a hosted production SaaS. Planned improvements include Slack OAuth installation, stronger multi-instance storage, a web admin UI, hardened sandboxing, and more channel integrations.

---

## License

Apache-2.0. See [`LICENSE`](LICENSE).
