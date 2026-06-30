# Troubleshooting

## Check Everything First

Run:

```bash
opentag doctor
```

For strict validation:

```bash
opentag doctor --strict
```

If Slack tokens are not ready yet:

```bash
opentag doctor --strict --offline
```

For machine-readable diagnostics:

```bash
opentag doctor --strict --offline --json
```

Use the `Next actions` section from plain doctor output as the shortest recovery checklist.

## The CLI Is Not Found

Run from the repository:

```bash
npm install
npm link
opentag help
```

If `npm link` is not desired, run with Node:

```bash
node ./bin/opentag.mjs help
```

## Slack Token Checks Fail

Open:

```bash
~/.opentag/.env
```

Check:

```text
SLACK_BOT_TOKEN starts with xoxb-
SLACK_APP_TOKEN starts with xapp-
SLACK_SIGNING_SECRET is filled
```

Then:

```bash
opentag slack test
```

## Slack Does Not Trigger OpenTag

Check:

- The daemon is running: `opentag daemon status`.
- The bot is invited to the channel.
- The Slack app has Socket Mode enabled.
- The app subscribes to `app_mention`, `message.channels`, `message.groups`, `message.im`, and `message.mpim`.
- You used `@OpenTag` to start a new channel task.
- You are replying in a thread that already has an OpenTag session.

Read daemon logs:

```bash
opentag daemon logs
```

## Approval Buttons Do Not Work

Check Slack app interactivity.

Socket Mode still requires interactivity to be enabled in Slack app settings. If interactivity is disabled, OpenTag can post the approval request but Slack will not deliver button actions.

## Runtime Is Missing

Run:

```bash
opentag runtime list
```

If `codex` is missing, install Codex and make sure it is on `PATH`.

Switch to mock to confirm OpenTag itself is working:

```bash
opentag runtime set mock
opentag daemon restart
```

## Codex Uses the Wrong Project

List projects:

```bash
opentag project list
```

Rebind the intended project:

```bash
opentag init --project /path/to/project --runtime codex
opentag daemon restart
```

Check:

```bash
cat ~/.opentag/config.json
```

## Config Changed but Slack Behavior Did Not

Restart the daemon:

```bash
opentag daemon restart
```

OpenTag reads the config when the daemon starts.

## Daemon Will Not Stay Running

Read logs:

```bash
opentag daemon logs --lines 200
```

Common causes:

- Missing Slack env vars.
- Invalid Slack token.
- Missing runtime CLI.
- Invalid config JSON.
- Project path does not exist.

## Reset Local OpenTag State

Stop the daemon first:

```bash
opentag daemon stop
```

Then inspect:

```bash
ls ~/.opentag
```

Only remove files when you are sure you do not need the local sessions, audit logs, config, or project bindings.
