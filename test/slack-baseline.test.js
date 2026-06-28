import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileStore } from "../src/storage/FileStore.js";
import { SlackFileManager, validateSlackFile } from "../src/slack/SlackFileManager.js";
import { SlackPinnedContextReader } from "../src/slack/SlackPinnedContextReader.js";
import { WorkspaceSearchIndexer } from "../src/search/WorkspaceSearchIndexer.js";
import { ArtifactUploader } from "../src/slack/ArtifactUploader.js";
import { SlackWorkspaceSearcher } from "../src/slack/SlackWorkspaceSearcher.js";
import { SlackGateway } from "../src/gateways/slack/SlackGateway.js";
import { ContextBuilder } from "../src/core/ContextBuilder.js";
import { createLogger } from "../src/utils/logger.js";

test("SlackFileManager downloads allowed Slack files into sandbox inputs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-slack-files-"));
  const store = await makeStore(dir);
  const manager = new SlackFileManager({ config: baseConfig(), logger: silentLogger() });
  try {
    const result = await manager.downloadMessageFiles({
      client: {
        fetchFile: async () => Buffer.from("name,value\nA,1\n")
      },
      message: {
        files: [{
          id: "F1",
          name: "data.csv",
          filetype: "csv",
          mimetype: "text/csv",
          size: 15,
          url_private_download: "https://files/data.csv",
          permalink: "https://slack/files/F1"
        }]
      },
      sandbox: { dir, inputDir: path.join(dir, "inputs") },
      store,
      sessionId: "sess_1",
      runtimeId: "mock"
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].status, "downloaded");
    assert.equal(result[0].relativePath, "inputs/data.csv");
    assert.match(await readFile(path.join(dir, "inputs", "data.csv"), "utf8"), /name,value/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Slack file validation rejects oversized and disallowed types", () => {
  const slack = { maxDownloadBytes: 10, allowedFileTypes: ["csv"] };
  assert.equal(validateSlackFile({ name: "a.csv", filetype: "csv", size: 11, url_private_download: "u" }, slack).ok, false);
  const disallowed = validateSlackFile({ name: "a.exe", filetype: "exe", size: 1, url_private_download: "u" }, slack);
  assert.equal(disallowed.ok, false);
  assert.match(disallowed.reason, /not allowed/);
});

test("SlackPinnedContextReader reads pinned message text and files", async () => {
  const reader = new SlackPinnedContextReader({ config: baseConfig(), logger: silentLogger() });
  const pins = await reader.read({
    channelId: "C1",
    botUserId: "UBOT",
    client: {
      pins: {
        list: async () => ({
          items: [{
            type: "message",
            message: {
              ts: "10.1",
              user: "U1",
              text: "launch plan is pinned",
              permalink: "https://slack/thread/10.1",
              files: [{ id: "F2", name: "plan.md", filetype: "md" }]
            }
          }]
        })
      }
    }
  });
  assert.equal(pins.length, 1);
  assert.equal(pins[0].text, "launch plan is pinned");
  assert.equal(pins[0].files[0].name, "plan.md");
});

test("WorkspaceSearchIndexer indexes thread, pinned item, and file text", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-workspace-index-"));
  const store = await makeStore(dir);
  const indexer = new WorkspaceSearchIndexer({ config: baseConfig(), store, logger: silentLogger() });
  try {
    await indexer.indexRuntimeContext({
      workspaceId: "T1",
      channelId: "C1",
      threadMessages: [{ ts: "1", text: "vendor quote is still open", permalink: "https://slack/thread/1" }],
      pinnedItems: [{ messageTs: "2", text: "launch plan pinned", permalink: "https://slack/thread/2" }],
      files: [{ id: "F1", status: "downloaded", name: "data.csv", textPreview: "revenue chart source", relativePath: "inputs/data.csv", permalink: "https://slack/files/F1" }]
    });
    const hits = await indexer.search({ workspaceId: "T1", channelId: "C1", query: "launch revenue" });
    assert.ok(hits.some((hit) => hit.type === "pin" && hit.source === "https://slack/thread/2"));
    assert.ok(hits.some((hit) => hit.type === "file" && hit.relativePath === "inputs/data.csv"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("WorkspaceSearchIndexer can search all indexed channels in a workspace", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-workspace-cross-channel-"));
  const store = await makeStore(dir);
  const indexer = new WorkspaceSearchIndexer({ config: baseConfig(), store, logger: silentLogger() });
  try {
    await indexer.indexRuntimeContext({
      workspaceId: "T1",
      channelId: "C1",
      threadMessages: [{ ts: "1", text: "alpha launch note" }]
    });
    await indexer.indexRuntimeContext({
      workspaceId: "T1",
      channelId: "C2",
      threadMessages: [{ ts: "2", text: "vendor quote from public channel" }]
    });
    const hits = await indexer.search({ workspaceId: "T1", channelId: "*", query: "vendor" });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].channelId, "C2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SlackWorkspaceSearcher normalizes Slack search.messages results", async () => {
  const searcher = new SlackWorkspaceSearcher({
    config: { workspaceSearch: { enabled: true, slackSearchEnabled: true, slackSearchMaxResults: 2 } },
    logger: silentLogger()
  });
  const hits = await searcher.search({
    query: "vendor",
    client: {
      search: {
        messages: async ({ query, count }) => ({
          messages: {
            matches: [{
              ts: "10.1",
              text: `\uE000${query}\uE001 quote found`,
              permalink: "https://slack/search/1",
              channel: { id: "C2", name: "public-launch" },
              user: "U1"
            }]
          },
          count
        })
      }
    }
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].type, "slack_search");
  assert.equal(hits[0].channelId, "C2");
  assert.equal(hits[0].text, "vendor quote found");
});

test("SlackWorkspaceSearcher prefers configured user token over bot client search", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.SLACK_USER_TOKEN_TEST;
  let calledUrl = "";
  process.env.SLACK_USER_TOKEN_TEST = "xoxp-user-token";
  globalThis.fetch = async (url, options) => {
    calledUrl = String(url);
    assert.equal(options.headers.authorization, "Bearer xoxp-user-token");
    return {
      ok: true,
      json: async () => ({
        ok: true,
        messages: {
          matches: [{
            ts: "11.1",
            text: "public channel result",
            permalink: "https://slack/search/11.1",
            channel: { id: "C_PUBLIC", name: "public" }
          }]
        }
      })
    };
  };
  const searcher = new SlackWorkspaceSearcher({
    config: { workspaceSearch: { enabled: true, slackSearchEnabled: true, userTokenEnv: "SLACK_USER_TOKEN_TEST" } },
    logger: silentLogger()
  });
  try {
    const hits = await searcher.search({
      query: "public",
      client: {
        token: "xoxb-bot-token",
        search: {
          messages: async () => {
            throw new Error("bot search should not be called");
          }
        }
      }
    });
    assert.match(calledUrl, /search\.messages/);
    assert.equal(hits[0].channelId, "C_PUBLIC");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.SLACK_USER_TOKEN_TEST;
    else process.env.SLACK_USER_TOKEN_TEST = originalToken;
  }
});

test("ContextBuilder includes recent channel history in prompt", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-context-builder-"));
  const store = await makeStore(dir);
  const builder = new ContextBuilder({
    config: {
      app: { name: "OpenTag" },
      sessions: { maxContextMessages: 8, maxPromptChars: 60000 },
      security: { redactSecrets: true },
      workspaceSearch: { maxPromptChannelHistoryMessages: 2 }
    },
    store,
    logger: silentLogger()
  });
  try {
    const prompt = await builder.build({
      session: { id: "sess_1", workspaceId: "T1", channelId: "C1", threadId: "10.1" },
      runtimeId: "mock",
      channelConfig: { name: "general" },
      incomingMessage: {
        cleanText: "summarize channel",
        channelHistoryMessages: [
          { ts: "1", user: "U1", text: "old channel message" },
          { ts: "2", user: "U2", text: "recent channel context one" },
          { ts: "3", user: "U3", text: "recent channel context two" }
        ]
      }
    });
    assert.match(prompt, /Recent channel history loaded into local index: 3 messages/);
    assert.match(prompt, /recent channel context one/);
    assert.match(prompt, /recent channel context two/);
    assert.doesNotMatch(prompt, /old channel message/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SlackGateway hydrates root plus oldest 50 non-bot thread messages", async () => {
  const gateway = new SlackGateway({
    config: { slack: { hydrateThreadContext: true, maxHydratedMessages: 50 } },
    engine: { store: {} },
    logger: silentLogger()
  });
  gateway.botUserId = "UBOT";
  const messages = Array.from({ length: 60 }, (_, index) => ({
    ts: String(1000 + index),
    user: index === 5 ? "UBOT" : `U${index}`,
    text: `message ${index}`
  }));
  messages[10] = { ts: "1010", bot_id: "BOTHER", text: "other bot" };
  const hydrated = await gateway.hydrateThread({
    channelId: "C1",
    threadTs: "1000",
    client: {
      conversations: {
        replies: async () => ({ messages: messages.toReversed() })
      }
    }
  });
  assert.equal(hydrated.length, 50);
  assert.equal(hydrated[0].ts, "1000");
  assert.equal(hydrated.at(-1).ts, "1051");
  assert.ok(!hydrated.some((message) => message.user === "UBOT" || message.bot_id));
});

test("ArtifactUploader uploads generated artifact to Slack thread and records audit", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-artifact-upload-"));
  const store = await makeStore(dir);
  const filePath = path.join(dir, "outputs", "chart.png");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from("png"));
  const uploads = [];
  const uploader = new ArtifactUploader({ config: baseConfig(), logger: silentLogger() });
  try {
    const result = await uploader.uploadArtifacts({
      client: { uploadArtifact: async (payload) => uploads.push(payload) || { ok: true } },
      channelId: "C1",
      threadTs: "10.1",
      artifacts: [{ id: "art_1", path: filePath, relativePath: "outputs/chart.png" }],
      store,
      sessionId: "sess_1",
      runtimeId: "mock"
    });
    assert.equal(result[0].ok, true);
    assert.equal(uploads[0].channelId, "C1");
    const audit = await store.listAudit({ sessionId: "sess_1" });
    assert.ok(audit.some((event) => event.type === "artifact.uploaded"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeStore(dir) {
  const store = new FileStore({ rootDir: path.join(dir, "data"), logger: silentLogger() });
  await store.init();
  return store;
}

function baseConfig() {
  return {
    slack: {
      uploadArtifacts: true,
      maxDownloadBytes: 25_000_000,
      allowedFileTypes: ["csv", "txt", "md", "json", "png", "jpg", "jpeg", "pdf"]
    },
    workspaceSearch: { enabled: true, maxHits: 8 }
  };
}

function silentLogger() {
  return createLogger({ level: "silent" });
}
