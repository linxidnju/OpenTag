import { randomId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

export const KNOWLEDGE_SCHEMA_VERSION = "opentag.knowledge.v1";
export const LEGACY_MEMORY_SCHEMA_VERSION = "opentag.memory.legacy";
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
    if (!outcome.replayed) await this.appendKnowledgeAudit("knowledge.created", outcome.entry, createdBy);
    return outcome.entry;
  }

  async correct({ workspaceId, channelId, channelType, knowledgeId, text, reason = null, updatedBy, source = null, operationId = null }) {
    this.assertEnabled();
    const content = validateContent(text, this.config.maxContentChars);
    let location = await this.findKnowledgeLocation({ workspaceId, channelId, channelType, knowledgeId });
    let legacy = null;
    if (!location) {
      legacy = await this.findVisibleLegacy({ workspaceId, channelId, channelType, knowledgeId });
      if (!legacy) return null;
      location = { key: keyForLegacy(legacy), materialized: legacyRecord(legacy) };
    }

    const outcome = await this.mutatePartition(location.key, async (partition) => {
      const replay = replayOperation(partition, operationId);
      if (replay) return { entry: replay, replayed: true };
      let record = partition.records.find((item) => item.id === knowledgeId);
      if (!record && location.materialized) {
        record = location.materialized;
        partition.records.push(record);
      }
      if (!record) return { entry: null, replayed: false };
      const createdAt = nowIso();
      const previousVersion = record.currentVersion;
      const nextVersion = previousVersion + 1;
      record.versions.push({ version: nextVersion, content, reason: reason ? String(reason).trim() : null, createdBy: updatedBy, createdAt, source });
      record.currentVersion = nextVersion;
      record.status = "active";
      record.updatedBy = updatedBy;
      record.updatedAt = createdAt;
      record.source = source || record.source;
      recordOperation(partition, operationId, record);
      return { entry: toView(record), replayed: false, previousVersion };
    });
    if (!outcome.entry) return null;
    if (legacy && !outcome.replayed) {
      await this.store.deleteMemoryEntry({ workspaceId, channelId, memoryId: legacy.id }).catch((error) => {
        this.logger?.warn?.("knowledge.legacy_delete_failed", { knowledgeId, error: error.message });
      });
    }
    if (!outcome.replayed) {
      await this.appendKnowledgeAudit("knowledge.corrected", outcome.entry, updatedBy, { previousVersion: outcome.previousVersion, currentVersion: outcome.entry.currentVersion });
    }
    return outcome.entry;
  }

  async archive(args) {
    return this.setStatus({ ...args, status: "archived", auditType: "knowledge.archived" });
  }

  async restore(args) {
    return this.setStatus({ ...args, status: "active", auditType: "knowledge.restored" });
  }

  async setStatus({ workspaceId, channelId, channelType, knowledgeId, actorId, operationId = null, status, auditType }) {
    this.assertEnabled();
    const location = await this.findKnowledgeLocation({ workspaceId, channelId, channelType, knowledgeId });
    if (!location) return null;
    const outcome = await this.mutatePartition(location.key, async (partition) => {
      const replay = replayOperation(partition, operationId);
      if (replay) return { entry: replay, replayed: true };
      const record = partition.records.find((item) => item.id === knowledgeId);
      if (!record) return { entry: null, replayed: false };
      record.status = status;
      record.updatedBy = actorId;
      record.updatedAt = nowIso();
      recordOperation(partition, operationId, record);
      return { entry: toView(record), replayed: false };
    });
    if (outcome.entry && !outcome.replayed) await this.appendKnowledgeAudit(auditType, outcome.entry, actorId);
    return outcome.entry;
  }

  async forget({ workspaceId, channelId, channelType, knowledgeId, actorId, operationId = null }) {
    this.assertEnabled();
    const location = await this.findKnowledgeLocation({ workspaceId, channelId, channelType, knowledgeId });
    if (location) {
      const outcome = await this.mutatePartition(location.key, async (partition) => {
        const replay = replayOperation(partition, operationId);
        if (replay) return { entry: replay, replayed: true };
        const index = partition.records.findIndex((item) => item.id === knowledgeId);
        if (index < 0) return { entry: null, replayed: false };
        const record = partition.records[index];
        const entry = toView(record);
        partition.records.splice(index, 1);
        recordOperation(partition, operationId, record, "forgotten");
        return { entry, replayed: false };
      });
      if (outcome.entry && !outcome.replayed) await this.appendKnowledgeAudit("knowledge.forgotten", outcome.entry, actorId);
      return outcome.entry;
    }

    const legacy = await this.findVisibleLegacy({ workspaceId, channelId, channelType, knowledgeId });
    if (!legacy) return null;
    const deleted = await this.store.deleteMemoryEntry({ workspaceId, channelId, memoryId: knowledgeId });
    if (!deleted) return null;
    const entry = toView(legacyRecord(legacy));
    await this.appendKnowledgeAudit("knowledge.forgotten", entry, actorId);
    return entry;
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
    const knowledgeIds = new Set(records.map((record) => record.id));
    const legacy = await this.loadLegacyForRead({ workspaceId, channelId, channelType });
    records.push(...legacy.filter((entry) => !knowledgeIds.has(entry.id)).map(legacyRecord));
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

  async findKnowledgeLocation({ workspaceId, channelId, channelType, knowledgeId }) {
    const keys = [{ workspaceId, scope: "workspace", channelId: null }];
    if (scopeFor(channelType) === "channel" && channelId) keys.push({ workspaceId, scope: "channel", channelId });
    for (const key of keys) {
      const partition = await this.store.getKnowledgePartition(key);
      if (partition.records.some((record) => record.id === knowledgeId)) return { key };
    }
    return null;
  }

  async findVisibleLegacy({ workspaceId, channelId, channelType, knowledgeId }) {
    const entries = await this.loadLegacyForRead({ workspaceId, channelId, channelType });
    return entries.find((entry) => entry.id === knowledgeId) || null;
  }

  async loadLegacyForRead({ workspaceId, channelId, channelType }) {
    try {
      return await this.store.listMemoryEntries({
        workspaceId,
        channelId,
        includeWorkspace: true,
        includeChannel: scopeFor(channelType) === "channel",
        limit: null
      });
    } catch (error) {
      this.logger?.error?.("knowledge.legacy_read_failed", { workspaceId, channelId, error: error.message });
      return [];
    }
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

  async appendKnowledgeAudit(type, entry, actorId, details = {}) {
    try {
      await this.store.appendAudit({
        type,
        knowledgeId: entry.id,
        workspaceId: entry.workspaceId,
        channelId: entry.channelId,
        scope: entry.scope,
        actorId,
        currentVersion: entry.currentVersion,
        ...details
      });
    } catch (error) {
      this.logger?.error?.("knowledge.audit_append_failed", { type, knowledgeId: entry.id, error: error.message });
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

function keyForLegacy(entry) {
  return { workspaceId: entry.workspaceId, scope: entry.scope, channelId: entry.scope === "channel" ? entry.channelId : null };
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

function legacyRecord(entry) {
  const createdAt = entry.createdAt || nowIso();
  const updatedAt = entry.updatedAt || createdAt;
  return {
    id: entry.id,
    schemaVersion: LEGACY_MEMORY_SCHEMA_VERSION,
    workspaceId: entry.workspaceId,
    channelId: entry.scope === "channel" ? entry.channelId : null,
    scope: entry.scope,
    kind: "fact",
    status: "active",
    currentVersion: 1,
    createdBy: entry.createdBy,
    createdAt,
    updatedBy: entry.updatedBy || entry.createdBy,
    updatedAt,
    source: entry.source || null,
    versions: [{ version: 1, content: entry.text, reason: null, createdBy: entry.createdBy, createdAt, source: entry.source || null }]
  };
}

function currentVersion(record, version = record.currentVersion) {
  return record.versions.find((item) => item.version === version) || record.versions.at(-1);
}

export function toKnowledgeView(record) {
  return toView(record);
}

function toView(record, version = record.currentVersion, status = record.status) {
  const current = currentVersion(record, version);
  return { ...record, status, currentVersion: version, content: current?.content || "", text: current?.content || "" };
}

function replayOperation(partition, operationId) {
  const replay = operationId ? partition.operations?.[operationId] : null;
  if (!replay) return null;
  const record = partition.records.find((item) => item.id === replay.knowledgeId);
  if (!record && replay.status === "forgotten") {
    return { id: replay.knowledgeId, currentVersion: replay.version, status: "forgotten" };
  }
  return record ? toView(record, replay.version, replay.status) : null;
}

function recordOperation(partition, operationId, record, status = record.status) {
  if (!operationId) return;
  partition.operations[operationId] = { knowledgeId: record.id, version: record.currentVersion, status };
}
