import { isBotOrSystemMessage } from "../gateways/slack/SlackMessageMapper.js";
import { SlackPinnedContextReader } from "../slack/SlackPinnedContextReader.js";

export class SlackChannelScanner {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.pinnedReader = new SlackPinnedContextReader({ config, logger });
  }

  async scan({ client, channelId, topic, days = null, maxThreads = null, botUserId = null, onProgress = null }) {
    const options = this.config.channelStatus || {};
    const maxAgeDays = Number(days || options.defaultDays || 14);
    const threadLimit = Number(maxThreads || options.maxThreads || 50);
    const messageLimit = Number(options.historyPageLimit || 100);
    const cutoffTs = String(Math.floor((Date.now() - maxAgeDays * 24 * 60 * 60 * 1000) / 1000));
    const roots = [];
    let cursor = undefined;

    await onProgress?.(`正在读取频道最近 ${maxAgeDays} 天的消息...`);
    while (roots.length < threadLimit) {
      const response = await client.conversations.history({
        channel: channelId,
        limit: messageLimit,
        cursor,
        oldest: cutoffTs,
        inclusive: true
      });
      for (const message of response.messages || []) {
        if (isBotOrSystemMessage(message, { botUserId })) continue;
        if (message.thread_ts && message.thread_ts !== message.ts) continue;
        roots.push(message);
        if (roots.length >= threadLimit) break;
      }
      cursor = response.response_metadata?.next_cursor;
      if (!cursor || !response.has_more) break;
    }

    await onProgress?.(`已找到 ${roots.length} 个候选 thread，正在读取回复...`);
    const threads = [];
    for (const root of roots) {
      const threadTs = root.thread_ts || root.ts;
      const replies = await this.fetchReplies({ client, channelId, threadTs, root, botUserId });
      const permalink = await this.getPermalink({ client, channelId, messageTs: threadTs });
      threads.push({
        channelId,
        threadTs,
        permalink,
        replyCount: Math.max(0, replies.length - 1),
        latestTs: latestTs(replies) || threadTs,
        messages: replies.map(normalizeMessage)
      });
    }

    await onProgress?.("正在读取频道 pinned items...");
    const pinnedItems = await this.pinnedReader.read({ client, channelId, botUserId });
    for (const pin of pinnedItems) {
      if (!pin.permalink && pin.messageTs) pin.permalink = await this.getPermalink({ client, channelId, messageTs: pin.messageTs });
    }

    return {
      channelId,
      topic: topic || "",
      days: maxAgeDays,
      maxThreads: threadLimit,
      scannedAt: new Date().toISOString(),
      threads,
      pinnedItems
    };
  }

  async fetchReplies({ client, channelId, threadTs, root, botUserId }) {
    if (!root.reply_count && (!root.thread_ts || root.thread_ts === root.ts)) return [root];
    try {
      const response = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: this.config.channelStatus?.maxRepliesPerThread || 50,
        inclusive: true
      });
      return (response.messages || []).filter((message) => !isBotOrSystemMessage(message, { botUserId }));
    } catch (error) {
      this.logger?.warn?.("channel_scan.replies_failed", { channelId, threadTs, error: error.message });
      return [root];
    }
  }

  async getPermalink({ client, channelId, messageTs }) {
    try {
      const response = await client.chat.getPermalink({ channel: channelId, message_ts: messageTs });
      return response.permalink || null;
    } catch (error) {
      this.logger?.warn?.("channel_scan.permalink_failed", { channelId, messageTs, error: error.message });
      return null;
    }
  }
}

function normalizeMessage(message) {
  return {
    ts: message.ts,
    user: message.user || message.bot_id || "unknown",
    text: String(message.text || "").replace(/\s+/g, " ").trim(),
    replyCount: message.reply_count || 0
  };
}

function latestTs(messages) {
  return messages.map((message) => message.ts).filter(Boolean).sort().at(-1);
}
