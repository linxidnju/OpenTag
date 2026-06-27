import { stableId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

export class SessionManager {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
  }

  async getOrCreateSession({ platform, workspaceId, channelId, threadId, runtimeId, createdBy }) {
    const existing = await this.store.findSessionByThread({ platform, workspaceId, channelId, threadId });
    if (existing) return existing;
    const id = stableId([platform, workspaceId, channelId, threadId], "sess");
    const now = nowIso();
    const session = {
      id,
      platform,
      workspaceId,
      channelId,
      threadId,
      runtimeId,
      status: "active",
      createdBy,
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
      metadata: {}
    };
    return this.store.saveSession(session);
  }

  async setStatus(session, status, patch = {}) {
    return this.store.saveSession({ ...session, ...patch, status });
  }

  async incrementTurn(session) {
    return this.store.saveSession({ ...session, turnCount: (session.turnCount || 0) + 1 });
  }
}
