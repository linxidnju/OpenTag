import { isBotOrSystemMessage } from "../gateways/slack/SlackMessageMapper.js";

export class SlackPinnedContextReader {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  async read({ client, channelId, botUserId }) {
    if (!client?.pins?.list || !channelId) return [];
    try {
      const response = await client.pins.list({ channel: channelId });
      return (response.items || []).map((item) => normalizePinnedItem(item, botUserId)).filter(Boolean);
    } catch (error) {
      this.logger?.warn?.("slack.pins_failed", { channelId, error: error.message });
      return [];
    }
  }
}

function normalizePinnedItem(item, botUserId) {
  const message = item.message || item;
  if (!message || isBotOrSystemMessage(message, { botUserId })) return null;
  return {
    type: item.type || "message",
    channelId: item.channel || message.channel,
    messageTs: message.ts || item.created,
    user: message.user || item.created_by || "unknown",
    text: String(message.text || item.comment || "").replace(/\s+/g, " ").trim(),
    permalink: message.permalink || item.permalink || null,
    files: Array.isArray(message.files) ? message.files.map((file) => ({
      id: file.id,
      name: file.name,
      title: file.title,
      mimetype: file.mimetype,
      filetype: file.filetype,
      size: file.size,
      permalink: file.permalink,
      url_private: file.url_private,
      url_private_download: file.url_private_download
    })) : []
  };
}
