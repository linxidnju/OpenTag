import { randomId } from "../utils/id.js";
import { SlackChannelScanner } from "./SlackChannelScanner.js";
import { ThreadIndexer } from "./ThreadIndexer.js";
import { StatusExtractor } from "./StatusExtractor.js";
import { StatusReportRenderer } from "./StatusReportRenderer.js";
import { WorkspaceSearchIndexer } from "../search/WorkspaceSearchIndexer.js";

export class ChannelStatusService {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.scanner = new SlackChannelScanner({ config, logger });
    this.indexer = new ThreadIndexer({ store, logger });
    this.workspaceSearchIndexer = new WorkspaceSearchIndexer({ config, store, logger });
    this.extractor = new StatusExtractor({ config, logger });
    this.renderer = new StatusReportRenderer({ config, logger });
  }

  async run({ client, workspaceId = "slack", channelId, threadTs, topic, days, maxThreads, botUserId, responder }) {
    const progress = makeProgress(responder);
    await progress("正在整理这个频道里的相关讨论...");
    const scan = await this.scanner.scan({
      client,
      channelId,
      topic,
      days,
      maxThreads,
      botUserId,
      onProgress: progress
    });
    await progress("正在建立 thread 索引...");
    await this.indexer.upsertScan(scan);
    await this.workspaceSearchIndexer.indexRuntimeContext({
      workspaceId,
      channelId,
      threadMessages: flattenThreadMessages(scan.threads),
      pinnedItems: scan.pinnedItems || []
    });
    await progress("正在抽取待办、阻塞和完成状态...");
    const result = this.extractor.extract({ scan: withPinnedThreads(scan), topic });
    const text = this.renderer.render(result);
    const report = await this.store.saveChannelReport({
      id: randomId("report"),
      channelId,
      threadTs,
      topic: topic || "",
      days: scan.days,
      scannedThreadCount: result.scannedThreadCount,
      relevantThreadCount: result.relevantThreadCount,
      counts: result.counts,
      items: result.items.slice(0, 50)
    });
    await this.store.appendAudit({
      type: "channel_status.completed",
      reportId: report.id,
      channelId,
      threadTs,
      topic: topic || "",
      scannedThreadCount: result.scannedThreadCount,
      relevantThreadCount: result.relevantThreadCount,
      counts: result.counts
    });
    await responder.complete(text);
    return { report, result, text };
  }
}

function flattenThreadMessages(threads) {
  return (threads || []).flatMap((thread) => (thread.messages || []).map((message) => ({
    ...message,
    threadId: thread.threadTs,
    permalink: thread.permalink
  })));
}

function withPinnedThreads(scan) {
  const pinThreads = (scan.pinnedItems || []).filter((pin) => pin.text || pin.files?.length).map((pin) => ({
    channelId: scan.channelId,
    threadTs: pin.messageTs,
    permalink: pin.permalink,
    replyCount: 0,
    latestTs: pin.messageTs,
    messages: [{
      ts: pin.messageTs,
      user: pin.user || "unknown",
      text: `[Pinned] ${pin.text || ""} ${(pin.files || []).map((file) => file.name || file.title || file.id).join(" ")}`.trim(),
      replyCount: 0
    }]
  }));
  return { ...scan, threads: [...(scan.threads || []), ...pinThreads] };
}

function makeProgress(responder) {
  const steps = [];
  return async (text) => {
    steps.push(`✓ ${text.replace(/[.。…]+$/, "")}`);
    await responder.sendStatus(steps.join("\n"));
  };
}
