import { TeamKnowledgeService, isPrivateChannelType } from "../knowledge/TeamKnowledgeService.js";

export class ChannelMemoryService {
  constructor({ store, logger, knowledgeService = null, config = {} }) {
    this.knowledgeService = knowledgeService || new TeamKnowledgeService({ config, store, logger });
  }

  remember(args) {
    return this.knowledgeService.remember(args);
  }

  listForContext(args) {
    return this.knowledgeService.listForContext(args);
  }

  async forget({ memoryId, deletedBy, ...args }) {
    const deleted = await this.knowledgeService.forget({ ...args, knowledgeId: memoryId, actorId: deletedBy });
    return Boolean(deleted);
  }
}

export { isPrivateChannelType };
