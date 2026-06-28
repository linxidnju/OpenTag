import { resolveChannelConfig } from "../config/loadConfig.js";
import { randomId } from "../utils/id.js";
import { nowIso, hoursFromNow } from "../utils/time.js";
import { redact } from "../utils/redact.js";
import { isBotOrSystemMessage } from "../gateways/slack/SlackMessageMapper.js";

export class OpenTagEngine {
  constructor({ config, store, sandboxManager, runtimeRegistry, policyEngine, contextBuilder, sessionManager, slackFileManager, pinnedContextReader, workspaceSearchIndexer, slackWorkspaceSearcher, channelMemoryService, artifactUploader, logger }) {
    this.config = config;
    this.store = store;
    this.sandboxManager = sandboxManager;
    this.runtimeRegistry = runtimeRegistry;
    this.policyEngine = policyEngine;
    this.contextBuilder = contextBuilder;
    this.sessionManager = sessionManager;
    this.slackFileManager = slackFileManager;
    this.pinnedContextReader = pinnedContextReader;
    this.workspaceSearchIndexer = workspaceSearchIndexer;
    this.slackWorkspaceSearcher = slackWorkspaceSearcher;
    this.channelMemoryService = channelMemoryService;
    this.artifactUploader = artifactUploader;
    this.logger = logger;
    this.queues = new Map();
    this.abortControllers = new Map();
  }

  async handleIncomingMessage(message, responder) {
    const { channel } = resolveChannelConfig(this.config, message);
    const runtimeOverride = parseRuntimeOverride(message.cleanText || message.text || "");
    const runtimeId = runtimeOverride.runtimeId || channel.defaultRuntime || this.config.runtimes.default;
    const cleanText = runtimeOverride.text || message.cleanText || message.text || "";

    let runtimeSpec;
    try {
      runtimeSpec = this.runtimeRegistry.getSpec(runtimeId);
    } catch (error) {
      await responder.fail(`Unknown runtime \`${runtimeId}\`: ${error.message}`);
      return;
    }

    const session = await this.sessionManager.getOrCreateSession({
      platform: message.platform,
      workspaceId: message.workspaceId,
      channelId: message.channelId,
      threadId: message.threadId,
      runtimeId,
      createdBy: message.userId
    });

    const command = parseOpenTagCommand(cleanText);
    if (command) return this.handleCommand({ command, session, message: { ...message, cleanText }, responder, channel });
    const memoryCommand = parseMemoryCommand(cleanText);
    if (memoryCommand) return this.handleMemoryCommand({ command: memoryCommand, session, message: { ...message, cleanText }, responder });

    await this.store.appendMessage(session.id, {
      role: "user",
      userId: message.userId,
      messageId: message.messageId,
      eventId: message.eventId,
      text: cleanText,
      rawText: message.text,
      files: message.files || [],
      platform: message.platform
    });

    await this.store.appendAudit({ type: "message.received", sessionId: session.id, runtimeId, userId: message.userId, messageId: message.messageId, isMention: message.isMention });

    return this.enqueue(session.id, async () => {
      await this.processTurn({ sessionId: session.id, message: { ...message, cleanText }, responder, runtimeId, runtimeSpec, channelConfig: channel });
    }, responder);
  }

  async runOneShot({ prompt, runtimeId, userId, workspaceId, channelId, threadId }) {
    const responder = createConsoleResponder();
    const message = {
      platform: "console",
      workspaceId,
      channelId,
      threadId,
      messageId: randomId("msg"),
      userId,
      text: prompt,
      cleanText: prompt,
      isMention: true,
      raw: {}
    };
    return this.handleIncomingMessage(message, responder);
  }

  async handleCommand({ command, session, responder }) {
    if (command.name === "help") {
      await responder.sendText([
        "OpenTag commands:",
        "`/opentag help` — show commands",
        "`/opentag status` — current thread session",
        "`/opentag context` — recent stored thread context",
        "`/opentag runtimes` — configured runtimes",
        "`/opentag sessions` — recent sessions",
        "`/opentag approvals` — pending approvals",
        "`/opentag audit` — recent audit events for this session",
        "`/opentag cancel` — cancel current running turn",
        "`/runtime <runtime-id> <request>` — route one request to a runtime"
      ].join("\n"));
      return;
    }
    if (command.name === "status") {
      const latest = await this.store.getSession(session.id);
      await responder.sendText(`Session ${latest.id}\nstatus=${latest.status}\nruntime=${latest.runtimeId}\nturns=${latest.turnCount || 0}\nupdated=${latest.updatedAt}`);
      return;
    }
    if (command.name === "context") {
      const messages = await this.store.listMessages(session.id, { limit: 12 });
      await responder.sendText(messages.length ? messages.map((m) => `- ${m.role || "user"}${m.userId ? ` ${m.userId}` : ""}: ${String(m.text || "").slice(0, 500)}`).join("\n") : "No stored messages for this session yet.");
      return;
    }
    if (command.name === "runtimes") {
      const runtimes = this.runtimeRegistry.list().map((r) => `- ${r.id} (${r.type})${r.command ? ` command=${r.command}` : ""}`).join("\n");
      await responder.sendText(`Configured runtimes:\n${runtimes}`);
      return;
    }
    if (command.name === "sessions") {
      const sessions = await this.store.listSessions({ limit: 10 });
      await responder.sendText(sessions.length ? sessions.map((s) => `- ${s.id} ${s.status} ${s.channelId}/${s.threadId} runtime=${s.runtimeId}`).join("\n") : "No sessions yet.");
      return;
    }
    if (command.name === "approvals") {
      const approvals = await this.store.listApprovals({ status: "pending", limit: 10 });
      await responder.sendText(approvals.length ? approvals.map((a) => `- ${a.id} session=${a.sessionId} reason=${a.reason}`).join("\n") : "No pending approvals.");
      return;
    }
    if (command.name === "audit") {
      const events = await this.store.listAudit({ sessionId: session.id, limit: 12 });
      await responder.sendText(events.length ? events.map((e) => `- ${e.createdAt} ${e.type}${e.decision ? ` decision=${e.decision}` : ""}${e.reason ? ` reason=${e.reason}` : ""}`).join("\n") : "No audit events for this session yet.");
      return;
    }
    if (command.name === "cancel") {
      await this.cancelSession(session.id, "cancelled by user");
      await responder.sendText(`Cancel signal sent for session ${session.id}`);
      return;
    }
  }

  async handleMemoryCommand({ command, session, message, responder }) {
    if (!this.channelMemoryService) {
      await responder.sendText("Memory is not configured.");
      return;
    }
    if (command.name === "remember") {
      const entry = await this.channelMemoryService.remember({
        workspaceId: session.workspaceId,
        channelId: session.channelId,
        channelType: message.channelType,
        text: command.text,
        createdBy: message.userId,
        source: { platform: message.platform, messageId: message.messageId, threadId: message.threadId }
      });
      const label = entry.scope === "channel" ? "private channel" : "workspace";
      await responder.sendText(`已记住（${label} memory）：${entry.id}`);
      return;
    }
    if (command.name === "list") {
      const entries = await this.channelMemoryService.listForContext({
        workspaceId: session.workspaceId,
        channelId: session.channelId,
        channelType: message.channelType
      });
      await responder.sendText(entries.length ? entries.map((entry) => `- ${entry.id} [${entry.scope}]: ${entry.text}`).join("\n") : "当前没有可用 memory。");
      return;
    }
    if (command.name === "forget") {
      const deleted = await this.channelMemoryService.forget({
        workspaceId: session.workspaceId,
        channelId: session.channelId,
        memoryId: command.memoryId,
        deletedBy: message.userId
      });
      await responder.sendText(deleted ? `已删除 memory：${command.memoryId}` : `没有找到 memory：${command.memoryId}`);
    }
  }

  async handleSlashCommand({ text, responder }) {
    const command = parseAdminCommand(text || "help");
    if (command.name === "help") return responder.sendText(formatHelp());
    if (command.name === "runtimes") return responder.sendText(this.formatRuntimes());
    if (command.name === "sessions") return responder.sendText(formatSessions(await this.store.listSessions({ limit: command.limit || 10 })));
    if (command.name === "approvals") return responder.sendText(formatApprovals(await this.store.listApprovals({ status: command.status, limit: command.limit || 10 })));
    if (command.name === "audit") return responder.sendText(formatAudit(await this.store.listAudit({ sessionId: command.sessionId, limit: command.limit || 20 })));
    if (command.name === "status") return responder.sendText(formatSessionStatus(command.sessionId ? await this.store.getSession(command.sessionId) : null));
    if (command.name === "cancel") {
      if (!command.sessionId) return responder.sendText("Usage: /opentag cancel <session_id>");
      await this.cancelSession(command.sessionId, "cancelled by slash command");
      return responder.sendText(`Cancelled ${command.sessionId}`);
    }
    return responder.sendText(`Unknown OpenTag slash command: ${command.name}`);
  }

  async processTurn({ sessionId, message, responder, runtimeId, runtimeSpec = null, channelConfig, approvedBy = null }) {
    let session = await this.store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    runtimeSpec = runtimeSpec || this.runtimeRegistry.getSpec(runtimeId);
    const policy = approvedBy ? { decision: "allow", reason: `approved by ${approvedBy}`, risks: [] } : this.policyEngine.evaluate({ message, channelConfig, runtimeId, runtimeSpec });

    await this.store.appendAudit({ type: "policy.evaluated", sessionId, runtimeId, userId: message.userId, decision: policy.decision, reason: policy.reason, risks: policy.risks });

    if (policy.decision === "deny") {
      await responder.fail(`OpenTag denied this request: ${policy.reason}`);
      await this.sessionManager.setStatus(session, "active");
      return;
    }

    if (policy.decision === "require_approval") {
      const approval = await this.createApproval({ session, message, runtimeId, channelConfig, policy, kind: "turn" });
      await this.sessionManager.setStatus(session, "waiting_approval", { waitingApprovalId: approval.id });
      await responder.sendApproval(approval);
      return;
    }

    await this.executeRuntimeTurn({ session, message, responder, runtimeId, channelConfig, approvedBy });
  }

  async createApproval({ session, message, runtimeId, channelConfig, policy, kind = "turn" }) {
    const approval = {
      id: randomId("appr"),
      kind,
      status: "pending",
      sessionId: session.id,
      platform: session.platform,
      workspaceId: session.workspaceId,
      channelId: session.channelId,
      threadId: session.threadId,
      requestedBy: message.userId,
      requiredApprovers: channelConfig.approvers || [],
      runtimeId,
      reason: policy.reason,
      risks: policy.risks,
      expiresAt: hoursFromNow(2),
      payload: {
        message: {
          ...message,
          raw: undefined
        },
        channelConfig
      }
    };
    await this.store.createApproval(approval);
    await this.store.appendAudit({ type: "approval.created", sessionId: session.id, approvalId: approval.id, kind, reason: approval.reason, risks: approval.risks });
    return approval;
  }

  async approve(approvalId, approverUserId, responder) {
    const approval = await this.store.getApproval(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status !== "pending") {
      await this.store.appendAudit({ type: "approval.duplicate_action_ignored", approvalId, sessionId: approval.sessionId, approverUserId, status: approval.status });
      return;
    }
    if (Date.parse(approval.expiresAt) < Date.now()) {
      approval.status = "expired";
      await this.store.saveApproval(approval);
      await responder.fail(`Approval ${approvalId} has expired.`);
      return;
    }

    const { channel } = resolveChannelConfig(this.config, approval);
    if (!this.policyEngine.canApprove({ approval, userId: approverUserId, channelConfig: channel })) {
      await this.store.appendAudit({ type: "approval.rejected", approvalId, sessionId: approval.sessionId, approverUserId, reason: "not-authorized" });
      await responder.fail(`User ${approverUserId} cannot approve this request.`);
      return;
    }

    approval.status = "approved";
    approval.approvedBy = approverUserId;
    await this.store.saveApproval(approval);
    await this.store.appendAudit({ type: "approval.approved", approvalId, sessionId: approval.sessionId, approverUserId });

    if (approval.kind && approval.kind !== "turn") {
      await responder.sendText(`Approval ${approvalId} approved by <@${approverUserId}>.`);
      return;
    }

    await responder.sendStatus("OpenTag is working on it.");
    return this.enqueue(approval.sessionId, async () => {
      await this.processTurn({
        sessionId: approval.sessionId,
        message: approval.payload.message,
        responder,
        runtimeId: approval.runtimeId,
        channelConfig: approval.payload.channelConfig,
        approvedBy: approverUserId
      });
    }, responder);
  }

  async denyApproval(approvalId, denierUserId, responder) {
    const approval = await this.store.getApproval(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.status !== "pending") {
      await responder.sendText(`Approval ${approvalId} is already ${approval.status}.`);
      return;
    }
    approval.status = "denied";
    approval.deniedBy = denierUserId;
    await this.store.saveApproval(approval);
    await this.store.appendAudit({ type: "approval.denied", approvalId, sessionId: approval.sessionId, denierUserId });
    const session = await this.store.getSession(approval.sessionId);
    if (session?.status === "waiting_approval") await this.sessionManager.setStatus(session, "active", { waitingApprovalId: null });
    await responder.sendText(`Approval ${approvalId} denied by <@${denierUserId}>.`);
  }

  async executeRuntimeTurn({ session, message, responder, runtimeId, channelConfig, approvedBy }) {
    const adapter = this.runtimeRegistry.get(runtimeId);
    const sandbox = await this.sandboxManager.createSandbox({ sessionId: session.id, runtimeId, channelConfig });
    const preparedContext = await this.prepareRuntimeContext({ message, responder, sandbox, session, runtimeId });
    message = { ...message, ...preparedContext, sandboxInputDir: sandbox.inputDir, sandboxOutputDir: sandbox.outputDir };
    const prompt = await this.contextBuilder.build({ session, incomingMessage: message, channelConfig, runtimeId });
    const controller = new AbortController();
    this.abortControllers.set(session.id, controller);
    let finalText = "";
    let emittedText = "";
    let pausedForApproval = false;

    await this.store.createRun({
      id: sandbox.id,
      sessionId: session.id,
      runtimeId,
      status: "running",
      sandboxDir: sandbox.dir,
      workspaceRoot: sandbox.workspaceRoot,
      approvedBy,
      startedAt: nowIso()
    });

    session = await this.sessionManager.setStatus(session, "running", { runtimeId, currentRunId: sandbox.id, waitingApprovalId: null, lastStartedAt: nowIso() });
    await responder.sendStatus(`OpenTag started runtime \`${runtimeId}\` for this thread.`);
    await this.store.appendAudit({ type: "runtime.started", sessionId: session.id, runtimeId, sandboxId: sandbox.id, approvedBy });

    try {
      for await (const event of adapter.run({ prompt, message, session, sandbox, signal: controller.signal })) {
        if (event.type === "started") {
          await responder.sendStatus(event.message || `Runtime ${runtimeId} is running...`);
        } else if (event.type === "token") {
          emittedText += event.text || "";
          await responder.appendToken(event.text || "");
        } else if (event.type === "log") {
          this.logger.debug("runtime.log", { runtimeId, sessionId: session.id, message: redact(event.message || "") });
        } else if (event.type === "tool_call") {
          const toolName = event.name || "tool";
          const toolPolicy = this.policyEngine.evaluateToolCall({ toolName, argumentsText: event.argumentsText || event.arguments || "", channelConfig });
          await this.store.appendAudit({ type: "runtime.tool_call", sessionId: session.id, runtimeId, tool: toolName, risk: event.risk || null, decision: toolPolicy.decision, reason: toolPolicy.reason });
          if (toolPolicy.decision === "deny") throw new Error(`Tool call denied: ${toolPolicy.reason}`);
          if (approvedBy && toolPolicy.decision === "require_approval") {
            await this.store.appendAudit({ type: "runtime.tool_call_covered_by_turn_approval", sessionId: session.id, runtimeId, tool: toolName, approvedBy, reason: toolPolicy.reason });
            continue;
          }
          if (toolPolicy.decision === "require_approval") {
            const approval = await this.createApproval({ session, message, runtimeId, channelConfig, policy: toolPolicy, kind: "tool_call" });
            await this.sessionManager.setStatus(session, "waiting_approval", { waitingApprovalId: approval.id, currentRunId: null });
            await responder.sendApproval(approval);
            await this.store.appendAudit({ type: "runtime.approval_requested", sessionId: session.id, runtimeId, approvalId: approval.id, source: "tool_policy" });
            pausedForApproval = true;
            break;
          }
        } else if (event.type === "approval_request") {
          const approval = await this.createApproval({ session, message, runtimeId, channelConfig, policy: { reason: event.reason || "Runtime requested approval", risks: event.risks || ["runtime-request"] }, kind: "tool_call" });
          await this.sessionManager.setStatus(session, "waiting_approval", { waitingApprovalId: approval.id, currentRunId: null });
          await responder.sendApproval(approval);
          await this.store.appendAudit({ type: "runtime.approval_requested", sessionId: session.id, runtimeId, approvalId: approval.id, source: "runtime" });
          pausedForApproval = true;
          break;
        } else if (event.type === "artifact") {
          const artifact = await this.store.createArtifact({ id: randomId("art"), sessionId: session.id, runId: sandbox.id, runtimeId, path: event.path, relativePath: event.relativePath || event.path, title: event.title, mimeType: event.mimeType });
          await responder.sendText(`Artifact: ${artifact.relativePath || artifact.path}`);
          await this.store.appendAudit({ type: "runtime.artifact", sessionId: session.id, runtimeId, artifactId: artifact.id, path: artifact.path });
        } else if (event.type === "completed") {
          finalText = event.output || event.summary || emittedText || "Runtime completed.";
        } else if (event.type === "failed") {
          throw new Error(event.error || "Runtime failed");
        }
      }

      if (pausedForApproval) {
        await this.store.updateRun(sandbox.id, { status: "waiting_approval", outputPreview: (finalText || emittedText).slice(0, 4000), completedAt: nowIso() });
        return;
      }

      const collectedArtifacts = await collectAndRecordArtifacts({ store: this.store, sandboxManager: this.sandboxManager, sandbox, sessionId: session.id, runtimeId, responder, artifactUploader: this.artifactUploader, logger: this.logger });
      await responder.complete(finalText || emittedText || "Runtime completed.");
      await this.store.appendMessage(session.id, { role: "assistant", runtimeId, text: finalText || emittedText || "Runtime completed." });
      session = await this.sessionManager.incrementTurn(session);
      await this.sessionManager.setStatus(session, "active", { lastCompletedAt: nowIso(), currentRunId: null });
      await this.store.updateRun(sandbox.id, { status: "completed", outputPreview: (finalText || emittedText).slice(0, 4000), artifactCount: collectedArtifacts.length, completedAt: nowIso() });
      await this.store.appendAudit({ type: "runtime.completed", sessionId: session.id, runtimeId, sandboxId: sandbox.id, artifactCount: collectedArtifacts.length });
    } catch (error) {
      const messageText = error && error.message ? error.message : String(error);
      await collectAndRecordArtifacts({ store: this.store, sandboxManager: this.sandboxManager, sandbox, sessionId: session.id, runtimeId, responder, artifactUploader: this.artifactUploader, logger: this.logger }).catch(() => []);
      await responder.fail(messageText);
      const status = controller.signal.aborted ? "cancelled" : "failed";
      await this.sessionManager.setStatus(session, status, { lastError: messageText, currentRunId: null });
      await this.store.updateRun(sandbox.id, { status, error: messageText, completedAt: nowIso() }).catch(() => null);
      await this.store.appendAudit({ type: "runtime.failed", sessionId: session.id, runtimeId, sandboxId: sandbox.id, error: messageText });
    } finally {
      this.abortControllers.delete(session.id);
      await this.sandboxManager.cleanupSandbox(sandbox).catch((error) => this.logger.warn("sandbox.cleanup_failed", { sessionId: session.id, sandboxId: sandbox.id, error: error.message }));
    }
  }

  async prepareRuntimeContext({ message, responder, sandbox, session, runtimeId }) {
    const client = responder?.client;
    const downloadedFiles = await this.slackFileManager?.downloadMessageFiles({
      client,
      message,
      sandbox,
      store: this.store,
      sessionId: session.id,
      runtimeId
    }) || [];
    const pinnedItems = await this.pinnedContextReader?.read({
      client,
      channelId: message.channelId,
      botUserId: message.botUserId
    }) || [];
    const channelHistoryMessages = await this.readChannelHistory({
      client,
      channelId: message.channelId,
      botUserId: message.botUserId
    });
    const channelMemory = await this.channelMemoryService?.listForContext({
      workspaceId: session.workspaceId,
      channelId: session.channelId,
      channelType: message.channelType
    }) || [];
    const threadMessages = [
      ...channelHistoryMessages,
      ...(message.externalThreadMessages || []),
      { text: message.cleanText || message.text, ts: message.messageId, threadId: message.threadId }
    ];
    await this.workspaceSearchIndexer?.indexRuntimeContext({
      workspaceId: session.workspaceId,
      channelId: session.channelId,
      threadMessages,
      pinnedItems,
      files: downloadedFiles
    });
    const localSearchHits = await this.workspaceSearchIndexer?.search({
      workspaceId: session.workspaceId,
      channelId: session.channelId,
      query: message.cleanText || message.text || ""
    }) || [];
    const slackSearchHits = await this.slackWorkspaceSearcher?.search({
      client,
      query: message.cleanText || message.text || "",
      limit: this.config.workspaceSearch?.slackSearchMaxResults
    }) || [];
    const workspaceSearchHits = [...slackSearchHits, ...localSearchHits].slice(0, Number(this.config.workspaceSearch?.maxHits || 8));
    return { downloadedFiles, pinnedItems, channelHistoryMessages, channelMemory, workspaceSearchHits };
  }

  async readChannelHistory({ client, channelId, botUserId }) {
    if (!client?.conversations?.history || !channelId || this.config.workspaceSearch?.enabled === false) return [];
    const days = Number(this.config.workspaceSearch?.defaultDays || 14);
    const configuredLimit = Number(this.config.workspaceSearch?.maxMessagesPerChannel || 200);
    const limit = Math.max(1, Math.min(configuredLimit, 200));
    const oldest = String(Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000));
    try {
      const response = await client.conversations.history({
        channel: channelId,
        limit,
        oldest,
        inclusive: true
      });
      return (response.messages || [])
        .filter((item) => !isBotOrSystemMessage(item, { botUserId, ignoreEditedMessages: this.config.slack?.ignoreEditedMessages }))
        .map((item) => ({
          ...item,
          text: String(item.text || "").replace(/\s+/g, " ").trim()
        }));
    } catch (error) {
      this.logger?.warn?.("slack.channel_history_failed", { channelId, error: error.message });
      return [];
    }
  }

  async cancelSession(sessionId, reason = "cancelled") {
    const controller = this.abortControllers.get(sessionId);
    if (controller) controller.abort(new Error(reason));
    const session = await this.store.getSession(sessionId);
    if (session) await this.sessionManager.setStatus(session, "cancelled", { cancelReason: reason, currentRunId: null });
    await this.store.appendAudit({ type: "session.cancelled", sessionId, reason });
  }

  formatRuntimes() {
    const runtimes = this.runtimeRegistry.list().map((r) => `- ${r.id} (${r.type}${r.command ? `: ${r.command}` : ""})`).join("\n");
    return `Configured runtimes:\n${runtimes || "(none)"}`;
  }

  enqueue(sessionId, fn, responder) {
    const existing = this.queues.get(sessionId);
    if (existing && responder) void responder.sendStatus("This OpenTag thread is busy; your request was queued.");
    const next = (existing || Promise.resolve())
      .catch((error) => {
        this.logger.error("Previous queued job failed", { sessionId, error: error.message });
      })
      .then(fn)
      .finally(() => {
        if (this.queues.get(sessionId) === next) this.queues.delete(sessionId);
      });
    this.queues.set(sessionId, next);
    return next;
  }
}


async function collectAndRecordArtifacts({ store, sandboxManager, sandbox, sessionId, runtimeId, responder, artifactUploader, logger }) {
  let artifacts = [];
  try {
    artifacts = await sandboxManager.collectArtifacts({ sandbox, sessionId, runtimeId });
  } catch (error) {
    logger?.warn?.("artifact.collection_failed", { sessionId, runId: sandbox?.id, error: error.message });
    return [];
  }

  const created = [];
  for (const artifact of artifacts) {
    try {
      const record = await store.createArtifact(artifact);
      created.push(record);
      await store.appendAudit({ type: "artifact.collected", sessionId, runtimeId, runId: sandbox.id, artifactId: record.id, path: record.path, size: record.size });
    } catch (error) {
      logger?.warn?.("artifact.record_failed", { sessionId, runId: sandbox?.id, path: artifact.path, error: error.message });
    }
  }

  const shouldUpload = Boolean(artifactUploader?.isEnabled?.() && responder?.client && responder?.channelId && responder?.threadTs);
  if (created.length && shouldUpload && responder?.sendText) {
    const uploaded = await artifactUploader?.uploadArtifacts({
      client: responder.client,
      channelId: responder.channelId,
      threadTs: responder.threadTs,
      artifacts: created,
      store,
      sessionId,
      runtimeId
    }).catch((error) => {
      logger?.warn?.("artifact.upload_batch_failed", { sessionId, runtimeId, error: error.message });
      return [];
    });
    const uploadedCount = (uploaded || []).filter((item) => item.ok).length;
    if (uploadedCount < created.length) {
      await responder.sendText(uploadedCount ? "部分文件已上传，另有文件已保存在本地 artifact 记录中。" : "文件已生成，但上传到 Slack 失败；已保存在本地 artifact 记录中。").catch?.(() => null);
    }
  }

  return created;
}

function parseRuntimeOverride(text) {
  const match = String(text).match(/^\s*\/runtime\s+([A-Za-z0-9_.-]+)\s*([\s\S]*)$/i);
  if (!match) return { runtimeId: null, text };
  return { runtimeId: match[1], text: match[2] || "" };
}

function parseOpenTagCommand(text) {
  const match = String(text).trim().match(/^\/opentag(?:\s+(help|status|runtimes|cancel|sessions|approvals|audit|context))?\s*$/i);
  if (!match) return null;
  return { name: (match[1] || "help").toLowerCase() };
}

function parseMemoryCommand(text) {
  const value = String(text || "").trim();
  const remember = value.match(/^(?:remember|please remember|记住|请记住|帮我记住)(?:\s+(?:for|in)\s+(?:this\s+)?channel|这个频道|在这个频道)?[:：\s]+([\s\S]+)$/i);
  if (remember?.[1]?.trim()) return { name: "remember", text: remember[1].trim() };
  const forget = value.match(/^(?:forget memory|forget|delete memory|删除记忆|忘记)\s+([A-Za-z0-9_.-]+)$/i);
  if (forget?.[1]) return { name: "forget", memoryId: forget[1] };
  if (/^(?:memory|show memory|what do you remember|list memory|你记得什么|你记住了什么|显示记忆|查看记忆)\??$/i.test(value)) return { name: "list" };
  return null;
}

function parseAdminCommand(text) {
  const parts = String(text || "help").trim().split(/\s+/).filter(Boolean);
  const name = (parts.shift() || "help").toLowerCase();
  const command = { name, args: parts };
  if (["sessions", "approvals", "audit"].includes(name)) {
    const limitIndex = parts.findIndex((part) => /^\d+$/.test(part));
    if (limitIndex >= 0) command.limit = Number(parts[limitIndex]);
  }
  if (["status", "cancel"].includes(name)) command.sessionId = parts[0];
  if (name === "audit") command.sessionId = parts.find((part) => part.startsWith("sess_"));
  if (name === "approvals") command.status = parts.find((part) => ["pending", "approved", "denied", "expired"].includes(part));
  return command;
}

function formatHelp() {
  return [
    "OpenTag slash commands:",
    "`/opentag help`",
    "`/opentag runtimes`",
    "`/opentag sessions [limit]`",
    "`/opentag status <session_id>`",
    "`/opentag approvals [pending|approved|denied] [limit]`",
    "`/opentag audit [session_id] [limit]`",
    "`/opentag cancel <session_id>`",
    "",
    "Inside a thread: `/opentag status`, `/opentag runtimes`, `/opentag approvals`, `/opentag cancel`, `/runtime <runtime-id> <request>`."
  ].join("\n");
}

function formatSessionStatus(session) {
  if (!session) return "Session not found.";
  return [
    `Session ${session.id}`,
    `status=${session.status}`,
    `runtime=${session.runtimeId || "unknown"}`,
    `thread=${session.platform}:${session.workspaceId}/${session.channelId}/${session.threadId}`,
    `turns=${session.turnCount || 0}`,
    `updatedAt=${session.updatedAt || "unknown"}`,
    session.lastError ? `lastError=${session.lastError}` : null
  ].filter(Boolean).join("\n");
}

function formatSessions(sessions) {
  if (!sessions.length) return "No OpenTag sessions yet.";
  return sessions.map((session) => `- ${session.id} status=${session.status} runtime=${session.runtimeId} channel=${session.channelId} thread=${session.threadId} updated=${session.updatedAt}`).join("\n");
}

function formatApprovals(approvals) {
  if (!approvals.length) return "No approvals found.";
  return approvals.map((approval) => `- ${approval.id} status=${approval.status} runtime=${approval.runtimeId} session=${approval.sessionId} requestedBy=${approval.requestedBy} reason=${approval.reason}`).join("\n");
}

function formatAudit(events) {
  if (!events.length) return "No audit events found.";
  return events.map((event) => `- ${event.createdAt} ${event.type}${event.sessionId ? ` session=${event.sessionId}` : ""}${event.runtimeId ? ` runtime=${event.runtimeId}` : ""}${event.reason ? ` reason=${event.reason}` : ""}`).join("\n");
}

function createConsoleResponder() {
  return {
    sendStatus: async (text) => console.log(`[status] ${text}`),
    sendText: async (text) => console.log(text),
    appendToken: async (text) => process.stdout.write(text),
    complete: async (text) => console.log(`\n[complete]\n${text}`),
    fail: async (text) => console.error(`[error] ${text}`),
    sendApproval: async (approval) => console.log(`[approval required] ${approval.id}: ${approval.reason}`)
  };
}
