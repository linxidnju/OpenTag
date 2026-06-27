import { SlackThreadResponder } from "./SlackThreadResponder.js";
import { mapSlackEventToMessage, isBotOrSystemMessage } from "./SlackMessageMapper.js";

export class SlackGateway {
  constructor({ config, engine, logger }) {
    this.config = config;
    this.engine = engine;
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
        if (isThreadReply && (!existing || !allowedStatuses.includes(existing.status))) return;
        if (!(await this.recordSlackEventOnce({ body, event: message, eventType: isDirectMessage ? "message.im" : "message" }))) return;

        mapped.externalThreadMessages = isThreadReply
          ? await this.hydrateThread({ client, channelId: mapped.channelId, threadTs: mapped.threadId })
          : [];
        mapped.botUserId = this.botUserId;
        const responder = new SlackThreadResponder({ client, channelId: mapped.channelId, threadTs: mapped.threadId, logger: this.logger, config: this.config });
        this.engine.handleIncomingMessage({ ...mapped, isMention: isDirectMessage }, responder).catch((error) => {
          this.logger.error("Failed to handle Slack message", { error: error.message });
          void responder.fail(error.message);
        });
      });
    }

    this.app.command(this.config.slack.slashCommand || this.config.slack.commandName || "/opentag", async ({ command, ack, respond }) => {
      await ack();
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
      await this.engine.approve(approvalId, body.user.id, responder);
    });

    this.app.action("opentag_deny", async ({ ack, body, action, client }) => {
      await ack();
      const { approvalId } = parseActionValue(action.value);
      const responder = responderFromAction({ body, client, logger: this.logger, config: this.config });
      await this.engine.denyApproval(approvalId, body.user.id, responder);
    });

    this.app.action("opentag_cancel_session", async ({ ack, body, action, client }) => {
      await ack();
      const { sessionId } = parseActionValue(action.value);
      const responder = responderFromAction({ body, client, logger: this.logger, config: this.config });
      await this.engine.cancelSession(sessionId, `cancelled from Slack by ${body.user.id}`);
      await responder.sendText(`Session ${sessionId} cancelled by <@${body.user.id}>.`);
    });
  }

  async hydrateThread({ client, channelId, threadTs }) {
    if (!this.config.slack.hydrateThreadContext) return [];
    if (!client?.conversations?.replies || !channelId || !threadTs) return [];
    try {
      const response = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: this.config.slack.maxHydratedMessages || 20,
        inclusive: true
      });
      return (response.messages || []).filter((item) => !isBotOrSystemMessage(item, { ignoreEditedMessages: this.config.slack.ignoreEditedMessages }));
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
    sendApproval: async (approval) => send(`OpenTag requires approval: ${approval.reason} (${approval.id})`)
  };
}

function responderFromAction({ body, client, logger, config }) {
  const channelId = body.channel?.id || body.container?.channel_id;
  const threadTs = body.message?.thread_ts || body.message?.ts || body.container?.message_ts;
  return new SlackThreadResponder({ client, channelId, threadTs, logger, config });
}
