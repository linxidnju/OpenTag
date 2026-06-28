# OpenTag v0.1 Troubleshooting

## `opentag doctor --strict` fails

Run the non-strict doctor first:

```bash
opentag doctor
```

Common missing items:

- `SLACK_BOT_TOKEN`: the bot token from OAuth install.
- `SLACK_APP_TOKEN`: the app-level token with `connections:write`.
- `SLACK_USER_TOKEN`: only required when `workspaceSearch.slackSearchEnabled=true`; it needs the `search:read` user scope.
- `codex`, `opencode`, `openclaw`, or `hermes`: the selected local runtime is not installed or not on `PATH`.

## Slack does not trigger OpenTag

Check that the Slack app manifest has Socket Mode enabled and includes these bot events:

```text
app_mention
message.channels
message.groups
message.im
message.mpim
```

Invite the bot to the channel, then mention it in a thread:

```text
@OpenTag summarize this thread
```

## Daemon does not stay up

Check logs:

```bash
opentag daemon logs
```

If the log says a Slack token is missing, export the token in the shell before `opentag daemon start`. For launchd or systemd installs, put those environment variables into your service manager environment.

## Codex runs in the wrong directory

Run:

```bash
opentag runtime list
cat ~/.opentag/config.json
```

The generated Codex runtime passes `--cd <project>` and `--sandbox workspace-write`. Re-run setup if the project path is stale:

```bash
opentag setup --local --project /path/to/repo --runtime codex
```
