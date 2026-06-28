# FAQ

## Is OpenTag the same as Claude Tag?

No. OpenTag follows a similar user idea: tag an agent from a collaboration tool and keep work visible in the conversation. The current OpenTag code is an open-source, local-first implementation focused on Slack and pluggable runtimes.

## Does OpenTag require a public server?

No for the default local setup. OpenTag uses Slack Socket Mode, so the daemon can run on your machine without a public Request URL.

HTTP Events API support exists in the core Slack gateway, but local v0.1 setup is Socket Mode first.

## Can non-developers use it?

They can use OpenTag from Slack after a workspace owner has installed the Slack app and started the daemon. The install flow still requires command-line setup today.

## Where is OpenTag running?

In the default setup, OpenTag runs on the machine that starts:

```bash
opentag daemon start
```

That machine owns the local project access, runtime execution, config, logs, and local data.

## Where are files and logs stored?

OpenTag writes local config and state under:

```text
~/.opentag
```

Daemon logs:

```text
~/.opentag/opentag.log
```

Data:

```text
~/.opentag/data
```

## Can OpenTag edit my repository?

It depends on the selected runtime, sandbox settings, allowed roots, and approval policy. The generated `codex` runtime is configured as write-capable and requires approval by default.

Use `mock` for no-write smoke tests.

## Can I use multiple repositories?

Yes. Use:

```bash
opentag project add /path/to/project
opentag project list
opentag project use /path/to/project
```

For channel-specific usage, configure `workspaceRoot` and `allowedRoots` in `~/.opentag/config.json`.

## Can I use multiple runtimes?

Yes. Use:

```bash
opentag runtime list
opentag runtime set codex
```

Slack users can also request a runtime with:

```text
/runtime codex do the task
```

The runtime must be present in the channel `allowedRuntimes`.

## Does OpenTag send my code to Slack?

OpenTag replies in Slack with the runtime output. If the runtime summarizes code or includes snippets, that text appears in Slack. OpenTag can also collect artifacts locally. Be explicit in your prompts if you do not want sensitive content pasted into Slack.

## Can I run OpenTag for a team?

Yes, but the current product is local-first. For team usage:

- Run the daemon on a stable machine.
- Use specific Slack workspace and channel IDs.
- Restrict `allowedRoots`.
- Restrict `allowedRuntimes`.
- Configure approvers.
- Keep Admin API on localhost or protect it.
- Back up or rotate `~/.opentag/data` according to your team policy.

## Why does ordinary channel chat not start a task?

OpenTag avoids accidental execution. In channels, start tasks with `@OpenTag`. Ordinary thread replies can continue an existing OpenTag session.

## What should I do before production use?

- Replace wildcard workspace and channel config.
- Turn off self-approval if needed.
- Define explicit approvers.
- Confirm Slack scopes are minimal.
- Test daemon restart and logs.
- Review local audit data handling.
- Start with `mock` or read-only tasks before allowing write-capable runtimes.

