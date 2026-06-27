import test from "node:test";
import assert from "node:assert/strict";
import { PolicyEngine } from "../src/core/PolicyEngine.js";

const config = {
  security: {
    defaultDenyPatterns: ["rm\\s+-rf\\s+/"],
    defaultApprovalPatterns: ["deploy", "delete"]
  }
};

const channelConfig = {
  allowedUsers: [],
  allowedRuntimes: ["mock", "codex-readonly", "writer"],
  approvers: [],
  policy: { requireApprovalForWriteAccess: true, denyPatterns: [], requireApprovalPatterns: [] }
};

test("policy allows safe mock request", () => {
  const policy = new PolicyEngine({ config, logger: console });
  const result = policy.evaluate({ message: { userId: "U1", text: "summarize this" }, channelConfig, runtimeId: "mock", runtimeSpec: { type: "mock" } });
  assert.equal(result.decision, "allow");
});

test("policy denies destructive prompt", () => {
  const policy = new PolicyEngine({ config, logger: console });
  const result = policy.evaluate({ message: { userId: "U1", text: "please run rm -rf /" }, channelConfig, runtimeId: "mock", runtimeSpec: { type: "mock" } });
  assert.equal(result.decision, "deny");
});

test("policy requires approval for deploy prompt", () => {
  const policy = new PolicyEngine({ config, logger: console });
  const result = policy.evaluate({ message: { userId: "U1", text: "deploy to production" }, channelConfig, runtimeId: "mock", runtimeSpec: { type: "mock" } });
  assert.equal(result.decision, "require_approval");
});

test("policy requires approval for write-capable codex", () => {
  const policy = new PolicyEngine({ config, logger: console });
  const result = policy.evaluate({ message: { userId: "U1", text: "fix tests" }, channelConfig, runtimeId: "writer", runtimeSpec: { type: "codex", sandbox: "workspace-write" } });
  assert.equal(result.decision, "require_approval");
});

test("policy denies blocked user", () => {
  const policy = new PolicyEngine({ config, logger: console });
  const result = policy.evaluate({ message: { userId: "BAD", text: "hello" }, channelConfig: { ...channelConfig, blockedUsers: ["BAD"] }, runtimeId: "mock", runtimeSpec: { type: "mock" } });
  assert.equal(result.decision, "deny");
});

test("policy can disallow self approval", () => {
  const policy = new PolicyEngine({ config, logger: console });
  const allowed = policy.canApprove({ approval: { requestedBy: "U1" }, userId: "U1", channelConfig: { ...channelConfig, policy: { allowSelfApproval: false } } });
  assert.equal(allowed, false);
});

test("policy denies static cwd outside allowed roots", () => {
  const policy = new PolicyEngine({ config, logger: console });
  const result = policy.evaluate({
    message: { userId: "U1", text: "run" },
    channelConfig: { ...channelConfig, allowedRoots: [process.cwd()] },
    runtimeId: "writer",
    runtimeSpec: { type: "generic-cli", cwd: "/tmp/outside-opentag-root", requiresApproval: false }
  });
  assert.equal(result.decision, "deny");
});

test("policy denies disallowed runtime tool calls", () => {
  const policy = new PolicyEngine({ config, logger: console });
  const result = policy.evaluateToolCall({
    toolName: "Bash",
    argumentsText: "echo ok",
    channelConfig: { toolPolicy: { allowTools: ["Read", "Grep"] } }
  });
  assert.equal(result.decision, "deny");
});

test("policy requires approval for risky tool arguments", () => {
  const policy = new PolicyEngine({ config, logger: console });
  const result = policy.evaluateToolCall({
    toolName: "Bash",
    argumentsText: "deploy to production",
    channelConfig: { toolPolicy: { allowTools: ["Bash"] } }
  });
  assert.equal(result.decision, "require_approval");
});
