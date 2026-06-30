import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createTask, TASK_SCHEMA_VERSION, validateTask } from "../src/core/Task.js";
import { TaskRouter } from "../src/core/TaskRouter.js";
import { RuntimeRegistry } from "../src/core/RuntimeRegistry.js";
import { normalizeRuntimeEvent, RUNTIME_EVENT_SCHEMA_VERSION } from "../src/core/RuntimeEvent.js";
import { buildOpenTag } from "../src/opentag.js";
import { createLogger } from "../src/utils/logger.js";

test("createTask produces a stable v1 task contract", () => {
  const task = createTask({
    message: {
      platform: "slack",
      workspaceId: "T1",
      channelId: "C1",
      threadId: "100.1",
      messageId: "100.2",
      eventId: "Ev1",
      userId: "U1",
      text: "<@BOT> hello",
      cleanText: "hello",
      isMention: true,
      files: [{ id: "F1", name: "input.csv" }]
    },
    session: { id: "sess_1" },
    runtimeId: "codex-readonly",
    runtimeSpec: { type: "codex", allowedTools: ["Read"] },
    channelConfig: { policy: { requireApprovalForWriteAccess: true } }
  });

  assert.equal(task.schemaVersion, TASK_SCHEMA_VERSION);
  assert.equal(task.source, "slack");
  assert.equal(task.prompt, "hello");
  assert.equal(task.runtime, "codex-readonly");
  assert.deepEqual(task.tools.allowed, ["Read"]);
  assert.equal(task.context.files[0].name, "input.csv");
  assert.equal(validateTask(task), true);
});

test("TaskRouter chooses a capability-compatible fallback runtime", () => {
  const config = {
    runtimes: {
      default: "readonly",
      adapters: {
        readonly: { type: "codex", capabilities: { readOnly: true } },
        writer: { type: "codex", sandbox: "workspace-write" }
      }
    }
  };
  const runtimeRegistry = new RuntimeRegistry({ config: config.runtimes, logger: createLogger({ level: "silent" }) });
  const router = new TaskRouter({ config, runtimeRegistry, logger: createLogger({ level: "silent" }) });

  const route = router.route({
    message: { cleanText: "edit this file" },
    channelConfig: {
      defaultRuntime: "readonly",
      runtimeFallbacks: ["writer"],
      allowedRuntimes: ["readonly", "writer"]
    }
  });

  assert.equal(route.runtimeId, "writer");
  assert.equal(route.reason, "fallback");
  assert.ok(route.denied.some((item) => item.runtimeId === "readonly" && item.reason === "requires_write_access"));
});

test("TaskRouter skips unhealthy, over-budget, and missing-tool runtimes", () => {
  const config = {
    runtimes: {
      default: "down",
      adapters: {
        down: { type: "generic-cli", health: { status: "down" }, capabilities: { tools: ["shell", "file_write"] } },
        expensive: { type: "generic-cli", cost: { estimatedUsd: 5 }, capabilities: { tools: ["shell", "file_write"] } },
        noShell: { type: "generic-cli", cost: { estimatedUsd: 0.01 }, capabilities: { tools: ["file_write"] } },
        ready: { type: "generic-cli", cost: { estimatedUsd: 0.02 }, capabilities: { tools: ["shell", "file_write"] } }
      }
    }
  };
  const runtimeRegistry = new RuntimeRegistry({ config: config.runtimes, logger: createLogger({ level: "silent" }) });
  const router = new TaskRouter({ config, runtimeRegistry, logger: createLogger({ level: "silent" }) });

  const route = router.route({
    message: { cleanText: "fix the bug and run npm test" },
    channelConfig: {
      defaultRuntime: "down",
      runtimeFallbacks: ["expensive", "noShell", "ready"],
      allowedRuntimes: ["down", "expensive", "noShell", "ready"],
      routing: { maxEstimatedCostUsd: 0.1 }
    }
  });

  assert.equal(route.runtimeId, "ready");
  assert.equal(route.taskClass, "code");
  assert.equal(route.requiredCapabilities.writeAccess, true);
  assert.deepEqual(route.requiredCapabilities.shell, true);
  assert.ok(route.denied.some((item) => item.runtimeId === "down" && item.reason === "health_down"));
  assert.ok(route.denied.some((item) => item.runtimeId === "expensive" && item.reason === "cost_exceeds_channel_budget"));
  assert.ok(route.denied.some((item) => item.runtimeId === "noShell" && item.reason === "missing_tool_shell"));
});

test("normalizeRuntimeEvent maps aliases into the v1 runtime event contract", () => {
  assert.deepEqual(normalizeRuntimeEvent({ type: "text_delta", delta: "hi" }), {
    schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
    type: "token",
    text: "hi"
  });
  assert.deepEqual(normalizeRuntimeEvent({ type: "tool_call", tool: "Bash", input: { command: "ls" } }), {
    schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
    type: "tool_call",
    id: null,
    name: "Bash",
    risk: null,
    argumentsText: "{\"command\":\"ls\"}"
  });
  assert.equal(normalizeRuntimeEvent({ type: "error", message: "boom" }).type, "failed");
});

test("engine records task id on audit and run records", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-task-contract-"));
  const config = {
    app: { name: "OpenTag", dataDir: path.join(dir, "data"), logLevel: "silent" },
    gateway: "console",
    slack: { mode: "socket", processThreadReplies: true, streamUpdateMs: 1, maxMessageChars: 35000 },
    sessions: { maxContextMessages: 8, idleTtlHours: 72 },
    sandbox: { rootDir: path.join(dir, "sandboxes"), mode: "ephemeral", cleanupOnComplete: false, retentionHours: 24 },
    security: { redactSecrets: true, defaultDenyPatterns: [], defaultApprovalPatterns: [] },
    workspaces: [{ workspaceId: "*", channels: [{ channelId: "*", name: "default", defaultRuntime: "mock", allowedRuntimes: ["mock"], allowedUsers: [], approvers: [], policy: { requireApprovalForWriteAccess: false, requireApprovalPatterns: [], denyPatterns: [] } }] }],
    runtimes: { default: "mock", adapters: { mock: { type: "mock", delayMs: 0 } } }
  };
  const app = await buildOpenTag(config, { logger: createLogger({ level: "silent" }) });
  const events = [];
  const responder = {
    sendStatus: async (text) => events.push(["status", text]),
    sendText: async (text) => events.push(["text", text]),
    appendToken: async (text) => events.push(["token", text]),
    complete: async (text) => events.push(["complete", text]),
    fail: async (text) => events.push(["fail", text]),
    sendApproval: async (approval) => events.push(["approval", approval])
  };

  try {
    await app.engine.handleIncomingMessage({ platform: "slack", workspaceId: "T1", channelId: "C1", threadId: "1", messageId: "1", userId: "U1", text: "hello", cleanText: "hello", isMention: true, raw: {} }, responder);
    const audit = await app.store.listAudit({});
    const taskCreated = audit.find((event) => event.type === "task.created");
    assert.ok(taskCreated?.taskId);
    const runs = await app.store.listRuns({});
    assert.equal(runs.length, 1);
    assert.equal(runs[0].taskId, taskCreated.taskId);
    const runtimeEvents = await app.store.listRuntimeEvents({ runId: runs[0].id });
    assert.ok(runtimeEvents.length >= 2);
    assert.deepEqual(runtimeEvents.map((event) => event.seq), runtimeEvents.map((_, index) => index + 1));
    assert.ok(runtimeEvents.every((event) => event.schemaVersion === RUNTIME_EVENT_SCHEMA_VERSION));
    assert.ok(runtimeEvents.every((event) => event.taskId === taskCreated.taskId));
    assert.ok(runtimeEvents.every((event) => event.sessionId === taskCreated.sessionId));
    assert.ok(runtimeEvents.every((event) => event.runtimeId === "mock"));
    assert.ok(audit.some((event) => event.type === "runtime.completed" && event.taskId === taskCreated.taskId));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
