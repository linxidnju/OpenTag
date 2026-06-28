import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileStore } from "../src/storage/FileStore.js";
import { ChannelStatusService } from "../src/channel/ChannelStatusService.js";
import { createLogger } from "../src/utils/logger.js";

test("channel status scans Slack threads and renders open items with sources", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-channel-status-"));
  const store = new FileStore({ rootDir: path.join(dir, "data"), logger: createLogger({ level: "silent" }) });
  await store.init();
  const service = new ChannelStatusService({
    config: {
      channelStatus: { defaultDays: 14, maxThreads: 10, historyPageLimit: 10, maxRepliesPerThread: 10 }
    },
    store,
    logger: createLogger({ level: "silent" })
  });
  const responder = recorder();
  try {
    const result = await service.run({
      client: fakeSlackClient(),
      channelId: "C1",
      threadTs: "100.1",
      topic: "launch prep",
      botUserId: "UBOT",
      responder
    });
    assert.equal(result.result.scannedThreadCount, 3);
    assert.equal(result.result.relevantThreadCount, 3);
    assert.equal(result.result.counts.blocked, 1);
    assert.equal(result.result.counts.open, 1);
    assert.equal(result.result.counts.closed, 1);
    assert.match(result.text, /venue contract/i);
    assert.match(result.text, /来源/);
    const index = await store.getThreadIndex("C1");
    assert.equal(Object.keys(index.threads).length, 3);
    assert.ok(responder.events.some((event) => event[0] === "complete" && event[1].includes("仍需关注")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function fakeSlackClient() {
  const roots = [
    { ts: "300.1", user: "U1", text: "launch prep venue contract", reply_count: 1 },
    { ts: "200.1", user: "U2", text: "launch prep email QA still open owner: @Jordan", reply_count: 1 },
    { ts: "100.1", user: "U3", text: "launch prep analytics checklist", reply_count: 1 }
  ];
  const replies = {
    "300.1": [
      roots[0],
      { ts: "300.2", user: "U4", text: "blocked waiting on legal" }
    ],
    "200.1": [
      roots[1],
      { ts: "200.2", user: "U2", text: "need to finish final copy" }
    ],
    "100.1": [
      roots[2],
      { ts: "100.2", user: "U3", text: "done and approved" }
    ]
  };
  return {
    conversations: {
      history: async () => ({ messages: roots, has_more: false, response_metadata: {} }),
      replies: async ({ ts }) => ({ messages: replies[ts] || [] })
    },
    chat: {
      getPermalink: async ({ message_ts }) => ({ permalink: `https://slack.example/thread/${message_ts}` })
    }
  };
}

function recorder() {
  const events = [];
  return {
    events,
    sendStatus: async (text) => events.push(["status", text]),
    complete: async (text) => events.push(["complete", text]),
    fail: async (text) => events.push(["fail", text])
  };
}
