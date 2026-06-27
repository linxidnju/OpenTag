import http from "node:http";
import { randomId } from "../utils/id.js";

export class AdminServer {
  constructor({ config, engine, store, runtimeRegistry, logger }) {
    this.config = config;
    this.engine = engine;
    this.store = store;
    this.runtimeRegistry = runtimeRegistry;
    this.logger = logger;
    this.server = null;
  }

  async start() {
    if (this.server) return this.server;
    const host = this.config.admin?.host || "127.0.0.1";
    const port = Number(process.env.OPENTAG_ADMIN_PORT ?? this.config.admin?.port ?? 8787);
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        this.logger?.error?.("admin.request_failed", { error: error.message });
        sendJson(res, 500, { ok: false, error: error.message });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, resolve);
    });
    const address = this.server.address();
    this.logger?.info?.("OpenTag admin server started", { host, port: address?.port || port });
    return this.server;
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
    this.server = null;
  }

  url(path = "/") {
    const address = this.server?.address();
    if (!address || typeof address === "string") return null;
    return `http://${this.config.admin?.host || "127.0.0.1"}:${address.port}${path}`;
  }

  async handle(req, res) {
    if (!this.authorized(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
    const url = new URL(req.url || "/", "http://opentag.local");
    const method = req.method || "GET";

    if (method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, app: this.config.app.name, time: new Date().toISOString() });
    }
    if (method === "GET" && url.pathname === "/v1/runtimes") {
      return sendJson(res, 200, { ok: true, runtimes: this.runtimeRegistry.list() });
    }
    if (method === "GET" && url.pathname === "/v1/sessions") {
      const sessions = await this.store.listSessions({ limit: numberParam(url, "limit", 50), status: url.searchParams.get("status") || undefined });
      return sendJson(res, 200, { ok: true, sessions });
    }
    const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)$/);
    if (method === "GET" && sessionMatch) {
      const session = await this.store.getSession(decodeURIComponent(sessionMatch[1]));
      if (!session) return sendJson(res, 404, { ok: false, error: "session not found" });
      return sendJson(res, 200, { ok: true, session });
    }
    const messagesMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
    if (method === "GET" && messagesMatch) {
      const sessionId = decodeURIComponent(messagesMatch[1]);
      const messages = await this.store.listMessages(sessionId, { limit: numberParam(url, "limit", 50) });
      return sendJson(res, 200, { ok: true, messages });
    }
    const cancelMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/cancel$/);
    if (method === "POST" && cancelMatch) {
      const body = await readJson(req);
      const sessionId = decodeURIComponent(cancelMatch[1]);
      await this.engine.cancelSession(sessionId, body.reason || "cancelled by admin api");
      return sendJson(res, 200, { ok: true, sessionId });
    }
    if (method === "GET" && url.pathname === "/v1/audit") {
      const events = await this.store.listAudit({ limit: numberParam(url, "limit", 100), sessionId: url.searchParams.get("sessionId") || undefined, type: url.searchParams.get("type") || undefined });
      return sendJson(res, 200, { ok: true, events });
    }
    if (method === "GET" && url.pathname === "/v1/approvals") {
      const approvals = await this.store.listApprovals({ limit: numberParam(url, "limit", 100), status: url.searchParams.get("status") || undefined, sessionId: url.searchParams.get("sessionId") || undefined });
      return sendJson(res, 200, { ok: true, approvals });
    }
    if (method === "GET" && url.pathname === "/v1/runs") {
      const runs = await this.store.listRuns({ limit: numberParam(url, "limit", 100), sessionId: url.searchParams.get("sessionId") || undefined });
      return sendJson(res, 200, { ok: true, runs });
    }
    if (method === "GET" && url.pathname === "/v1/artifacts") {
      const artifacts = await this.store.listArtifacts({ limit: numberParam(url, "limit", 100), sessionId: url.searchParams.get("sessionId") || undefined, runId: url.searchParams.get("runId") || undefined });
      return sendJson(res, 200, { ok: true, artifacts });
    }
    if (method === "POST" && url.pathname === "/v1/run") {
      const body = await readJson(req);
      if (!body.prompt) return sendJson(res, 400, { ok: false, error: "missing prompt" });
      const recorder = createRecordingResponder();
      await this.engine.handleIncomingMessage({
        platform: body.platform || "admin",
        workspaceId: body.workspaceId || "admin",
        channelId: body.channelId || "api",
        threadId: body.threadId || randomId("thread"),
        messageId: randomId("msg"),
        userId: body.userId || "admin-api",
        text: body.prompt,
        cleanText: body.prompt,
        isMention: true,
        raw: {}
      }, recorder);
      return sendJson(res, 200, { ok: true, events: recorder.events });
    }
    return sendJson(res, 404, { ok: false, error: "not found" });
  }

  authorized(req) {
    if (this.config.admin?.requireToken === false) return true;
    const tokenEnv = this.config.admin?.tokenEnv;
    const token = tokenEnv ? process.env[tokenEnv] : "";
    if (!token) return this.config.admin?.requireToken !== true;
    const header = req.headers.authorization || "";
    return header === `Bearer ${token}`;
  }
}

function sendJson(res, status, body) {
  const text = `${JSON.stringify(body, null, 2)}\n`;
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function numberParam(url, name, fallback) {
  const value = Number(url.searchParams.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function createRecordingResponder() {
  const events = [];
  return {
    events,
    sendStatus: async (text) => events.push({ type: "status", text }),
    sendText: async (text) => events.push({ type: "text", text }),
    appendToken: async (text) => events.push({ type: "token", text }),
    complete: async (text) => events.push({ type: "complete", text }),
    fail: async (text) => events.push({ type: "fail", text }),
    sendApproval: async (approval) => events.push({ type: "approval", approval })
  };
}
