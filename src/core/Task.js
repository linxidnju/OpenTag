import { randomId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

export const TASK_SCHEMA_VERSION = "opentag.task.v1";

export function createTask({ message, session, runtimeId, runtimeSpec, channelConfig, source = null }) {
  const text = message.cleanText || message.text || "";
  const task = {
    schemaVersion: TASK_SCHEMA_VERSION,
    id: randomId("task"),
    source: source || message.platform || "unknown",
    platform: message.platform || "unknown",
    workspaceId: message.workspaceId,
    channelId: message.channelId,
    threadId: message.threadId,
    messageId: message.messageId,
    eventId: message.eventId || null,
    userId: message.userId,
    sessionId: session.id,
    prompt: text,
    rawText: message.text || text,
    context: {
      files: message.files || [],
      channelType: message.channelType || null,
      isMention: Boolean(message.isMention)
    },
    runtime: runtimeId,
    runtimeType: runtimeSpec?.type || "unknown",
    tools: {
      allowed: runtimeSpec?.allowedTools || channelConfig?.toolPolicy?.allowTools || [],
      denied: channelConfig?.toolPolicy?.denyTools || []
    },
    memory: {
      enabled: channelConfig?.memory !== false
    },
    approvalRequired: Boolean(runtimeSpec?.requiresApproval || channelConfig?.policy?.requireApprovalForWriteAccess),
    status: "queued",
    createdAt: nowIso(),
    metadata: {}
  };
  validateTask(task);
  return task;
}

export function validateTask(task) {
  assertString(task?.schemaVersion, "task.schemaVersion");
  assertString(task.id, "task.id");
  assertString(task.source, "task.source");
  assertString(task.platform, "task.platform");
  assertString(task.workspaceId, "task.workspaceId");
  assertString(task.channelId, "task.channelId");
  assertString(task.threadId, "task.threadId");
  assertString(task.userId, "task.userId");
  assertString(task.sessionId, "task.sessionId");
  assertString(task.runtime, "task.runtime");
  if (typeof task.prompt !== "string") throw new Error("task.prompt must be a string");
  if (!["queued", "running", "waiting_approval", "completed", "failed", "cancelled"].includes(task.status)) {
    throw new Error(`Unsupported task.status: ${task.status}`);
  }
  return true;
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}
