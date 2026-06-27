export function mapSlackEventToMessage({ event, botUserId, teamId, eventId }) {
  const threadId = event.thread_ts || event.ts;
  const text = event.text || "";
  return {
    platform: "slack",
    workspaceId: teamId || event.team || event.enterprise || "unknown",
    channelId: event.channel,
    threadId,
    messageId: event.client_msg_id || event.ts || eventId,
    eventId,
    userId: event.user || event.bot_id || "unknown",
    text,
    cleanText: cleanSlackText(text, botUserId),
    isMention: botUserId ? text.includes(`<@${botUserId}>`) : false,
    files: normalizeSlackFiles(event.files || []),
    channelType: event.channel_type || event.channelType || null,
    raw: event
  };
}

export function cleanSlackText(text, botUserId) {
  let out = String(text || "");
  if (botUserId) out = out.replaceAll(`<@${botUserId}>`, "");
  return out
    .replace(/<!here>|<!channel>|<!everyone>/g, "")
    .replace(/<@([A-Z0-9]+)>/g, "@$1")
    .replace(/<#([A-Z0-9]+)\|([^>]+)>/g, "#$2")
    .replace(/<#([A-Z0-9]+)>/g, "#$1")
    .replace(/<mailto:([^|>]+)\|[^>]+>/g, "$1")
    .replace(/<((?:https?|mailto):[^>|]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function isBotOrSystemMessage(message, options = {}) {
  if (!message) return true;
  const botUserId = typeof options === "string" ? options : options.botUserId;
  if (botUserId && message.user === botUserId) return true;
  if (message.bot_id || message.subtype === "bot_message") return true;
  if (message.subtype === "message_deleted") return true;
  const ignoreEditedMessages = typeof options === "object" ? options.ignoreEditedMessages : undefined;
  if (ignoreEditedMessages !== false && message.subtype === "message_changed") return true;
  return false;
}

export function normalizeSlackFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    title: file.title,
    mimetype: file.mimetype,
    filetype: file.filetype,
    size: file.size,
    url_private: file.url_private,
    permalink: file.permalink
  }));
}
