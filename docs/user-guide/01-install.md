# Install OpenTag

This guide installs OpenTag as a local Slack-connected daemon.

## Requirements

- Node.js `20.11.0` or newer.
- npm.
- A Slack workspace where you can create or install an app.
- A local agent runtime if you want real agent execution:
  - `codex` for Codex.
  - `opencode` for OpenCode.
  - `openclaw` for OpenClaw.
  - `hermes` for Hermes.
- Git, if the project you bind is a Git repository.

You can test OpenTag without a real runtime by using `mock`.

## Install the CLI

From the OpenTag repository:

```bash
npm install
npm link
```

Check that the CLI is available:

```bash
opentag help
```

## Run Local Setup

Bind OpenTag to the current project and select a runtime:

```bash
opentag setup --local --project . --runtime codex --open-slack
```

Use a different runtime if needed:

```bash
opentag setup --local --project . --runtime opencode --open-slack
opentag setup --local --project . --runtime mock --open-slack
```

Setup writes:

```text
~/.opentag/config.json
~/.opentag/slack-app-manifest.yml
~/.opentag/.env.example
.opentag/project.json in the project directory
```

It also writes a copy of the generated Slack manifest to:

```text
examples/slack-app-manifest.generated.yml
```

## Create the Slack App

Open Slack app creation:

```bash
opentag slack open
```

Create an app from a manifest and import:

```text
~/.opentag/slack-app-manifest.yml
```

The generated manifest is configured for Socket Mode, so local use does not require a public webhook URL.

## Create Slack Tokens

OpenTag needs:

```text
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
# Optional, only for Slack native workspace search:
SLACK_USER_TOKEN=xoxp-...
```

Copy the env example:

```bash
cp ~/.opentag/.env.example ~/.opentag/.env
$EDITOR ~/.opentag/.env
```

The `SLACK_APP_TOKEN` must be an app-level token with `connections:write`.
`SLACK_USER_TOKEN` is optional; use it only if you enable Slack native workspace search with `workspaceSearch.slackSearchEnabled=true`.

## Check the Install

Run:

```bash
opentag doctor --strict
```

If you have not filled Slack tokens yet, check only local config and runtime availability:

```bash
opentag doctor --strict --offline
```

You can also verify the Slack bot token:

```bash
opentag slack test
```

## Start OpenTag

Start the local daemon:

```bash
opentag daemon start
```

Check status:

```bash
opentag daemon status
```

Read logs:

```bash
opentag daemon logs
```

Stop it:

```bash
opentag daemon stop
```

## Keep the Daemon Running

On macOS:

```bash
opentag daemon install
launchctl load ~/Library/LaunchAgents/com.opentag.daemon.plist
```

On Linux:

```bash
opentag daemon install
systemctl --user enable --now opentag.service
```
