import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentProxy } from "../src/proxy/AgentProxy.js";
import { FileStore } from "../src/storage/FileStore.js";
import { buildOpenTag } from "../src/opentag.js";
import { createLogger } from "../src/utils/logger.js";

test("AgentProxy denies external HTTP when no allowed hosts are configured", async () => {
  const { proxy, context, store, dir } = await makeProxy({ agentProxy: { enabled: true, allowedHosts: [] } });
  try {
    const result = await proxy.handleHttpRequest({
      token: context.token,
      body: { url: "https://api.github.com/repos/openai/codex", method: "GET" }
    });
    assert.equal(result.status, 403);
    assert.match(result.body.error, /allowedHosts/);
    const audit = await store.listAudit({ sessionId: "sess_1" });
    assert.ok(audit.some((event) => event.type === "agent_proxy.request" && event.decision === "deny"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AgentProxy forwards allowed HTTP and injects connection headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.OPENTAG_PROXY_TEST_TOKEN;
  process.env.OPENTAG_PROXY_TEST_TOKEN = "secret-token";
  let forwarded = null;
  globalThis.fetch = async (url, init) => {
    forwarded = { url: String(url), init };
    return {
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "{\"ok\":true}"
    };
  };
  const { proxy, context, store, dir } = await makeProxy({
    agentProxy: {
      enabled: true,
      allowedHosts: ["api.github.com"],
      allowedMethods: ["GET"],
      connections: [{
        id: "github",
        headers: { authorization: "Bearer ${env:OPENTAG_PROXY_TEST_TOKEN}" }
      }]
    },
    channelAgentProxy: { allowedConnections: ["github"] }
  });
  try {
    const result = await proxy.handleHttpRequest({
      token: context.token,
      body: { url: "https://api.github.com/repos/openai/codex", method: "GET", connectionId: "github", headers: { authorization: "Bearer user-supplied" } }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.response.status, 200);
    assert.equal(forwarded.init.headers.authorization, "Bearer secret-token");
    const audit = await store.listAudit({ sessionId: "sess_1" });
    assert.ok(audit.some((event) => event.type === "agent_proxy.request" && event.decision === "allow"));
    assert.ok(audit.some((event) => event.type === "agent_proxy.response" && event.status === 200));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.OPENTAG_PROXY_TEST_TOKEN;
    else process.env.OPENTAG_PROXY_TEST_TOKEN = originalToken;
    await rm(dir, { recursive: true, force: true });
  }
});

test("AdminServer proxy endpoint uses per-run token instead of admin token", async () => {
  const target = await startTargetServer();
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-proxy-admin-"));
  const config = {
    app: { name: "OpenTag", dataDir: path.join(dir, "data"), logLevel: "silent" },
    gateway: "console",
    admin: { enabled: true, host: "127.0.0.1", port: 0, tokenEnv: "OPENTAG_ADMIN_TOKEN_TEST", requireToken: true },
    agentProxy: { enabled: true, allowedHosts: ["127.0.0.1"], allowedMethods: ["GET"] },
    mcp: { name: "opentag-mcp", protocolVersion: "2025-06-18" },
    slack: { mode: "socket" },
    sessions: { maxContextMessages: 8, idleTtlHours: 72 },
    sandbox: { rootDir: path.join(dir, "sandboxes"), mode: "ephemeral", cleanupOnComplete: false },
    security: { redactSecrets: true, defaultDenyPatterns: [], defaultApprovalPatterns: [] },
    workspaces: [{ workspaceId: "*", channels: [{ channelId: "*", name: "default", defaultRuntime: "mock", allowedRuntimes: ["mock"], policy: { requireApprovalForWriteAccess: false } }] }],
    runtimes: { default: "mock", adapters: { mock: { type: "mock", delayMs: 0 } } }
  };
  const app = await buildOpenTag(config, { logger: createLogger({ level: "silent" }) });
  try {
    await app.adminServer.start();
    const context = app.agentProxy.registerRunContext({
      session: { id: "sess_1", workspaceId: "T1", channelId: "C1", threadId: "t1" },
      channelConfig: {},
      runtimeId: "mock"
    });
    const missing = await fetch(app.adminServer.url("/v1/proxy/http"), {
      method: "POST",
      body: JSON.stringify({ url: target.url })
    }).then((res) => res.json());
    assert.equal(missing.ok, false);
    const ok = await fetch(app.adminServer.url("/v1/proxy/http"), {
      method: "POST",
      headers: { authorization: `Bearer ${context.token}` },
      body: JSON.stringify({ url: target.url })
    }).then((res) => res.json());
    assert.equal(ok.ok, true);
    assert.equal(ok.response.body, "pong");
  } finally {
    await app.adminServer.stop().catch(() => {});
    await target.close();
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeProxy({ agentProxy, channelAgentProxy = {} }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-proxy-"));
  const store = new FileStore({ rootDir: path.join(dir, "data"), logger: silentLogger() });
  await store.init();
  const proxy = new AgentProxy({ config: { agentProxy }, store, logger: silentLogger() });
  proxy.setBaseUrl("http://127.0.0.1:8787");
  const context = proxy.registerRunContext({
    session: { id: "sess_1", workspaceId: "T1", channelId: "C1", threadId: "t1" },
    channelConfig: { agentProxy: channelAgentProxy },
    runtimeId: "mock"
  });
  return { proxy, context, store, dir };
}

function silentLogger() {
  return createLogger({ level: "silent" });
}

async function startTargetServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("pong");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/ping`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
