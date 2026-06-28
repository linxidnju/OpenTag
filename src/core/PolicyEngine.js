import path from "node:path";

export class PolicyEngine {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
  }

  evaluate({ message, channelConfig, runtimeId, runtimeSpec }) {
    const text = message.cleanText || message.text || "";
    const allowedUsers = channelConfig.allowedUsers || [];
    const blockedUsers = channelConfig.blockedUsers || [];

    if (blockedUsers.includes(message.userId)) {
      return deny(`User ${message.userId} is blocked in this channel`);
    }

    if (allowedUsers.length && !allowedUsers.includes(message.userId)) {
      return deny(`User ${message.userId} is not allowed in this channel`);
    }

    const allowedRuntimes = channelConfig.allowedRuntimes || [];
    if (allowedRuntimes.length && !allowedRuntimes.includes(runtimeId)) {
      return deny(`Runtime ${runtimeId} is not allowed in this channel`);
    }

    const cwdPolicy = checkStaticCwd(runtimeSpec?.cwd, channelConfig.allowedRoots || []);
    if (cwdPolicy) return deny(cwdPolicy);

    const rootDecision = evaluateAllowedRoots({ channelConfig, runtimeSpec });
    if (rootDecision) return rootDecision;

    const denied = firstMatchingPattern(text, mergedPatterns(this.config.security?.defaultDenyPatterns, channelConfig.policy?.denyPatterns));
    if (denied) return deny(`Request matched deny pattern: ${denied}`);

    const matchedApprovalPattern = firstMatchingPattern(text, mergedPatterns(this.config.security?.defaultApprovalPatterns, channelConfig.policy?.requireApprovalPatterns));
    if (matchedApprovalPattern) {
      return approval(`Request matched approval pattern: ${matchedApprovalPattern}`, ["prompt-risk"]);
    }

    if (channelConfig.policy?.requireApprovalForWriteAccess && runtimeNeedsWriteApproval(runtimeSpec)) {
      return approval(`Runtime ${runtimeId} can write or execute commands; approval is required by channel policy`, ["runtime-write-access"]);
    }

    return allow("allowed");
  }

  evaluateToolCall({ toolName, argumentsText = "", channelConfig = {} }) {
    const text = `${toolName || "tool"}\n${stringifyArguments(argumentsText)}`;
    const toolPolicy = channelConfig.toolPolicy || channelConfig.policy?.tools || {};
    const allowTools = toolPolicy.allowTools || channelConfig.allowedTools || [];
    const denyTools = toolPolicy.denyTools || channelConfig.deniedTools || [];
    const requireApprovalTools = toolPolicy.requireApprovalTools || channelConfig.requireApprovalTools || [];

    if (denyTools.some((pattern) => matchTool(pattern, toolName))) {
      return deny(`Tool ${toolName} is denied by channel policy`);
    }

    if (allowTools.length && !allowTools.some((pattern) => matchTool(pattern, toolName))) {
      return deny(`Tool ${toolName} is not in channel allowedTools`);
    }

    const denied = firstMatchingPattern(text, mergedPatterns(this.config.security?.defaultDenyPatterns, toolPolicy.denyPatterns, channelConfig.policy?.denyPatterns));
    if (denied) return deny(`Tool call matched deny pattern: ${denied}`);

    if (requireApprovalTools.some((pattern) => matchTool(pattern, toolName))) {
      return approval(`Tool ${toolName} requires approval by channel policy`, ["tool-risk"]);
    }

    const approvalPattern = firstMatchingPattern(text, mergedPatterns(this.config.security?.defaultApprovalPatterns, toolPolicy.requireApprovalPatterns));
    if (approvalPattern) return approval(`Tool call matched approval pattern: ${approvalPattern}`, ["tool-risk"]);

    return allow("tool allowed");
  }

  canApprove({ approval, userId, channelConfig }) {
    const adminUsers = this.config.security?.adminUsers || [];
    if (adminUsers.includes(userId)) return true;
    const approvers = channelConfig.approvers || [];
    const allowSelfApproval = channelConfig.policy?.allowSelfApproval !== false;
    if (approvers.includes(userId)) return true;
    if (allowSelfApproval && approval.requestedBy === userId) return true;
    return false;
  }
}

function allow(reason) {
  return { decision: "allow", reason, risks: [] };
}

function deny(reason) {
  return { decision: "deny", reason, risks: ["deny"] };
}

function approval(reason, risks) {
  return { decision: "require_approval", reason, risks };
}

function mergedPatterns(...groups) {
  return groups.flatMap((group) => Array.isArray(group) ? group : []).filter(Boolean);
}

function firstMatchingPattern(text, patterns) {
  for (const pattern of patterns || []) {
    try {
      const regex = new RegExp(pattern, "i");
      if (regex.test(text)) return pattern;
    } catch {
      if (String(text).toLowerCase().includes(String(pattern).toLowerCase())) return pattern;
    }
  }
  return null;
}

function runtimeNeedsWriteApproval(spec = {}) {
  if (spec.type === "mock") return false;
  if (spec.type === "codex") return spec.sandbox && spec.sandbox !== "read-only";
  if (spec.type === "claude-code") {
    const tools = (spec.allowedTools || []).join(",").toLowerCase();
    if (!tools) return Boolean(spec.requiresApproval);
    return /edit|write|bash|notebookedit|multiedit/.test(tools);
  }
  if (spec.type === "docker") return spec.readOnly ? spec.requiresApproval === true : spec.requiresApproval !== false;
  if (spec.type === "opencode" || spec.type === "generic-cli" || spec.type === "http") {
    return spec.requiresApproval !== false;
  }
  return true;
}

function checkStaticCwd(cwd, allowedRoots) {
  if (!cwd || !Array.isArray(allowedRoots) || !allowedRoots.length) return null;
  const value = String(cwd);
  if (value.includes("{") || value.includes("$")) return null;
  const resolved = path.resolve(value);
  const allowed = allowedRoots.some((root) => {
    const rootResolved = path.resolve(root);
    const relative = path.relative(rootResolved, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  return allowed ? null : `Runtime cwd ${resolved} is outside allowed roots`;
}

function evaluateAllowedRoots({ channelConfig, runtimeSpec }) {
  const allowedRoots = (channelConfig.allowedRoots || []).filter(Boolean).map((root) => path.resolve(root));
  if (!allowedRoots.length) return null;
  const candidates = [channelConfig.workspaceRoot, channelConfig.cwd, runtimeSpec?.cwd]
    .filter((value) => value && typeof value === "string" && !value.includes("{sandboxDir}") && !value.includes("{workspaceDir}"))
    .map((value) => path.resolve(value));
  for (const candidate of candidates) {
    if (!allowedRoots.some((root) => isSubpathOrEqual(candidate, root))) {
      return deny(`Path ${candidate} is outside channel allowedRoots`);
    }
  }
  return null;
}

function matchTool(pattern, toolName) {
  if (pattern === "*") return true;
  const names = toolAliases(toolName);
  try {
    const regex = new RegExp(`^${String(pattern).replaceAll("*", ".*")}$`, "i");
    return names.some((name) => regex.test(name));
  } catch {
    return names.some((name) => String(pattern).toLowerCase() === name.toLowerCase());
  }
}

function toolAliases(toolName) {
  const value = String(toolName || "");
  const aliases = new Set([value]);
  if (value === "command_execution") {
    aliases.add("Bash");
    aliases.add("Shell");
  }
  if (value === "file_change") {
    aliases.add("Edit");
    aliases.add("Write");
    aliases.add("MultiEdit");
  }
  if (value === "mcp_tool_call") aliases.add("MCP");
  if (value === "web_search" || value === "web.search" || value === "WebSearch") {
    aliases.add("WebSearch");
    aliases.add("web_search");
    aliases.add("web.search");
  }
  return [...aliases];
}

function stringifyArguments(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value || "");
  }
}

function isSubpathOrEqual(target, root) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
