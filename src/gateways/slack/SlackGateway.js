import { SlackThreadResponder } from "./SlackThreadResponder.js";
import { mapSlackEventToMessage, isBotOrSystemMessage } from "./SlackMessageMapper.js";

export class SlackGateway {
  constructor({ config, engine, channelStatusService, logger }) {
    this.config = config;
    this.engine = engine;
    this.channelStatusService = channelStatusService;
    this.logger = logger;
    this.app = null;
    this.botUserId = null;
  }

  async start() {
    const { App } = await importSlackBolt();
    const token = process.env[this.config.slack.botTokenEnv];
    const appToken = process.env[this.config.slack.appTokenEnv];
    const signingSecret = this.config.slack.signingSecretEnv ? process.env[this.config.slack.signingSecretEnv] : undefined;
    if (!token) throw new Error(`Missing Slack bot token env ${this.config.slack.botTokenEnv}`);
    if (this.config.slack.mode === "socket" && !appToken) throw new Error(`Missing Slack app token env ${this.config.slack.appTokenEnv}`);

    this.app = new App({
      token,
      appToken,
      signingSecret,
      socketMode: this.config.slack.mode !== "http"
    });

    this.app.error(async (error) => {
      this.logger.error("Slack Bolt error", { error: error.message, stack: error.stack });
    });

    const auth = await this.app.client.auth.test();
    this.botUserId = auth.user_id;
    this.logger.info("Slack auth ok", { botUserId: this.botUserId, team: auth.team_id });

    this.registerHandlers();

    const port = Number(process.env.PORT || this.config.slack.port || 3000);
    await this.app.start(this.config.slack.mode === "http" ? port : undefined);
    this.logger.info("OpenTag Slack gateway started", { mode: this.config.slack.mode, port: this.config.slack.mode === "http" ? port : undefined });
  }

  registerHandlers() {
    this.app.event("app_mention", async ({ event, body, client, context }) => {
      if (isBotOrSystemMessage(event, { botUserId: this.botUserId })) return;
      if (!(await this.recordSlackEventOnce({ body, event, eventType: "app_mention" }))) return;
      const message = mapSlackEventToMessage({ event, botUserId: this.botUserId, teamId: context?.teamId || body?.team_id, eventId: body?.event_id });
      message.externalThreadMessages = await this.hydrateThread({ client, channelId: message.channelId, threadTs: message.threadId });
      message.botUserId = this.botUserId;
      const responder = new SlackThreadResponder({ client, channelId: message.channelId, threadTs: message.threadId, logger: this.logger, config: this.config });
      const channelStatus = parseChannelStatusRequest(message.cleanText);
      if (channelStatus) {
        this.handleChannelStatus({ client, message, responder, ...channelStatus }).catch((error) => {
          this.logger.error("Failed to handle channel status", { error: error.message });
          void responder.fail(error.message);
        });
        return;
      }
      this.engine.handleIncomingMessage(message, responder).catch((error) => {
        this.logger.error("Failed to handle app_mention", { error: error.message });
        void responder.fail(error.message);
      });
    });

    if (this.config.slack.processThreadReplies || this.config.slack.processDirectMessages) {
      this.app.message(async ({ message, body, client, context }) => {
        if (!message || isBotOrSystemMessage(message, { botUserId: this.botUserId, ignoreEditedMessages: this.config.slack.ignoreEditedMessages })) return;
        const text = message.text || "";
        if (this.botUserId && text.includes(`<@${this.botUserId}>`)) return; // app_mention handles it

        const isDirectMessage = message.channel_type === "im" || message.channel_type === "mpim";
        const isThreadReply = Boolean(message.thread_ts);
        if (!isThreadReply && !(this.config.slack.processDirectMessages && isDirectMessage)) return;

        const mapped = mapSlackEventToMessage({ event: message, botUserId: this.botUserId, teamId: context?.teamId || body?.team_id, eventId: body?.event_id });
        const existing = await this.engine.store.findSessionByThread(mapped);
        const allowedStatuses = this.config.sessions.followupStatuses || ["active", "running", "failed", "waiting_approval"];

        // Thread replies only steer existing OpenTag sessions; direct messages may create a new personal session.
        if (!(await this.recordSlackEventOnce({ body, event: message, eventType: isDirectMessage ? "message.im" : "message" }))) return;

        mapped.externalThreadMessages = isThreadReply
          ? await this.hydrateThread({ client, channelId: mapped.channelId, threadTs: mapped.threadId })
          : [];
        mapped.botUserId = this.botUserId;
        const responder = new SlackThreadResponder({ client, channelId: mapped.channelId, threadTs: mapped.threadId, logger: this.logger, config: this.config });
        if (isThreadReply && (!existing || !allowedStatuses.includes(existing.status))) {
          const handled = await this.handleChannelStatusFollowup({ client, message: mapped, responder });
          if (handled) return;
          return;
        }
        this.engine.handleIncomingMessage({ ...mapped, isMention: isDirectMessage }, responder).catch((error) => {
          this.logger.error("Failed to handle Slack message", { error: error.message });
          void responder.fail(error.message);
        });
      });
    }

    this.app.command(this.config.slack.slashCommand || this.config.slack.commandName || "/opentag", async ({ command, ack, respond, client }) => {
      await ack();
      const channelStatus = parseSlashChannelStatus(command.text || "");
      if (channelStatus) {
        const response = await client.chat.postMessage({
          channel: command.channel_id,
          text: `正在整理频道状态：${channelStatus.topic || "open items"}`
        });
        const responder = new SlackThreadResponder({ client, channelId: command.channel_id, threadTs: response.ts, logger: this.logger, config: this.config });
        await this.handleChannelStatus({
          client,
          message: {
            workspaceId: command.team_id || "unknown",
            channelId: command.channel_id,
            threadId: response.ts
          },
          responder,
          ...channelStatus
        });
        return;
      }
      const responder = responderFromSlashCommand({ respond });
      await this.engine.handleSlashCommand({
        platform: "slack",
        workspaceId: command.team_id || "unknown",
        channelId: command.channel_id,
        userId: command.user_id,
        text: command.text || "help",
        responder
      });
    });

    this.app.action("opentag_approve", async ({ ack, body, action, client }) => {
      await ack();
      const { approvalId } = parseActionValue(action.value);
      const responder = responderFromAction({ body, client, logger: this.logger, config: this.config });
      await updateActionMessage({ body, client, logger: this.logger, text: "已确认，OpenTag 正在处理。" });
      await this.engine.approve(approvalId, body.user.id, responder);
    });

    this.app.action("opentag_deny", async ({ ack, body, action, client }) => {
      await ack();
      const { approvalId } = parseActionValue(action.value);
      const responder = responderFromAction({ body, client, logger: this.logger, config: this.config });
      await updateActionMessage({ body, client, logger: this.logger, text: "已拒绝，本次执行已停止。" });
      await this.engine.denyApproval(approvalId, body.user.id, responder);
    });

    this.app.action("opentag_cancel_session", async ({ ack, body, action, client }) => {
      await ack();
      const { sessionId } = parseActionValue(action.value);
      const responder = responderFromAction({ body, client, logger: this.logger, config: this.config });
      await updateActionMessage({ body, client, logger: this.logger, text: "已取消这个 OpenTag 会话。" });
      await this.engine.cancelSession(sessionId, `cancelled from Slack by ${body.user.id}`);
      await responder.sendText("已取消。");
    });
  }

  async handleChannelStatus({ client, message, responder, topic, days, maxThreads }) {
    if (!this.channelStatusService) throw new Error("Channel status service is not available.");
    await this.channelStatusService.run({
      client,
      workspaceId: message.workspaceId || "unknown",
      channelId: message.channelId,
      threadTs: message.threadId,
      topic,
      days,
      maxThreads,
      botUserId: this.botUserId,
      responder
    });
  }

  async handleChannelStatusFollowup({ client, message, responder }) {
    const reports = await this.engine.store.listChannelReports({ channelId: message.channelId, threadTs: message.threadId, limit: 1 });
    const previous = reports[0];
    if (!previous) return false;
    const followup = message.cleanText || message.text || "";
    const topic = mergeFollowupTopic(previous.topic, followup);
    await this.channelStatusService.run({
      client,
      workspaceId: message.workspaceId || "unknown",
      channelId: message.channelId,
      threadTs: message.threadId,
      topic,
      days: previous.days || null,
      maxThreads: null,
      botUserId: this.botUserId,
      responder
    });
    return true;
  }

  async hydrateThread({ client, channelId, threadTs }) {
    if (!this.config.slack.hydrateThreadContext) return [];
    if (!client?.conversations?.replies || !channelId || !threadTs) return [];
    try {
      const response = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: this.config.slack.maxHydratedMessages || 50,
        inclusive: true
      });
      const max = Number(this.config.slack.maxHydratedMessages || 50);
      return (response.messages || [])
        .filter((item) => !isBotOrSystemMessage(item, { botUserId: this.botUserId, ignoreEditedMessages: this.config.slack.ignoreEditedMessages }))
        .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))
        .slice(0, max);
    } catch (error) {
      this.logger.warn("slack.thread_hydrate_failed", { channelId, threadTs, error: error.message });
      return [];
    }
  }

  async recordSlackEventOnce({ body, event, eventType }) {
    const dedupeEnabled = this.config.slack.dedupeEvents ?? this.config.slack.enableEventDedupe ?? true;
    if (!dedupeEnabled) return true;
    const eventId = body?.event_id || event?.client_msg_id || `${eventType}:${event?.channel}:${event?.ts}`;
    const result = await this.engine.store.recordIncomingEvent({ eventId, platform: "slack", type: eventType, teamId: body?.team_id, eventTs: event?.ts });
    if (!result.firstSeen) {
      this.logger.info("Ignoring duplicate Slack event", { eventId, eventType });
      return false;
    }
    return true;
  }
}

function parseChannelStatusRequest(text) {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();
  const channelIntent = /(from|in|this)\s+(the\s+)?channel|频道|整个频道/.test(lower);
  const statusIntent = /open items?|what'?s still open|where are we|status|summary|summari[sz]e|待办|进展|状态|总结|整理/.test(lower);
  if (!channelIntent || !statusIntent) return null;
  const days = numberAfter(value, /(?:last|最近)\s+(\d+)\s*(?:days?|天)/i);
  const maxThreads = numberAfter(value, /(?:max|最多)\s+(\d+)\s*(?:threads?|个)?/i);
  return { topic: extractTopic(value), days, maxThreads };
}

function parseSlashChannelStatus(text) {
  const match = String(text || "").trim().match(/^(?:channel-summary|channel-status|频道总结|频道状态)\s*([\s\S]*)$/i);
  if (!match) return null;
  return { topic: extractTopic(match[1] || "") };
}

function extractTopic(text) {
  let value = String(text || "").trim();
  const chineseAbout = value.match(/(?:在|关于)\s*([^，。？！?]+?)(?:方面)?(?:进展如何|进展|状态|待办|还有哪些|整理|总结)/);
  if (chineseAbout?.[1]) return chineseAbout[1].trim();
  const about = value.match(/\babout\s+([\s\S]+?)(?:\s+from\s+this\s+channel|\s+in\s+this\s+channel|$)/i);
  if (about?.[1]) value = about[1];
  value = value
    .replace(/^where are we on\s+/i, "")
    .replace(/^summari[sz]e\s+(?:open\s+items?\s+)?(?:about\s+)?/i, "")
    .replace(/pull together what'?s still open (?:from|in) this channel\.?/i, "")
    .replace(/(?:from|in)\s+this\s+channel\.?/i, "")
    .replace(/这个频道|整个频道|还有哪些|待完成|待办|整理一下|总结一下|进展如何/g, "")
    .trim();
  return value || "open items";
}

function numberAfter(text, regex) {
  const match = String(text || "").match(regex);
  return match?.[1] ? Number(match[1]) : null;
}

function mergeFollowupTopic(previousTopic, followup) {
  const clean = String(followup || "")
    .replace(/^(also|and|plus|include|fold in|把|也|再|顺便|一起)\s*/i, "")
    .replace(/也一起|一起包含|也包括|也加上|加进去|包含进来|纳入/g, "")
    .trim();
  if (!clean) return previousTopic || "open items";
  if (!previousTopic || previousTopic === "open items") return clean;
  return `${previousTopic} ${clean}`;
}

async function importSlackBolt() {
  try {
    return await import("@slack/bolt");
  } catch (error) {
    throw new Error(`@slack/bolt is not installed. Run \`npm install\` first. Original error: ${error.message}`);
  }
}

function parseActionValue(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function responderFromSlashCommand({ respond }) {
  const send = async (text) => respond({ response_type: "ephemeral", text });
  return {
    sendText: send,
    sendStatus: send,
    complete: send,
    fail: async (text) => send(`:warning: ${text}`),
    appendToken: async () => {},
    sendApproval: async () => send("OpenTag needs your confirmation before continuing.")
  };
}

function responderFromAction({ body, client, logger, config }) {
  const channelId = body.channel?.id || body.container?.channel_id;
  const threadTs = body.message?.thread_ts || body.message?.ts || body.container?.message_ts;
  return new SlackThreadResponder({ client, channelId, threadTs, logger, config });
}

async function updateActionMessage({ body, client, logger, text }) {
  const channel = body.channel?.id || body.container?.channel_id;
  const ts = body.message?.ts || body.container?.message_ts;
  if (!channel || !ts) return;
  try {
    await client.chat.update({
      channel,
      ts,
      text,
      blocks: [{ type: "section", text: { type: "mrkdwn", text } }]
    });
  } catch (error) {
    logger?.warn?.("slack.action_message_update_failed", { error: error.message, channel, ts });
  }
}
