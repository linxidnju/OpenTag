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
