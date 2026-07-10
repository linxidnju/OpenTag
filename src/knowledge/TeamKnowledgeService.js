import { randomId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

export const KNOWLEDGE_SCHEMA_VERSION = "opentag.knowledge.v1";
export const KNOWLEDGE_KINDS = ["fact", "decision", "convention", "preference", "procedure"];

export class TeamKnowledgeService {
  constructor({ config = {}, store, logger }) {
    this.config = {
      enabled: config.enabled !== false,
      maxContentChars: Number(config.maxContentChars || 4000),
      maxListEntries: Number(config.maxListEntries || 40),
      maxContextEntries: Number(config.maxContextEntries || 40),
      maxContextChars: Number(config.maxContextChars || 12000)
    };
    this.store = store;
    this.logger = logger;
    this.queues = new Map();
  }

  async remember({ workspaceId, channelId, channelType, text, kind = "fact", createdBy, source = null, operationId = null }) {
    this.assertEnabled();
    const content = validateContent(text, this.config.maxContentChars);
    const normalizedKind = validateKind(kind);
    const scope = scopeFor(channelType);
    const partitionChannelId = scope === "channel" ? channelId : null;
    const outcome = await this.mutatePartition({ workspaceId, scope, channelId: partitionChannelId }, async (partition) => {
      const replay = replayOperation(partition, operationId);
      if (replay) return { entry: replay, replayed: true };
      const createdAt = nowIso();
      const record = {
        id: randomId("kn"),
        schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
        workspaceId,
        channelId: partitionChannelId,
        scope,
        kind: normalizedKind,
        status: "active",
        currentVersion: 1,
        createdBy,
        createdAt,
        updatedBy: createdBy,
        updatedAt: createdAt,
        source,
        versions: [{ version: 1, content, reason: null, createdBy, createdAt, source }]
      };
      partition.records.push(record);
      recordOperation(partition, operationId, record);
      return { entry: toView(record), replayed: false };
    });
    return outcome.entry;
  }

  async listVisible({ workspaceId, channelId, channelType, statuses = ["active"], limit = this.config.maxListEntries }) {
    this.assertEnabled();
    const records = [];
    const workspace = await this.loadPartitionForRead({ workspaceId, scope: "workspace" });
    records.push(...workspace.records);
    if (scopeFor(channelType) === "channel" && channelId) {
      const channel = await this.loadPartitionForRead({ workspaceId, scope: "channel", channelId });
      records.push(...channel.records);
    }
    return records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => statuses.includes(record.status))
      .sort((a, b) => String(b.record.updatedAt).localeCompare(String(a.record.updatedAt)) || b.index - a.index)
      .slice(0, Number(limit || this.config.maxListEntries))
      .map(({ record }) => toView(record));
  }

  async listForContext(args) {
    const visible = await this.listVisible({ ...args, statuses: ["active"], limit: this.config.maxContextEntries });
    const selected = [];
    let chars = 0;
    for (const entry of visible) {
      if (chars + entry.content.length > this.config.maxContextChars) continue;
      selected.push(entry);
      chars += entry.content.length;
    }
    return selected.reverse();
  }

  async inspect({ workspaceId, channelId, channelType, knowledgeId }) {
    const visible = await this.listVisible({ workspaceId, channelId, channelType, statuses: ["active", "archived"], limit: Number.MAX_SAFE_INTEGER });
    return visible.find((entry) => entry.id === knowledgeId) || null;
  }

  async loadPartitionForRead(key) {
    try {
      return await this.store.getKnowledgePartition(key);
    } catch (error) {
      this.logger?.error?.("knowledge.partition_read_failed", { ...key, error: error.message });
      return { records: [], operations: {} };
    }
  }

  async mutatePartition(key, mutation) {
    const queueKey = partitionKey(key);
    const next = (this.queues.get(queueKey) || Promise.resolve()).catch(() => {}).then(async () => {
      const partition = await this.store.getKnowledgePartition(key);
      const result = await mutation(partition);
      await this.store.saveKnowledgePartition({ ...key, partition });
      return result;
    });
    this.queues.set(queueKey, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(queueKey) === next) this.queues.delete(queueKey);
    }
  }

  assertEnabled() {
    if (!this.config.enabled) throw new Error("Team Knowledge is disabled.");
  }
}

function partitionKey({ workspaceId, scope, channelId }) {
  return `${workspaceId}:${scope}:${channelId || "workspace"}`;
}

function scopeFor(channelType) {
  return isPrivateChannelType(channelType) ? "channel" : "workspace";
}

export function isPrivateChannelType(channelType) {
  return ["group", "mpim", "im", "private"].includes(String(channelType || "").toLowerCase());
}

function validateContent(value, maxChars) {
  const content = String(value || "").trim();
  if (!content) throw new Error("Knowledge content is required.");
  if (content.length > maxChars) throw new Error(`Knowledge content exceeds ${maxChars} characters.`);
  return content;
}

function validateKind(value) {
  const kind = String(value || "fact").toLowerCase();
  if (!KNOWLEDGE_KINDS.includes(kind)) throw new Error(`Unsupported knowledge kind: ${kind}`);
  return kind;
}

function currentVersion(record) {
  return record.versions.find((version) => version.version === record.currentVersion) || record.versions.at(-1);
}

export function toKnowledgeView(record) {
  return toView(record);
}

function toView(record) {
  const current = currentVersion(record);
  return { ...record, content: current?.content || "", text: current?.content || "" };
}

function replayOperation(partition, operationId) {
  const replay = operationId ? partition.operations?.[operationId] : null;
  if (!replay) return null;
  const record = partition.records.find((item) => item.id === replay.knowledgeId);
  return record ? toView(record) : null;
}

function recordOperation(partition, operationId, record) {
  if (!operationId) return;
  partition.operations[operationId] = { knowledgeId: record.id, version: record.currentVersion };
}
