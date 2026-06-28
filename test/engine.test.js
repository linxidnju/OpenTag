import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildOpenTag } from "../src/opentag.js";
import { createLogger } from "../src/utils/logger.js";

async function makeApp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-engine-"));
  const config = {
    app: { name: "OpenTag", dataDir: path.join(dir, "data"), logLevel: "silent" },
    gateway: "console",
    slack: { mode: "socket", processThreadReplies: true, streamUpdateMs: 1, maxMessageChars: 35000 },
    sessions: { maxContextMessages: 8, idleTtlHours: 72 },
    sandbox: { rootDir: path.join(dir, "sandboxes"), mode: "ephemeral", cleanupOnComplete: false, retentionHours: 24 },
    security: { redactSecrets: true, defaultDenyPatterns: ["rm\\s+-rf\\s+/"], defaultApprovalPatterns: ["deploy"] },
    workspaces: [{ workspaceId: "*", channels: [{ channelId: "*", name: "default", defaultRuntime: "mock", allowedRuntimes: ["mock"], allowedUsers: [], approvers: [], policy: { requireApprovalForWriteAccess: true, requireApprovalPatterns: [], denyPatterns: [] } }] }],
    runtimes: { default: "mock", adapters: { mock: { type: "mock", delayMs: 0 } } }
  };
  const app = await buildOpenTag(config, { logger: createLogger({ level: "silent" }) });
  return { app, dir };
}

function recorder() {
  const events = [];
  return {
    events,
    sendStatus: async (text) => events.push(["status", text]),
    sendText: async (text) => events.push(["text", text]),
    appendToken: async (text) => events.push(["token", text]),
    complete: async (text) => events.push(["complete", text]),
    fail: async (text) => events.push(["fail", text]),
    sendApproval: async (approval) => events.push(["approval", approval])
  };
}

test("engine creates thread session and runs mock runtime", async () => {
  const { app, dir } = await makeApp();
  try {
    const r = recorder();
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "1", messageId: "1", userId: "U1", text: "hello", cleanText: "hello", isMention: true, raw: {} }, r);
    assert.ok(r.events.some((e) => e[0] === "complete"));
    const sessions = await app.store.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].status, "active");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine creates approval instead of running risky prompt", async () => {
  const { app, dir } = await makeApp();
  try {
    const r = recorder();
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "1", messageId: "1", userId: "U1", text: "deploy now", cleanText: "deploy now", isMention: true, raw: {} }, r);
    assert.ok(r.events.some((e) => e[0] === "approval"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine rejects unknown runtime override without creating session", async () => {
  const { app, dir } = await makeApp();
  try {
    const r = recorder();
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "missing", messageId: "1", userId: "U1", text: "/runtime nope hi", cleanText: "/runtime nope hi", isMention: true, raw: {} }, r);
    assert.ok(r.events.some((e) => e[0] === "fail"));
    const sessions = await app.store.listSessions();
    assert.equal(sessions.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine slash command lists sessions", async () => {
  const { app, dir } = await makeApp();
  try {
    await app.store.saveSession({ id: "sess_cli", platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "t", runtimeId: "mock", status: "active" });
    const r = recorder();
    await app.engine.handleSlashCommand({ platform: "slack", workspaceId: "T1", channelId: "C1", userId: "U1", text: "sessions 5", responder: r });
    assert.ok(r.events.some((e) => e[0] === "text" && e[1].includes("sess_cli")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine handles remember and memory commands without runtime", async () => {
  const { app, dir } = await makeApp();
  try {
    const r = recorder();
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", channelType: "channel", threadId: "1", messageId: "1", userId: "U1", text: "remember: launch owner is Jordan", cleanText: "remember: launch owner is Jordan", isMention: true, raw: {} }, r);
    assert.ok(r.events.some((event) => event[0] === "text" && event[1].includes("workspace memory")));
    assert.equal((await app.store.listRuns()).length, 0);
    const r2 = recorder();
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", channelType: "channel", threadId: "1", messageId: "2", userId: "U1", text: "memory", cleanText: "memory", isMention: true, raw: {} }, r2);
    assert.ok(r2.events.some((event) => event[0] === "text" && event[1].includes("launch owner is Jordan")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine approval approve resumes runtime", async () => {
  const { app, dir } = await makeApp();
  try {
    const r = recorder();
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "1", messageId: "1", userId: "U1", text: "deploy now", cleanText: "deploy now", isMention: true, raw: {} }, r);
    const approval = r.events.find((e) => e[0] === "approval")[1];
    const r2 = recorder();
    await app.engine.approve(approval.id, "U1", r2);
    assert.ok(r2.events.some((e) => e[0] === "complete"));
    const saved = await app.store.getApproval(approval.id);
    assert.equal(saved.status, "approved");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine records run metadata and collects sandbox artifacts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-artifacts-"));
  const config = {
    app: { name: "OpenTag", dataDir: path.join(dir, "data"), logLevel: "silent" },
    gateway: "console",
    slack: { mode: "socket", processThreadReplies: true, streamUpdateMs: 1, maxMessageChars: 35000 },
    sessions: { maxContextMessages: 8, idleTtlHours: 72 },
    sandbox: { rootDir: path.join(dir, "sandboxes"), mode: "ephemeral", cleanupOnComplete: false, retentionHours: 24, collectArtifacts: true, artifactInclude: ["*.md"] },
    security: { redactSecrets: true, defaultDenyPatterns: [], defaultApprovalPatterns: [] },
    workspaces: [{ workspaceId: "*", channels: [{ channelId: "*", name: "default", defaultRuntime: "artifact", allowedRuntimes: ["artifact"], allowedUsers: [], approvers: [], policy: { requireApprovalForWriteAccess: true, requireApprovalPatterns: [], denyPatterns: [] } }] }],
    runtimes: {
      default: "artifact",
      adapters: {
        artifact: {
          type: "generic-cli",
          command: process.execPath,
          args: ["-e", "require('fs').writeFileSync('result.md', '# artifact\\n'); process.stdout.write('done')"],
          outputMode: "text",
          requiresApproval: false,
          timeoutMs: 5000
        }
      }
    }
  };
  const app = await buildOpenTag(config, { logger: createLogger({ level: "silent" }) });
  try {
    const r = recorder();
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "art", messageId: "1", userId: "U1", text: "make artifact", cleanText: "make artifact", isMention: true, raw: {} }, r);
    const sessions = await app.store.listSessions();
    const runs = await app.store.listRuns({ sessionId: sessions[0].id });
    const artifacts = await app.store.listArtifacts({ sessionId: sessions[0].id });
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "completed");
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].relativePath, "result.md");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("engine downloads Slack CSV input and uploads generated artifact to thread", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-slack-roundtrip-"));
  const config = {
    app: { name: "OpenTag", dataDir: path.join(dir, "data"), logLevel: "silent" },
    gateway: "console",
    slack: {
      mode: "socket",
      processThreadReplies: true,
      streamUpdateMs: 1,
      maxMessageChars: 35000,
      uploadArtifacts: true,
      maxDownloadBytes: 25000000,
      allowedFileTypes: ["csv", "txt", "md", "json", "png", "jpg", "jpeg", "pdf"]
    },
    workspaceSearch: { enabled: true, slackSearchEnabled: true, maxHits: 8 },
    sessions: { maxContextMessages: 8, idleTtlHours: 72 },
    sandbox: { rootDir: path.join(dir, "sandboxes"), mode: "ephemeral", cleanupOnComplete: false, retentionHours: 24, collectArtifacts: true, artifactInclude: ["*.png"] },
    security: { redactSecrets: true, defaultDenyPatterns: [], defaultApprovalPatterns: [] },
    workspaces: [{ workspaceId: "*", channels: [{ channelId: "*", name: "default", defaultRuntime: "chart", allowedRuntimes: ["chart"], allowedUsers: [], approvers: [], policy: { requireApprovalForWriteAccess: false, requireApprovalPatterns: [], denyPatterns: [] } }] }],
    runtimes: {
      default: "chart",
      adapters: {
        chart: {
          type: "generic-cli",
          command: process.execPath,
          args: ["-e", "const fs=require('fs'); const path=require('path'); const input=fs.readFileSync(path.join(process.env.OPENTAG_INPUT_DIR,'data.csv'),'utf8'); if(!input.includes('revenue')) process.exit(2); fs.mkdirSync(process.env.OPENTAG_OUTPUT_DIR,{recursive:true}); fs.writeFileSync(path.join(process.env.OPENTAG_OUTPUT_DIR,'chart.png'), Buffer.from('png')); process.stdout.write('chart ready')"],
          outputMode: "text",
          requiresApproval: false,
          timeoutMs: 5000
        }
      }
    }
  };
  const app = await buildOpenTag(config, { logger: createLogger({ level: "silent" }) });
  const uploaded = [];
  try {
    const r = {
      ...recorder(),
      client: {
        fetchFile: async () => Buffer.from("date,revenue\n2026-06-28,42\n"),
        uploadArtifact: async (payload) => {
          uploaded.push(payload);
          return { ok: true };
        },
        conversations: {
          history: async () => ({
            messages: [{ ts: "0.5", user: "U3", text: "historical channel note about vendor launch prep" }]
          })
        },
        search: {
          messages: async () => ({
            messages: {
              matches: [{
                ts: "20.1",
                text: "workspace search found vendor quote",
                permalink: "https://slack/search/20.1",
                channel: { id: "C_PUBLIC", name: "public-launch" },
                user: "U9"
              }]
            }
          })
        },
        pins: {
          list: async () => ({ items: [{ type: "message", message: { ts: "2", user: "U2", text: "launch plan pinned", permalink: "https://slack/thread/2" } }] })
        }
      },
      channelId: "C1",
      threadTs: "roundtrip"
    };
    await app.engine.handleIncomingMessage({
      platform: "slack",
      workspaceId: "T1",
      channelId: "C1",
      threadId: "roundtrip",
      messageId: "1",
      userId: "U1",
      text: "make chart",
      cleanText: "make chart",
      isMention: true,
      files: [{ id: "F1", name: "data.csv", filetype: "csv", mimetype: "text/csv", size: 32, url_private_download: "https://files/data.csv", permalink: "https://slack/files/F1" }],
      externalThreadMessages: [{ ts: "1", user: "U1", text: "make chart" }],
      raw: {}
    }, r);
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].channelId, "C1");
    assert.equal(uploaded[0].threadTs, "roundtrip");
    assert.equal(uploaded[0].artifact.relativePath, "outputs/chart.png");
    const sessions = await app.store.listSessions();
    const audit = await app.store.listAudit({ sessionId: sessions[0].id });
    assert.ok(audit.some((event) => event.type === "slack_file.downloaded"));
    assert.ok(audit.some((event) => event.type === "artifact.uploaded"));
    const hits = await app.workspaceSearchIndexer.search({ workspaceId: "T1", channelId: "C1", query: "launch revenue vendor" });
    assert.ok(hits.some((hit) => hit.type === "pin"));
    assert.ok(hits.some((hit) => hit.type === "file"));
    assert.ok(hits.some((hit) => hit.type === "message" && hit.text.includes("historical channel note")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
