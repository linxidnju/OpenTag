import { randomId } from "../utils/id.js";
import { hoursFromNow, nowIso } from "../utils/time.js";
import { redact } from "../utils/redact.js";

export class ToolRegistry {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
  }

  listTools() {
    return [
      {
        name: "opentag.list_sessions",
        description: "List recent OpenTag sessions visible in the local OpenTag store.",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "number", minimum: 1, maximum: 100 }, status: { type: "string" } },
          additionalProperties: false
        }
      },
      {
        name: "opentag.get_thread_context",
        description: "Return a session plus recent thread messages from the OpenTag local store.",
        inputSchema: {
          type: "object",
          properties: { sessionId: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 100 } },
          required: ["sessionId"],
          additionalProperties: false
        }
      },
      {
        name: "opentag.append_audit",
        description: "Append an audit event to the local OpenTag audit log.",
        inputSchema: {
          type: "object",
          properties: { sessionId: { type: "string" }, type: { type: "string" }, message: { type: "string" }, metadata: { type: "object" } },
          required: ["type"],
          additionalProperties: true
        }
      },
      {
        name: "opentag.request_approval",
        description: "Create a human approval request for a session. The Slack gateway can render and handle approvals.",
        inputSchema: {
          type: "object",
          properties: { sessionId: { type: "string" }, reason: { type: "string" }, risks: { type: "array", items: { type: "string" } }, requestedBy: { type: "string" } },
          required: ["sessionId", "reason"],
          additionalProperties: false
        }
      },
      {
        name: "opentag.post_slack_reply",
        description: "Post a message to a Slack thread using SLACK_BOT_TOKEN. Disabled by default and may require an approved approvalId.",
        inputSchema: {
          type: "object",
          properties: {
            channelId: { type: "string" },
            threadTs: { type: "string" },
            text: { type: "string" },
            approvalId: { type: "string" }
          },
          required: ["channelId", "threadTs", "text"],
          additionalProperties: false
        }
      }
    ];
  }

  async callTool(name, args = {}) {
    if (name === "opentag.list_sessions") return this.textResult(await this.listSessions(args));
    if (name === "opentag.get_thread_context") return this.textResult(await this.getThreadContext(args));
    if (name === "opentag.append_audit") return this.textResult(await this.appendAudit(args));
    if (name === "opentag.request_approval") return this.textResult(await this.requestApproval(args));
    if (name === "opentag.post_slack_reply") return this.textResult(await this.postSlackReply(args));
    throw new Error(`Unknown OpenTag tool: ${name}`);
  }

  async listSessions(args) {
    const sessions = await this.store.listSessions({ limit: args.limit || 20, status: args.status });
    return JSON.stringify({ sessions: sessions.map(publicSession) }, null, 2);
  }

  async getThreadContext(args) {
    const session = await this.store.getSession(args.sessionId);
    if (!session) throw new Error(`Session not found: ${args.sessionId}`);
    const messages = await this.store.listMessages(args.sessionId, { limit: args.limit || 30 });
    return JSON.stringify({ session: publicSession(session), messages }, null, 2);
  }

  async appendAudit(args) {
    const event = await this.store.appendAudit({
      type: args.type,
      sessionId: args.sessionId,
      source: "mcp-tool",
      message: args.message,
      metadata: args.metadata || {}
    });
    return JSON.stringify({ ok: true, auditId: event.id, createdAt: event.createdAt }, null, 2);
  }

  async requestApproval(args) {
    const session = await this.store.getSession(args.sessionId);
    if (!session) throw new Error(`Session not found: ${args.sessionId}`);
    const approval = {
      id: randomId("appr"),
      kind: "tool_call",
      status: "pending",
      sessionId: session.id,
      platform: session.platform,
      workspaceId: session.workspaceId,
      channelId: session.channelId,
      threadId: session.threadId,
      requestedBy: args.requestedBy || "mcp-tool",
      runtimeId: session.runtimeId,
      reason: args.reason,
      risks: args.risks || ["tool-call"],
      expiresAt: hoursFromNow(2),
      payload: { source: "mcp", requestedAt: nowIso() }
    };
    await this.store.createApproval(approval);
    await this.store.appendAudit({ type: "approval.created", sessionId: session.id, approvalId: approval.id, source: "mcp-tool", reason: approval.reason, risks: approval.risks });
    return JSON.stringify({ ok: true, approvalId: approval.id, status: approval.status, reason: approval.reason }, null, 2);
  }

  async postSlackReply(args) {
    if (!this.config.mcp?.allowSlackPost) {
      return JSON.stringify({ ok: false, error: "opentag.post_slack_reply is disabled. Set mcp.allowSlackPost=true to enable." }, null, 2);
    }
    if (this.config.mcp?.requireApprovalForSlackPost !== false) {
      if (!args.approvalId) {
        return JSON.stringify({ ok: false, approval_required: true, error: "approvalId is required before posting to Slack." }, null, 2);
      }
      const approval = await this.store.getApproval(args.approvalId);
      if (!approval || approval.status !== "approved") {
        return JSON.stringify({ ok: false, approval_required: true, error: `Approval ${args.approvalId} is not approved.` }, null, 2);
      }
    }
    const tokenEnv = this.config.slack?.botTokenEnv || "SLACK_BOT_TOKEN";
    const token = process.env[tokenEnv];
    if (!token) throw new Error(`Missing Slack bot token env ${tokenEnv}`);
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: args.channelId, thread_ts: args.threadTs, text: args.text })
    });
    const payload = await response.json();
    await this.store.appendAudit({ type: "tool.slack_post_reply", source: "mcp-tool", channelId: args.channelId, threadId: args.threadTs, ok: payload.ok, response: redact(payload) });
    return JSON.stringify(payload, null, 2);
  }

  textResult(text) {
    const max = this.config.mcp?.maxToolResultChars || 12000;
    const body = String(text || "");
    const value = body.length <= max ? body : `${body.slice(0, max - 32)}\n...[truncated by OpenTag]`;
    return { content: [{ type: "text", text: value }] };
  }
}

function publicSession(session) {
  return {
    id: session.id,
    platform: session.platform,
    workspaceId: session.workspaceId,
    channelId: session.channelId,
    threadId: session.threadId,
    runtimeId: session.runtimeId,
    status: session.status,
    turnCount: session.turnCount || 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastStartedAt: session.lastStartedAt,
    lastCompletedAt: session.lastCompletedAt,
    lastError: session.lastError
  };
}
