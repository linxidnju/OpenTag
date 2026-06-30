import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildOpenTag } from "../src/opentag.js";
import { createLogger } from "../src/utils/logger.js";

async function makeApp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-extra-"));
  const config = {
    app: { name: "OpenTag", dataDir: path.join(dir, "data"), logLevel: "silent" },
    gateway: "console",
    admin: { enabled: true, host: "127.0.0.1", port: 0, tokenEnv: "OPENTAG_ADMIN_TOKEN_TEST" },
    mcp: { name: "opentag-mcp", protocolVersion: "2025-06-18", allowSlackPost: false, maxToolResultChars: 12000 },
    slack: { mode: "socket", processThreadReplies: true, streamUpdateMs: 1, maxMessageChars: 3900, dedupeEvents: true },
    sessions: { maxContextMessages: 8, idleTtlHours: 72, followupStatuses: ["active", "running", "failed", "waiting_approval"] },
    sandbox: { rootDir: path.join(dir, "sandboxes"), mode: "ephemeral", cleanupOnComplete: false, retentionHours: 24 },
    security: { redactSecrets: true, maxPromptChars: 24000, allowRequesterApprove: true, defaultDenyPatterns: ["rm\\s+-rf\\s+/"], defaultApprovalPatterns: ["deploy"], toolDenyPatterns: [], toolApprovalPatterns: [] },
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

test("MCP core initializes and lists OpenTag tools", async () => {
  const { app, dir } = await makeApp();
  try {
    const init = await app.mcpCore.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    const list = await app.mcpCore.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert.ok(list.result.tools.some((tool) => tool.name === "opentag.get_thread_context"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MCP get_thread_context returns session messages", async () => {
  const { app, dir } = await makeApp();
  try {
    const r = recorder();
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "1", messageId: "1", userId: "U1", text: "hello", cleanText: "hello", isMention: true, raw: {} }, r);
    const [session] = await app.store.listSessions();
    const response = await app.mcpCore.handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "opentag.get_thread_context", arguments: { sessionId: session.id, limit: 5 } } });
    assert.equal(response.error, undefined);
    assert.match(response.result.content[0].text, /hello/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Admin API exposes health and sessions", async () => {
  const { app, dir } = await makeApp();
  try {
    const r = recorder();
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "1", messageId: "1", userId: "U1", text: "hello", cleanText: "hello", isMention: true, raw: {} }, r);
    await app.adminServer.start();
    const health = await fetch(app.adminServer.url("/healthz")).then((res) => res.json());
    assert.equal(health.ok, true);
    const sessions = await fetch(app.adminServer.url("/v1/sessions")).then((res) => res.json());
    assert.equal(sessions.ok, true);
    assert.equal(sessions.sessions.length, 1);
    const runs = await fetch(app.adminServer.url("/v1/runs")).then((res) => res.json());
    assert.equal(runs.ok, true);
    assert.equal(runs.runs.length, 1);
    const runtimeEvents = await fetch(app.adminServer.url(`/v1/runs/${runs.runs[0].id}/events`)).then((res) => res.json());
    assert.equal(runtimeEvents.ok, true);
    assert.equal(runtimeEvents.runId, runs.runs[0].id);
    assert.ok(runtimeEvents.events.some((event) => event.type === "completed"));
    const artifacts = await fetch(app.adminServer.url("/v1/artifacts")).then((res) => res.json());
    assert.equal(artifacts.ok, true);
    assert.ok(Array.isArray(artifacts.artifacts));
    const candidates = await fetch(app.adminServer.url("/v1/pr-candidates")).then((res) => res.json());
    assert.equal(candidates.ok, true);
    assert.ok(Array.isArray(candidates.candidates));
  } finally {
    await app.adminServer.stop().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
