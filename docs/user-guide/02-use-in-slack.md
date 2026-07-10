# Use OpenTag in Slack

After the daemon is running and the Slack app is installed, invite the OpenTag bot to a channel:

```text
/invite @OpenTag
```

## Start a Task

Mention OpenTag in a channel:

```text
@OpenTag summarize this thread and list open decisions
```

OpenTag creates or continues a session for that Slack thread. Replies stay in the same thread so the team can review the work.

## Continue a Thread

After OpenTag has joined a thread, normal replies in that thread can continue the existing session when thread processing is enabled.

Example:

```text
Now check whether the README explains this setup clearly.
```

OpenTag does not start new tasks from ordinary channel messages. Use an `@OpenTag` mention to create a new task.

## Use Direct Messages

If direct messages are enabled in the config, you can DM OpenTag:

```text
Summarize the current project and tell me what command starts it.
```

DMs create personal sessions.

## Slash Commands

Use:

```text
/opentag help
/opentag runtimes
/opentag sessions
/opentag approvals
/opentag status <session_id>
/opentag cancel <session_id>
```

Inside a thread, these are useful:

```text
/opentag status
/opentag context
/opentag runtimes
```

## Choose a Runtime From Slack

You can request a runtime override:

```text
/runtime codex inspect the repo and propose the next test to add
```

The runtime must be allowed by the channel config.

## Maintain Shared Team Knowledge

Team Knowledge lets teammates explicitly save and correct facts that future threads and every configured runtime can reuse.

| Action | English | 中文 |
|---|---|---|
| Save | `remember decision: ship Friday` | `记住决定：周五发布` |
| Correct | `correct kn_123: ship Monday` | `纠正 kn_123：周一发布` |
| List | `knowledge` | `查看知识` |
| Inspect | `knowledge kn_123` | `查看知识 kn_123` |
| Archive | `archive knowledge kn_123` | `归档 kn_123` |
| Restore | `restore knowledge kn_123` | `恢复 kn_123` |
| Permanently delete | `forget memory kn_123` | `忘记 kn_123` |

Knowledge saved in a public channel becomes workspace knowledge. Knowledge saved in a private channel, group DM, or DM remains visible only in that private channel, together with workspace knowledge. Corrections append versions instead of overwriting history.

Archive is reversible and removes a record from runtime context. Forget permanently deletes its readable content. Team Knowledge v1 only stores explicit human commands; it does not automatically extract organizational facts from conversations.

## Approvals

Some requests may require approval before execution, especially if the selected runtime can write files or the request matches risky patterns such as:

```text
deploy
production
delete
push
```

When approval is required, OpenTag posts Slack buttons:

```text
Approve once
Deny
Cancel session
```

Approvals only work when Slack interactivity is enabled for the app.

## Good Request Patterns

Use specific, reviewable tasks:

```text
@OpenTag read the recent thread and write a short implementation checklist.
```

```text
@OpenTag inspect the repo and explain which tests cover Slack message mapping.
```

```text
@OpenTag propose a patch plan only. Do not edit files yet.
```

For write tasks, say what success looks like:

```text
@OpenTag update the user guide so setup and daemon commands match the current CLI, then run the docs check if available.
```

## What OpenTag Sees

Depending on config, OpenTag can include:

- The current Slack message.
- Recent thread context.
- Channel instructions.
- Shared, scoped Team Knowledge with the latest active version and provenance.
- Runtime contract.
- The bound local project path.

Do not paste secrets into Slack. OpenTag stores events, messages, approvals, runs, and audit records locally.
