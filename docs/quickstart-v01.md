# OpenTag v0.1 Local Quickstart

OpenTag v0.1 is the local developer edition: you create a Slack app from a generated manifest, run a local Socket Mode daemon, and route Slack threads to a local runtime such as Codex, OpenCode, OpenClaw, or Hermes.

```bash
npm install
npm link
opentag setup --local --project . --runtime codex --open-slack
```

Import the generated manifest from:

```text
~/.opentag/slack-app-manifest.yml
```

Then export Slack tokens:

```bash
cp ~/.opentag/.env.example ~/.opentag/.env
$EDITOR ~/.opentag/.env
```

Check the install and start the daemon:

```bash
opentag doctor --strict
opentag daemon start
opentag daemon status
opentag daemon logs
```

Useful commands:

```bash
opentag slack manifest --write examples/slack-app-manifest.generated.yml
opentag slack scopes
opentag slack test
opentag runtime list
opentag runtime set codex
opentag project add .
opentag project list
```

Slack channel status summary:

```text
@OpenTag summarize open items about launch prep from this channel
@OpenTag 我们在启动准备工作方面进展如何？请把这个频道中还有待完成的部分整理一下
/opentag channel-summary launch prep
```

OpenTag scans recent channel threads, builds a local thread index, extracts open / blocked / closed items, and returns a concise report with source links. It does not read Google Drive in v0.1.

Thread context follows a Claude Tag-style baseline: when OpenTag is mentioned in an existing thread, it hydrates up to 50 non-bot messages from the start of that thread. For long threads, restate critical recent context near your request.

Workspace search has two layers:

- Default: local index over threads, channel history, pins, and files OpenTag has already read.
- Optional: Slack native search across public workspace messages available to the installing user. Enable `workspaceSearch.slackSearchEnabled=true`, add the generated `search:read` user scope, and set `SLACK_USER_TOKEN=xoxp-...`.

For a local runtime/config check before Slack tokens are available:

```bash
opentag doctor --strict --offline
```

v0.1 intentionally uses Slack Socket Mode. It does not require a public webhook URL, but it still requires each user or team to create a Slack app and copy the `xoxb` and `xapp` tokens. A hosted OAuth relay is a v0.2 concern.
