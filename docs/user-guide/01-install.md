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
opentag init --project . --runtime codex --open-slack
```

Use a different runtime if needed:

```bash
opentag init --project . --runtime opencode --open-slack
opentag init --project . --runtime mock --open-slack
```

Setup writes:

```text
~/.opentag/config.json
~/.opentag/slack-app-manifest.yml
~/.opentag/.env
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

In Slack, choose **Create from manifest**.

<p align="center">
  <img src="../pic/1createapp.png" alt="Create Slack app from manifest" width="100%" />
</p>

Create an app from a manifest and import:

```text
~/.opentag/slack-app-manifest.yml
```

If Slack cannot read the local file directly, copy the file content into the manifest editor.

<p align="center">
  <img src="../pic/2manifest.png" alt="Import OpenTag Slack manifest" width="100%" />
</p>

The generated manifest is configured for Socket Mode, so local use does not require a public webhook URL.

After reviewing the manifest, install the app to the target workspace.

<p align="center">
  <img src="../pic/3install.png" alt="Install Slack app to workspace" width="100%" />
</p>

## Create Slack Tokens

OpenTag needs:

```text
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
# Optional, only for Slack native workspace search:
SLACK_USER_TOKEN=xoxp-...
```

Edit the generated env file:

```bash
$EDITOR ~/.opentag/.env
```

The `SLACK_APP_TOKEN` must be an app-level token with `connections:write`.
`SLACK_USER_TOKEN` is optional; use it only if you enable Slack native workspace search with `workspaceSearch.slackSearchEnabled=true`.

### Get `SLACK_APP_TOKEN`

Path:

```text
Slack App page
-> Basic Information
-> App-Level Tokens
-> Generate Token and Scopes
```

Use:

```text
Token Name: opentag-socket
Scope: connections:write
```

<p align="center">
  <img src="../pic/app_token.png" alt="Generate Slack app-level token" width="100%" />
</p>

Copy the generated `xapp-...` value into:

```bash
SLACK_APP_TOKEN=xapp-...
```

### Get `SLACK_BOT_TOKEN`

Path:

```text
Slack App page
-> OAuth & Permissions
-> Install to Workspace
-> Allow
-> Bot User OAuth Token
```

Copy the `xoxb-...` value into:

```bash
SLACK_BOT_TOKEN=xoxb-...
```

### Get `SLACK_SIGNING_SECRET`

Path:

```text
Slack App page
-> Basic Information
-> App Credentials
-> Signing Secret
```

<p align="center">
  <img src="../pic/sign_secret.png" alt="Find Slack signing secret" width="100%" />
</p>

Copy the signing secret into:

```bash
SLACK_SIGNING_SECRET=...
```

Do not use the Verification Token shown by Slack. OpenTag needs the Signing Secret.

## Check the Install

Run:

```bash
opentag doctor --strict
```

If you have not filled Slack tokens yet, check only local config and runtime availability:

```bash
opentag doctor --strict --offline
```

For scripts, local UI work, or issue reports, use structured output:

```bash
opentag doctor --strict --offline --json
```

When checks fail, `opentag doctor` prints a short `Next actions` list with the files or commands to fix first.

To see the current shortest setup checklist at any time:

```bash
opentag next
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

## Invite The Bot To A Channel

After installation, find your OpenTag app in Slack and add it to the target channel.

<p align="center">
  <img src="../pic/5slack.png" alt="Invite OpenTag bot to a Slack channel" width="100%" />
</p>

In the channel, type:

```text
/invite @OpenTag
```

If your Slack App is not named `OpenTag`, use the bot name you configured.

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
