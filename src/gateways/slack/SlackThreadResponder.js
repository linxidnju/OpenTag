export class SlackThreadResponder {
  constructor({ client, channelId, threadTs, logger, config }) {
    this.client = client;
    this.channelId = channelId;
    this.threadTs = threadTs;
    this.logger = logger;
    this.config = config;
    this.statusTs = null;
    this.streamBuffer = "";
    this.flushTimer = null;
    this.maxMessageChars = Math.min(config.slack.maxMessageChars || 3900, 3900);
    this.streamUpdateMs = config.slack.streamUpdateMs || 1500;
    this.quietStatus = config.slack.quietStatus !== false;
  }

  async sendStatus(text) {
    if (this.quietStatus) {
      const quietText = formatStatus(text);
      if (!quietText) return;
      return this.upsertResponse(quietText);
    }
    const body = { channel: this.channelId, thread_ts: this.threadTs, text: truncate(text, this.maxMessageChars) };
    if (!this.statusTs) {
      const response = await this.callSlack(() => this.client.chat.postMessage(body));
      this.statusTs = response?.ts || null;
    } else {
      await this.callSlack(() => this.client.chat.update({ ...body, ts: this.statusTs }));
    }
  }

  async sendText(text) {
    for (const chunk of chunkText(text, this.maxMessageChars)) {
      await this.callSlack(() => this.client.chat.postMessage({ channel: this.channelId, thread_ts: this.threadTs, text: chunk }));
    }
  }

  async appendToken(text) {
    if (!text) return;
    this.streamBuffer += text;
    if (this.streamBuffer.length > this.maxMessageChars * 0.8) {
      await this.flushStream();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushStream().catch((error) => this.logger.error("Slack stream flush failed", { error: error.message }));
      }, this.streamUpdateMs);
      this.flushTimer.unref?.();
    }
  }

  async flushStream() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.streamBuffer) return;
    await this.upsertResponse(this.streamBuffer);
  }

  async complete(text) {
    await this.flushStream();
    const final = text && text.trim() ? text : "OpenTag completed.";
    if (this.statusTs && final.length <= this.maxMessageChars) {
      await this.callSlack(() => this.client.chat.update({ channel: this.channelId, ts: this.statusTs, thread_ts: this.threadTs, text: final }));
    } else {
      await this.sendText(final);
    }
  }

  async fail(text) {
    await this.flushStream();
    await this.sendText(`:warning: ${formatFailure(text)}`);
  }

  async sendApproval(approval) {
    const value = JSON.stringify({ approvalId: approval.id, sessionId: approval.sessionId });
    await this.callSlack(() => this.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: this.threadTs,
      text: "OpenTag needs your confirmation before continuing.",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*需要确认后继续*\n这个任务会交给本地 agent 执行，可能读取仓库或运行命令。` } },
        { type: "actions", elements: [
          { type: "button", action_id: "opentag_approve", style: "primary", text: { type: "plain_text", text: "允许本次执行" }, value },
          { type: "button", action_id: "opentag_deny", style: "danger", text: { type: "plain_text", text: "Deny" }, value },
          { type: "button", action_id: "opentag_cancel_session", text: { type: "plain_text", text: "Cancel session" }, value }
        ] }
      ]
    }));
  }

  async upsertResponse(text) {
    const body = { channel: this.channelId, thread_ts: this.threadTs, text: truncate(text, this.maxMessageChars) };
    if (!this.statusTs) {
      const response = await this.callSlack(() => this.client.chat.postMessage(body));
      this.statusTs = response?.ts || null;
    } else {
      await this.callSlack(() => this.client.chat.update({ ...body, ts: this.statusTs }));
    }
  }

  async callSlack(fn, attempt = 0) {
    try {
      return await fn();
    } catch (error) {
      const retryAfter = Number(error?.data?.retry_after || error?.headers?.["retry-after"] || 0);
      const retryable = attempt < 3 && (retryAfter || /rate|timeout|temporar|ECONNRESET|ETIMEDOUT/i.test(error?.message || ""));
      if (!retryable) {
        this.logger?.error?.("slack.api_failed", { error: error.message, channelId: this.channelId, threadTs: this.threadTs });
        throw error;
      }
      const delayMs = retryAfter ? retryAfter * 1000 : 500 * 2 ** attempt;
      this.logger?.warn?.("slack.api_retry", { attempt, delayMs, error: error.message });
      await delay(delayMs);
      return this.callSlack(fn, attempt + 1);
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length <= max ? value : `${value.slice(0, max - 20)}\n…[truncated]`;
}

function chunkText(text, max) {
  const value = String(text || "");
  const chunks = [];
  for (let i = 0; i < value.length; i += max) chunks.push(value.slice(i, i + max));
  return chunks.length ? chunks : [""];
}

function formatFailure(text) {
  const value = String(text || "");
  if (/Tool call denied|allowedTools|channel policy|runtime .* failed/i.test(value)) {
    return "这次执行被安全策略拦截了。详细原因已记录在 OpenTag 日志里。";
  }
  return value;
}

function formatStatus(text) {
  const value = String(text || "");
  if (/busy|queued/i.test(value)) return "这条线程还有任务在处理，我会排队执行。";
  if (/^✓\s/m.test(value)) return value;
  return "正在思考...";
}
