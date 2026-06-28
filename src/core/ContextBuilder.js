import { readFile } from "node:fs/promises";
import { redact } from "../utils/redact.js";
import { nowIso } from "../utils/time.js";

export class ContextBuilder {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
  }

  async build({ session, incomingMessage, channelConfig, runtimeId }) {
    const limit = this.config.sessions.maxContextMessages || 24;
    const messages = await this.store.listMessages(session.id, { limit });
    const storedContext = messages.map(formatMessage).join("\n");
    const hydrated = formatHydratedMessages(incomingMessage.externalThreadMessages || incomingMessage.contextMessages || [], incomingMessage.botUserId);
    const files = formatDownloadedFiles(incomingMessage.downloadedFiles || []);
    const pinned = formatPinnedItems(incomingMessage.pinnedItems || []);
    const channelMemory = formatChannelMemory(incomingMessage.channelMemory || []);
    const channelHistoryCount = Array.isArray(incomingMessage.channelHistoryMessages) ? incomingMessage.channelHistoryMessages.length : 0;
    const channelHistory = formatChannelHistory(incomingMessage.channelHistoryMessages || [], {
      botUserId: incomingMessage.botUserId,
      limit: this.config.workspaceSearch?.maxPromptChannelHistoryMessages || 20
    });
    const searchHits = formatWorkspaceSearchHits(incomingMessage.workspaceSearchHits || []);
    const memory = await this.loadMemory(channelConfig);
    const agentName = this.config.app.name || "OpenTag";
    const channelName = channelConfig.name || channelConfig.channelId || "unknown";
    const text = incomingMessage.cleanText || incomingMessage.text || "";
    const prompt = [
      `You are ${agentName}, an open-source channel-native AI agent gateway inspired by Claude Tag.`,
      "You are operating inside a team chat thread. Be concise, explicit about actions, and produce auditable results.",
      "Reply in the user's language. Keep Slack replies short: usually 1-4 concise sentences or bullets unless the user asks for detail.",
      "Do not fabricate work. Say what you did, what changed, and what remains uncertain.",
      "Ask for approval before destructive, production-impacting, expensive, or external-write actions.",
      "If sandbox or allowed-roots policy blocks a requested file operation, explain that OpenTag is not authorized for that path. Do not suggest a destructive local shell command for the user to run manually.",
      channelConfig.instructions ? `Channel instructions: ${channelConfig.instructions}` : "",
      "",
      `Current time: ${nowIso()}`,
      `Workspace: ${session.workspaceId}`,
      `Channel: ${channelName} (${session.channelId})`,
      `Thread: ${session.threadId}`,
      `Runtime: ${runtimeId}`,
      `Session: ${session.id}`,
      `Sandbox outputs directory: ${incomingMessage.sandboxOutputDir || "(runtime sandbox outputs/)"}`,
      "When creating charts, reports, CSVs, or documents, write final files into the sandbox outputs directory so OpenTag can upload them back to Slack.",
      incomingMessage.agentProxy?.enabled
        ? `Agent Proxy: use POST ${incomingMessage.agentProxy.url} with Bearer token from OPENTAG_AGENT_PROXY_TOKEN for external HTTP/API access. Do not embed credentials in prompts or direct shell commands.`
        : "Agent Proxy: unavailable for this run.",
      "",
      "Channel memory / notes:",
      memory || "(none)",
      "",
      "OpenTag saved channel/workspace memory:",
      channelMemory || "(none)",
      "",
      "Pinned channel context:",
      pinned || "(none)",
      "",
      "Downloaded Slack files for this run:",
      files || "(none)",
      "",
      `Recent channel history loaded into local index: ${channelHistoryCount} message${channelHistoryCount === 1 ? "" : "s"}`,
      channelHistory || "(no recent channel history available)",
      "",
      "Workspace search hits:",
      searchHits || "(none)",
      "",
      "Hydrated Slack thread context:",
      hydrated || "(not available)",
      "",
      "Stored OpenTag thread context:",
      storedContext || "(no previous OpenTag messages)",
      "",
      "Current user request:",
      text
    ].filter((line) => line !== "").join("\n");
    const redacted = this.config.security.redactSecrets ? redact(prompt) : prompt;
    return truncatePrompt(redacted, this.config.sessions.maxPromptChars || 60000);
  }

  async loadMemory(channelConfig) {
    const blocks = [];
    if (channelConfig.memoryNotes) blocks.push(String(channelConfig.memoryNotes));
    if (channelConfig.memory?.notes) blocks.push(String(channelConfig.memory.notes));
    const files = [
      ...(channelConfig.memoryFiles || []),
      ...arrayify(channelConfig.memory?.files),
      channelConfig.memory?.channelNotesPath,
      channelConfig.memory?.channel_notes_path
    ].filter(Boolean);
    for (const filePath of files) {
      try {
        const raw = await readFile(filePath, "utf8");
        blocks.push(`From ${filePath}:\n${raw.slice(0, 12000)}`);
      } catch (error) {
        this.logger?.warn?.("memory.read_failed", { filePath, error: error.message });
      }
    }
    return blocks.join("\n\n").trim();
  }
}

function formatHydratedMessages(messages, botUserId) {
  return messages.map((message) => {
    const role = message.user === botUserId || message.bot_id ? "assistant/bot" : "user";
    const user = message.user || message.bot_id || "unknown";
    const text = String(message.text || "").replace(/\s+/g, " ").trim();
    const files = formatFiles(message.files || []);
    return `- ${role} ${user} @ ${message.ts || message.createdAt || message.messageId || "unknown"}: ${text || "(no text)"}${files ? ` [files: ${files}]` : ""}`;
  }).join("\n");
}

function formatMessage(message) {
  const role = message.role || "user";
  const user = message.userId ? ` ${message.userId}` : "";
  const text = String(message.text || "").replace(/\s+/g, " ").trim();
  const files = formatFiles(message.files || []);
  return `- ${role}${user}: ${text || "(no text)"}${files ? ` [files: ${files}]` : ""}`;
}

function formatFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return "";
  return files.map((file) => {
    if (typeof file === "string") return file;
    const name = file.name || file.title || file.id || "file";
    const type = file.mimetype || file.filetype || file.mode || "unknown";
    const size = file.size ? `, ${file.size} bytes` : "";
    const url = file.url_private || file.permalink || file.url || "";
    return `${name} (${type}${size})${url ? ` ${url}` : ""}`;
  }).join("; ");
}

function formatDownloadedFiles(files) {
  return files.map((file) => {
    if (file.status !== "downloaded") return `- ${file.name || file.title || file.id}: ${file.status || "skipped"} (${file.reason || "not available"})`;
    const preview = file.textPreview ? `\n  preview: ${String(file.textPreview).replace(/\s+/g, " ").slice(0, 1000)}` : "";
    return `- ${file.name || file.title || file.id}: ${file.relativePath || file.path} (${file.mimetype || file.filetype || "unknown"}, ${file.size || 0} bytes)${preview}`;
  }).join("\n");
}

function formatPinnedItems(items) {
  return items.map((item) => {
    const source = item.permalink ? ` source=${item.permalink}` : "";
    const files = item.files?.length ? ` files=${item.files.map((file) => file.name || file.title || file.id).join(", ")}` : "";
    return `- ${item.user || "unknown"} @ ${item.messageTs || "unknown"}: ${item.text || "(no text)"}${files}${source}`;
  }).join("\n");
}

function formatChannelMemory(entries) {
  return entries.map((entry) => `- ${entry.id || "memory"} [${entry.scope || "memory"}]: ${String(entry.text || "").replace(/\s+/g, " ").trim()}`).join("\n");
}

function formatChannelHistory(messages, { botUserId, limit }) {
  const items = (messages || [])
    .filter((message) => message.text)
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
    .slice(0, Number(limit || 20))
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  return items.map((message) => {
    const role = message.user === botUserId || message.bot_id ? "assistant/bot" : "user";
    const user = message.user || message.bot_id || "unknown";
    const text = String(message.text || "").replace(/\s+/g, " ").trim().slice(0, 500);
    const source = message.permalink ? ` source=${message.permalink}` : "";
    return `- ${role} ${user} @ ${message.ts || "unknown"}: ${text}${source}`;
  }).join("\n");
}

function formatWorkspaceSearchHits(hits) {
  return hits.map((hit) => {
    const source = hit.source ? ` source=${hit.source}` : "";
    const file = hit.filePath ? ` file=${hit.relativePath || hit.filePath}` : "";
    return `- ${hit.type || "hit"}: ${String(hit.text || "").replace(/\s+/g, " ").slice(0, 1000)}${file}${source}`;
  }).join("\n");
}

function arrayify(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function truncatePrompt(prompt, maxChars) {
  const value = String(prompt || "");
  if (!maxChars || value.length <= maxChars) return value;
  const head = value.slice(0, Math.floor(maxChars * 0.25));
  const tail = value.slice(value.length - Math.floor(maxChars * 0.7));
  return `${head}\n\n...[middle context truncated by OpenTag maxPromptChars=${maxChars}]...\n\n${tail}`;
}
