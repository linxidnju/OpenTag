export class ThreadIndexer {
  constructor({ store, logger }) {
    this.store = store;
    this.logger = logger;
  }

  async upsertScan(scan) {
    const current = await this.store.getThreadIndex(scan.channelId);
    const threads = { ...(current.threads || {}) };
    for (const thread of scan.threads || []) {
      threads[thread.threadTs] = {
        threadTs: thread.threadTs,
        channelId: thread.channelId,
        permalink: thread.permalink,
        replyCount: thread.replyCount,
        latestTs: thread.latestTs,
        messageCount: thread.messages.length,
        excerpt: excerptThread(thread),
        updatedAt: new Date().toISOString()
      };
    }
    return this.store.saveThreadIndex(scan.channelId, {
      channelId: scan.channelId,
      threads,
      lastScan: {
        topic: scan.topic,
        days: scan.days,
        threadCount: scan.threads.length,
        scannedAt: scan.scannedAt
      }
    });
  }
}

function excerptThread(thread) {
  return (thread.messages || [])
    .slice(0, 5)
    .map((message) => `${message.user}: ${message.text}`)
    .join("\n")
    .slice(0, 1200);
}
