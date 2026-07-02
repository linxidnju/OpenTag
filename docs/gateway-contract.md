# OpenTag Gateway Contract

OpenTag is Slack-first, but the core should not become Slack-only. New channel
gateways must translate their platform into the same internal contract instead
of bypassing task, policy, runtime, memory, audit, and artifact handling.

## Message Normalization

A gateway turns a platform event into:

```js
{
  platform: "slack" | "discord" | "teams" | "feishu" | "wecom" | "console",
  workspaceId: "workspace-or-guild-id",
  channelId: "channel-id",
  channelType: "channel" | "private_channel" | "dm" | "mpim",
  threadId: "stable-thread-or-message-id",
  messageId: "platform-message-id",
  eventId: "dedupe-event-id",
  userId: "platform-user-id",
  text: "raw visible text",
  cleanText: "text without bot mention/control syntax",
  isMention: true,
  files: []
}
```

The `threadId` is the OpenTag session boundary. A Discord adapter, for example,
must decide whether a Discord thread, channel message, or DM maps to the session
thread before calling the engine.

## Responder Contract

Gateways pass a responder to the engine:

```js
{
  sendStatus(text),
  sendText(text),
  appendToken(text),
  complete(text),
  fail(text),
  sendApproval(approval)
}
```

The responder owns platform-specific rendering: debounced message updates,
approval buttons, thread replies, file uploads, and message chunking.

## Files, Approvals, and Artifacts

- File attachments must be normalized into `message.files`; gateway-specific
  download logic should stay outside runtime adapters.
- Approval actions must round-trip through `engine.approve()` and
  `engine.denyApproval()`.
- Runtime output files remain OpenTag artifacts. Gateways can upload or link
  them, but artifact records must stay in local storage for auditability.

## Implementation Rule

Do not add platform checks to runtime adapters. Add a gateway adapter that
normalizes platform input and renders OpenTag output.
