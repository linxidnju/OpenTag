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
    const memory = await this.loadMemory(channelConfig);
    const agentName = this.config.app.name || "OpenTag";
    const channelName = channelConfig.name || channelConfig.channelId || "unknown";
    const text = incomingMessage.cleanText || incomingMessage.text || "";
    const prompt = [
      `You are ${agentName}, an open-source channel-native AI agent gateway inspired by Claude Tag.`,
      "You are operating inside a team chat thread. Be concise, explicit about actions, and produce auditable results.",
      "Do not fabricate work. Say what you did, what changed, and what remains uncertain.",
      "Ask for approval before destructive, production-impacting, expensive, or external-write actions.",
      channelConfig.instructions ? `Channel instructions: ${channelConfig.instructions}` : "",
      "",
      `Current time: ${nowIso()}`,
      `Workspace: ${session.workspaceId}`,
      `Channel: ${channelName} (${session.channelId})`,
      `Thread: ${session.threadId}`,
      `Runtime: ${runtimeId}`,
      `Session: ${session.id}`,
      "",
      "Channel memory / notes:",
      memory || "(none)",
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
