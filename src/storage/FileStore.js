import path from "node:path";
import { readdir, writeFile, rm } from "node:fs/promises";
import { ensureDir, readJsonIfExists, atomicWriteJson, appendNdjson, readNdjson } from "../utils/fs.js";
import { nowIso } from "../utils/time.js";
import { randomId, threadKey } from "../utils/id.js";

export class FileStore {
  constructor({ rootDir, logger }) {
    if (!rootDir) throw new Error("FileStore requires rootDir");
    this.rootDir = path.resolve(rootDir);
    this.logger = logger;
    this.sessionsDir = path.join(this.rootDir, "sessions");
    this.messagesDir = path.join(this.rootDir, "messages");
    this.approvalsDir = path.join(this.rootDir, "approvals");
    this.eventsDir = path.join(this.rootDir, "events");
    this.runsDir = path.join(this.rootDir, "runs");
    this.artifactsDir = path.join(this.rootDir, "artifacts");
    this.threadIndexDir = path.join(this.rootDir, "thread-index");
    this.channelReportsDir = path.join(this.rootDir, "channel-reports");
    this.workspaceIndexDir = path.join(this.rootDir, "workspace-index");
    this.memoriesDir = path.join(this.rootDir, "memories");
    this.auditPath = path.join(this.rootDir, "audit.ndjson");
    this.indexPath = path.join(this.sessionsDir, "_thread-index.json");
  }

  async init() {
    await ensureDir(this.sessionsDir);
    await ensureDir(this.messagesDir);
    await ensureDir(this.approvalsDir);
    await ensureDir(this.eventsDir);
    await ensureDir(this.runsDir);
    await ensureDir(this.artifactsDir);
    await ensureDir(this.threadIndexDir);
    await ensureDir(this.channelReportsDir);
    await ensureDir(this.workspaceIndexDir);
    await ensureDir(this.memoriesDir);
  }

  sessionPath(sessionId) {
    return path.join(this.sessionsDir, `${safeName(sessionId)}.json`);
  }

  messagesPath(sessionId) {
    return path.join(this.messagesDir, `${safeName(sessionId)}.ndjson`);
  }

  approvalPath(approvalId) {
    return path.join(this.approvalsDir, `${safeName(approvalId)}.json`);
  }

  eventPath(eventId) {
    return path.join(this.eventsDir, `${safeName(eventId)}.json`);
  }

  runPath(runId) {
    return path.join(this.runsDir, `${safeName(runId)}.json`);
  }

  artifactPath(artifactId) {
    return path.join(this.artifactsDir, `${safeName(artifactId)}.json`);
  }

  threadIndexPath(channelId) {
    return path.join(this.threadIndexDir, `${safeName(channelId)}.json`);
  }

  channelReportPath(reportId) {
    return path.join(this.channelReportsDir, `${safeName(reportId)}.json`);
  }

  workspaceIndexPath(workspaceId, channelId) {
    return path.join(this.workspaceIndexDir, `${safeName(workspaceId || "unknown")}--${safeName(channelId || "unknown")}.json`);
  }

  memoryPath(workspaceId, scope, channelId = null) {
    const key = scope === "workspace" ? "workspace" : `channel-${channelId || "unknown"}`;
    return path.join(this.memoriesDir, `${safeName(workspaceId || "unknown")}--${safeName(key)}.json`);
  }

  async markEventProcessed(eventId, metadata = {}) {
    if (!eventId) return true;
    const filePath = this.eventPath(eventId);
    const record = { id: eventId, ...metadata, createdAt: nowIso() };
    try {
      await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        await ensureDir(this.eventsDir);
        return this.markEventProcessed(eventId, metadata);
      }
      if (error && error.code === "EEXIST") return false;
      throw error;
    }
  }

  async recordIncomingEvent(event) {
    const eventId = event.eventId || event.id;
    const firstSeen = await this.markEventProcessed(eventId, event);
    return { firstSeen, eventId };
  }

  async markEventSeen(eventId, metadata = {}) {
    return this.markEventProcessed(eventId, metadata);
  }

  async getSession(sessionId) {
    return readJsonIfExists(this.sessionPath(sessionId), null);
  }

  async saveSession(session) {
    const copy = { ...session, updatedAt: nowIso() };
    await atomicWriteJson(this.sessionPath(copy.id), copy);
    const index = await readJsonIfExists(this.indexPath, {});
    index[threadKey(copy)] = copy.id;
    await atomicWriteJson(this.indexPath, index);
    return copy;
  }

  async findSessionByThread({ platform, workspaceId, channelId, threadId }) {
    const index = await readJsonIfExists(this.indexPath, {});
    const id = index[threadKey({ platform, workspaceId, channelId, threadId })];
    if (!id) return null;
    return this.getSession(id);
  }

  async listSessions({ workspaceId = null, channelId = null, status = null, limit = null } = {}) {
    const names = await readdir(this.sessionsDir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.startsWith("_")) continue;
      const session = await readJsonIfExists(path.join(this.sessionsDir, name), null);
      if (!session) continue;
      if (workspaceId && session.workspaceId !== workspaceId) continue;
      if (channelId && session.channelId !== channelId) continue;
      if (status && session.status !== status) continue;
      out.push(session);
    }
    out.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return limit ? out.slice(0, limit) : out;
  }

  async appendMessage(sessionId, message, options = {}) {
    if (options.dedupe !== false && message.messageId) {
      const exists = (await this.listMessages(sessionId)).some((item) => String(item.messageId || "") === String(message.messageId));
      if (exists) return null;
    }
    const record = { ...message, createdAt: message.createdAt || nowIso() };
    await appendNdjson(this.messagesPath(sessionId), record);
    return record;
  }

  async listMessages(sessionId, { limit } = {}) {
    const messages = await readNdjson(this.messagesPath(sessionId));
    if (!limit || messages.length <= limit) return messages;
    return messages.slice(messages.length - limit);
  }

  async appendAudit(event) {
    const record = { ...event, createdAt: event.createdAt || nowIso() };
    await appendNdjson(this.auditPath, record);
    return record;
  }

  async listAudit({ limit, sessionId, type } = {}) {
    let events = await readNdjson(this.auditPath);
    if (sessionId) events = events.filter((event) => event.sessionId === sessionId);
    if (type) events = events.filter((event) => event.type === type);
    if (!limit || events.length <= limit) return events;
    return events.slice(events.length - limit);
  }

  async createApproval(approval) {
    const record = { ...approval, createdAt: approval.createdAt || nowIso(), updatedAt: nowIso() };
    await atomicWriteJson(this.approvalPath(record.id), record);
    return record;
  }

  async getApproval(approvalId) {
    return readJsonIfExists(this.approvalPath(approvalId), null);
  }

  async saveApproval(approval) {
    const record = { ...approval, updatedAt: nowIso() };
    await atomicWriteJson(this.approvalPath(record.id), record);
    return record;
  }

  async listApprovals({ status = null, sessionId = null, limit = null } = {}) {
    const names = await readdir(this.approvalsDir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const approval = await readJsonIfExists(path.join(this.approvalsDir, name), null);
      if (!approval) continue;
      if (status && approval.status !== status) continue;
      if (sessionId && approval.sessionId !== sessionId) continue;
      out.push(approval);
    }
    out.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return limit ? out.slice(0, limit) : out;
  }

  async createRun(run) {
    const record = { ...run, createdAt: run.createdAt || nowIso(), updatedAt: nowIso() };
    await atomicWriteJson(this.runPath(record.id), record);
    return record;
  }

  async saveRun(run) {
    const current = await readJsonIfExists(this.runPath(run.id), {});
    const record = { ...current, ...run, createdAt: current.createdAt || run.createdAt || nowIso(), updatedAt: nowIso() };
    await atomicWriteJson(this.runPath(record.id), record);
    return record;
  }

  async updateRun(runId, patch) {
    const current = await readJsonIfExists(this.runPath(runId), null);
    if (!current) throw new Error(`Run not found: ${runId}`);
    const updated = { ...current, ...patch, updatedAt: nowIso() };
    await atomicWriteJson(this.runPath(runId), updated);
    return updated;
  }

  async getRun(runId) {
    return readJsonIfExists(this.runPath(runId), null);
  }

  async listRuns({ sessionId = null, limit = null } = {}) {
    const names = await readdir(this.runsDir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const run = await readJsonIfExists(path.join(this.runsDir, name), null);
      if (!run) continue;
      if (sessionId && run.sessionId !== sessionId) continue;
      out.push(run);
    }
    out.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return limit ? out.slice(0, limit) : out;
  }

  async createArtifact(artifact) {
    const record = { ...artifact, createdAt: artifact.createdAt || nowIso(), updatedAt: nowIso() };
    await atomicWriteJson(this.artifactPath(record.id), record);
    return record;
  }

  async getArtifact(artifactId) {
    return readJsonIfExists(this.artifactPath(artifactId), null);
  }

  async listArtifacts({ sessionId = null, runId = null, limit = null } = {}) {
    const names = await readdir(this.artifactsDir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const artifact = await readJsonIfExists(path.join(this.artifactsDir, name), null);
      if (!artifact) continue;
      if (sessionId && artifact.sessionId !== sessionId) continue;
      if (runId && artifact.runId !== runId) continue;
      out.push(artifact);
    }
    out.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return limit ? out.slice(0, limit) : out;
  }

  async getThreadIndex(channelId) {
    return readJsonIfExists(this.threadIndexPath(channelId), { channelId, threads: {}, updatedAt: null });
  }

  async saveThreadIndex(channelId, index) {
    const record = { channelId, threads: {}, ...index, updatedAt: nowIso() };
    await atomicWriteJson(this.threadIndexPath(channelId), record);
    return record;
  }

  async saveChannelReport(report) {
    const record = { ...report, createdAt: report.createdAt || nowIso(), updatedAt: nowIso() };
    await atomicWriteJson(this.channelReportPath(record.id), record);
    return record;
  }

  async listChannelReports({ channelId = null, threadTs = null, limit = null } = {}) {
    const names = await readdir(this.channelReportsDir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const report = await readJsonIfExists(path.join(this.channelReportsDir, name), null);
      if (!report) continue;
      if (channelId && report.channelId !== channelId) continue;
      if (threadTs && report.threadTs !== threadTs) continue;
      out.push(report);
    }
    out.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    return limit ? out.slice(0, limit) : out;
  }

  async getWorkspaceIndex(workspaceId, channelId) {
    return readJsonIfExists(this.workspaceIndexPath(workspaceId, channelId), { workspaceId, channelId, documents: {}, updatedAt: null });
  }

  async saveWorkspaceIndex(workspaceId, channelId, index) {
    const record = { workspaceId, channelId, documents: {}, ...index, updatedAt: nowIso() };
    await atomicWriteJson(this.workspaceIndexPath(workspaceId, channelId), record);
    return record;
  }

  async listWorkspaceIndexes({ workspaceId = null } = {}) {
    const names = await readdir(this.workspaceIndexDir).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const index = await readJsonIfExists(path.join(this.workspaceIndexDir, name), null);
      if (!index) continue;
      if (workspaceId && index.workspaceId !== workspaceId) continue;
      out.push(index);
    }
    out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return out;
  }

  async createMemoryEntry({ workspaceId, channelId = null, scope, text, createdBy = null, source = null }) {
    const filePath = this.memoryPath(workspaceId, scope, channelId);
    const current = await readJsonIfExists(filePath, { workspaceId, channelId, scope, entries: [] });
    const entry = {
      id: randomId("mem"),
      workspaceId,
      channelId: scope === "channel" ? channelId : null,
      scope,
      text: String(text || "").trim(),
      createdBy,
      source,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    current.entries = [...(current.entries || []), entry];
    await atomicWriteJson(filePath, { ...current, updatedAt: nowIso() });
    return entry;
  }

  async listMemoryEntries({ workspaceId, channelId = null, includeWorkspace = true, includeChannel = false, limit = null } = {}) {
    const entries = [];
    if (includeWorkspace) {
      const workspaceMemory = await readJsonIfExists(this.memoryPath(workspaceId, "workspace"), { entries: [] });
      entries.push(...(workspaceMemory.entries || []));
    }
    if (includeChannel && channelId) {
      const channelMemory = await readJsonIfExists(this.memoryPath(workspaceId, "channel", channelId), { entries: [] });
      entries.push(...(channelMemory.entries || []));
    }
    entries.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    return limit ? entries.slice(Math.max(0, entries.length - limit)) : entries;
  }

  async deleteMemoryEntry({ workspaceId, channelId = null, memoryId }) {
    const paths = [
      this.memoryPath(workspaceId, "workspace"),
      channelId ? this.memoryPath(workspaceId, "channel", channelId) : null
    ].filter(Boolean);
    for (const filePath of paths) {
      const current = await readJsonIfExists(filePath, null);
      if (!current?.entries?.length) continue;
      const before = current.entries.length;
      current.entries = current.entries.filter((entry) => entry.id !== memoryId);
      if (current.entries.length !== before) {
        await atomicWriteJson(filePath, { ...current, updatedAt: nowIso() });
        return true;
      }
    }
    return false;
  }

  async clear() {
    await rm(this.rootDir, { recursive: true, force: true });
    await this.init();
  }
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, "_");
}
