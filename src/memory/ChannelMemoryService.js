export class ChannelMemoryService {
  constructor({ store, logger }) {
    this.store = store;
    this.logger = logger;
  }

  async remember({ workspaceId, channelId, channelType, text, createdBy, source }) {
    const scope = isPrivateChannelType(channelType) ? "channel" : "workspace";
    const entry = await this.store.createMemoryEntry({
      workspaceId,
      channelId,
      scope,
      text,
      createdBy,
      source
    });
    await this.store.appendAudit?.({ type: "memory.created", workspaceId, channelId, memoryId: entry.id, scope, createdBy });
    return entry;
  }

  async listForContext({ workspaceId, channelId, channelType, limit = 40 }) {
    return this.store.listMemoryEntries({
      workspaceId,
      channelId,
      includeWorkspace: true,
      includeChannel: isPrivateChannelType(channelType),
      limit
    });
  }

  async forget({ workspaceId, channelId, memoryId, deletedBy }) {
    const deleted = await this.store.deleteMemoryEntry({ workspaceId, channelId, memoryId });
    await this.store.appendAudit?.({ type: deleted ? "memory.deleted" : "memory.delete_missed", workspaceId, channelId, memoryId, deletedBy });
    return deleted;
  }
}

export function isPrivateChannelType(channelType) {
  return ["group", "mpim", "im", "private"].includes(String(channelType || "").toLowerCase());
}
