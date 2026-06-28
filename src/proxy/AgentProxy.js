import { randomId } from "../utils/id.js";

export class AgentProxy {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.contexts = new Map();
    this.baseUrl = null;
  }

  setBaseUrl(baseUrl) {
    this.baseUrl = baseUrl;
  }

  registerRunContext({ session, channelConfig, runtimeId }) {
    if (this.config.agentProxy?.enabled === false) return null;
    if (!this.baseUrl) return null;
    const token = randomId("proxy");
    const context = {
      token,
      url: `${this.baseUrl}/v1/proxy/http`,
      sessionId: session.id,
      workspaceId: session.workspaceId,
      channelId: session.channelId,
      threadId: session.threadId,
      runtimeId,
      channelConfig,
      createdAt: new Date().toISOString()
    };
    this.contexts.set(token, context);
    return context;
  }

  revokeRunContext(token) {
    if (token) this.contexts.delete(token);
  }

  async handleHttpRequest({ token, body }) {
    const context = this.contexts.get(token);
    if (!context) return { status: 401, body: { ok: false, error: "invalid proxy token" } };
    const request = normalizeRequest(body);
    const decision = this.evaluateRequest({ context, request });
    await this.store?.appendAudit?.({
      type: "agent_proxy.request",
      sessionId: context.sessionId,
      runtimeId: context.runtimeId,
      channelId: context.channelId,
      url: request.url,
      method: request.method,
      connectionId: request.connectionId || null,
      decision: decision.decision,
      reason: decision.reason
    });
    if (decision.decision !== "allow") return { status: 403, body: { ok: false, error: decision.reason } };

    try {
      const response = await this.forwardHttpRequest({ request, context });
      await this.store?.appendAudit?.({
        type: "agent_proxy.response",
        sessionId: context.sessionId,
        runtimeId: context.runtimeId,
        channelId: context.channelId,
        url: request.url,
        method: request.method,
        status: response.status
      });
      return { status: 200, body: { ok: true, response } };
    } catch (error) {
      await this.store?.appendAudit?.({
        type: "agent_proxy.failed",
        sessionId: context.sessionId,
        runtimeId: context.runtimeId,
        channelId: context.channelId,
        url: request.url,
        method: request.method,
        error: error.message
      });
      return { status: 502, body: { ok: false, error: error.message } };
    }
  }

  evaluateRequest({ context, request }) {
    if (!request.url) return deny("missing url");
    let parsed;
    try {
      parsed = new URL(request.url);
    } catch {
      return deny("invalid url");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) return deny("only http/https URLs are allowed");
    const allowedHosts = mergedList(this.config.agentProxy?.allowedHosts, context.channelConfig.agentProxy?.allowedHosts);
    if (!allowedHosts.length && this.config.agentProxy?.allowAllHosts !== true) {
      return deny("no Agent Proxy allowedHosts configured");
    }
    if (allowedHosts.length && !allowedHosts.some((pattern) => hostMatches(pattern, parsed.hostname))) {
      return deny(`host ${parsed.hostname} is not allowed by Agent Proxy policy`);
    }
    const allowedMethods = listWithDefault(mergedList(this.config.agentProxy?.allowedMethods, context.channelConfig.agentProxy?.allowedMethods), ["GET", "POST"]);
    if (!allowedMethods.map((item) => String(item).toUpperCase()).includes(request.method)) {
      return deny(`method ${request.method} is not allowed by Agent Proxy policy`);
    }
    if (request.connectionId) {
      const connection = this.connectionById(request.connectionId);
      if (!connection) return deny(`connection ${request.connectionId} is not configured`);
      const allowedConnections = mergedList(context.channelConfig.agentProxy?.allowedConnections);
      if (allowedConnections.length && !allowedConnections.includes(request.connectionId)) {
        return deny(`connection ${request.connectionId} is not allowed in this channel`);
      }
    }
    const maxBodyBytes = Number(this.config.agentProxy?.maxBodyBytes || 1_000_000);
    if (Buffer.byteLength(request.body || "", "utf8") > maxBodyBytes) return deny(`request body exceeds maxBodyBytes=${maxBodyBytes}`);
    return allow("allowed");
  }

  async forwardHttpRequest({ request }) {
    const connection = request.connectionId ? this.connectionById(request.connectionId) : null;
    const headers = {
      ...sanitizeHeaders(request.headers),
      ...resolveConnectionHeaders(connection)
    };
    const init = { method: request.method, headers };
    if (!["GET", "HEAD"].includes(request.method) && request.body !== undefined) init.body = request.body;
    const response = await fetch(request.url, init);
    const text = await response.text();
    const maxResponseChars = Number(this.config.agentProxy?.maxResponseChars || 12000);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: safeResponseHeaders(response.headers),
      body: text.slice(0, maxResponseChars),
      truncated: text.length > maxResponseChars
    };
  }

  connectionById(id) {
    return (this.config.agentProxy?.connections || []).find((connection) => connection.id === id) || null;
  }
}

function normalizeRequest(body = {}) {
  return {
    url: String(body.url || ""),
    method: String(body.method || "GET").toUpperCase(),
    headers: body.headers && typeof body.headers === "object" ? body.headers : {},
    body: body.body === undefined ? undefined : String(body.body),
    connectionId: body.connectionId ? String(body.connectionId) : null
  };
}

function allow(reason) {
  return { decision: "allow", reason };
}

function deny(reason) {
  return { decision: "deny", reason };
}

function mergedList(...groups) {
  return groups.flatMap((group) => Array.isArray(group) ? group : []).filter(Boolean);
}

function listWithDefault(items, fallback) {
  return items.length ? items : fallback;
}

function hostMatches(pattern, host) {
  const value = String(pattern || "").toLowerCase();
  const target = String(host || "").toLowerCase();
  if (value === "*") return true;
  if (value.startsWith("*.")) return target.endsWith(value.slice(1)) || target === value.slice(2);
  return value === target;
}

function sanitizeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (["authorization", "cookie", "set-cookie", "host", "content-length"].includes(lower)) continue;
    out[key] = String(value);
  }
  return out;
}

function resolveConnectionHeaders(connection) {
  const headers = {};
  for (const [key, value] of Object.entries(connection?.headers || {})) {
    headers[key] = String(value).replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)}/g, (_, name) => process.env[name] || "");
  }
  return headers;
}

function safeResponseHeaders(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) {
    if (["set-cookie", "authorization"].includes(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}
