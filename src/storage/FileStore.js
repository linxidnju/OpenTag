import path from "node:path";
import { readdir, writeFile, rm } from "node:fs/promises";
import { ensureDir, readJsonIfExists, atomicWriteJson, appendNdjson, readNdjson } from "../utils/fs.js";
import { nowIso } from "../utils/time.js";
import { threadKey } from "../utils/id.js";

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

  async clear() {
    await rm(this.rootDir, { recursive: true, force: true });
    await this.init();
  }
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, "_");
}
