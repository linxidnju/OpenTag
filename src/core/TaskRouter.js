export class TaskRouter {
  constructor({ config, runtimeRegistry, logger }) {
    this.config = config;
    this.runtimeRegistry = runtimeRegistry;
    this.logger = logger;
  }

  route({ message, channelConfig, runtimeOverride = null }) {
    const analysis = analyzeTask(message);
    const candidates = this.candidateRuntimeIds({ channelConfig, runtimeOverride });
    const requested = runtimeOverride || channelConfig.defaultRuntime || this.config.runtimes.default;
    if (!candidates.includes(requested)) candidates.unshift(requested);

    const denied = [];
    for (const runtimeId of this.orderCandidates(candidates, channelConfig)) {
      if (!this.runtimeRegistry.has(runtimeId)) {
        denied.push({ runtimeId, reason: "not_registered" });
        continue;
      }
      if (!this.isAllowedByChannel(runtimeId, channelConfig)) {
        denied.push({ runtimeId, reason: "not_allowed_by_channel" });
        continue;
      }
      const spec = this.runtimeRegistry.getSpec(runtimeId);
      const availability = this.checkAvailability(spec);
      if (!availability.ok) {
        denied.push({ runtimeId, reason: availability.reason });
        continue;
      }
      const budget = this.checkBudget(spec, channelConfig);
      if (!budget.ok) {
        denied.push({ runtimeId, reason: budget.reason });
        continue;
      }
      const capabilities = this.checkCapabilities({ analysis, spec });
      if (!capabilities.ok) {
        denied.push({ runtimeId, reason: capabilities.reason });
        continue;
      }
      return {
        runtimeId,
        runtimeSpec: spec,
        reason: runtimeOverride ? "runtime_override" : runtimeId === channelConfig.defaultRuntime ? "channel_default" : "fallback",
        taskClass: analysis.taskClass,
        requiredCapabilities: analysis.requiredCapabilities,
        denied
      };
    }

    const detail = denied.map((item) => `${item.runtimeId}:${item.reason}`).join(", ");
    throw new Error(`No routable runtime for this task${detail ? ` (${detail})` : ""}`);
  }

  candidateRuntimeIds({ channelConfig, runtimeOverride }) {
    if (runtimeOverride) return [runtimeOverride];
    return [
      channelConfig.defaultRuntime,
      ...(channelConfig.runtimeFallbacks || []),
      this.config.runtimes.default,
      ...(channelConfig.allowedRuntimes || [])
    ].filter(Boolean).filter((item, index, array) => array.indexOf(item) === index);
  }

  isAllowedByChannel(runtimeId, channelConfig) {
    const allowed = channelConfig.allowedRuntimes || [];
    return allowed.length === 0 || allowed.includes(runtimeId);
  }

  orderCandidates(candidates, channelConfig) {
    if (!channelConfig.routing?.preferLowestCost) return candidates;
    return [...candidates].sort((a, b) => {
      const aSpec = this.runtimeRegistry.has(a) ? this.runtimeRegistry.getSpec(a) : null;
      const bSpec = this.runtimeRegistry.has(b) ? this.runtimeRegistry.getSpec(b) : null;
      const aCost = Number(aSpec?.cost?.estimatedUsd ?? aSpec?.costEstimateUsd ?? Number.POSITIVE_INFINITY);
      const bCost = Number(bSpec?.cost?.estimatedUsd ?? bSpec?.costEstimateUsd ?? Number.POSITIVE_INFINITY);
      return aCost - bCost;
    });
  }

  checkAvailability(spec = {}) {
    const status = String(spec.health?.status || spec.status || "available").toLowerCase();
    if (["disabled", "down", "unavailable", "offline"].includes(status)) return { ok: false, reason: `health_${status}` };
    return { ok: true };
  }

  checkBudget(spec = {}, channelConfig = {}) {
    const max = Number(channelConfig.routing?.maxEstimatedCostUsd ?? channelConfig.maxEstimatedCostUsd);
    if (!Number.isFinite(max) || max < 0) return { ok: true };
    const estimate = Number(spec.cost?.estimatedUsd ?? spec.costEstimateUsd);
    if (Number.isFinite(estimate) && estimate > max) return { ok: false, reason: "cost_exceeds_channel_budget" };
    return { ok: true };
  }

  checkCapabilities({ analysis, spec }) {
    const capabilities = spec.capabilities || {};
    if (analysis.requiredCapabilities.writeAccess && capabilities.readOnly === true) return { ok: false, reason: "requires_write_access" };
    const supportedTools = normalizeToolSet(capabilities.tools || spec.supportedTools || []);
    if (supportedTools.size) {
      for (const tool of analysis.requiredTools) {
        if (!supportedTools.has(tool)) return { ok: false, reason: `missing_tool_${tool}` };
      }
    }
    return { ok: true };
  }
}

export function analyzeTask(message) {
  const text = `${message.cleanText || message.text || ""}`.toLowerCase();
  const requiredTools = new Set();
  const requiredCapabilities = {
    writeAccess: /\b(write|edit|modify|delete|commit|push|deploy|fix|create|generate)\b|写入|编辑|删除|提交|部署|修复|创建|生成/.test(text),
    shell: /\b(npm|test|build|run|shell|bash|command|terminal)\b|测试|构建|命令|终端/.test(text),
    network: /\b(fetch|http|api|web|search|download|github|linear|slack)\b|搜索|下载|接口/.test(text)
  };
  if (requiredCapabilities.shell) requiredTools.add("shell");
  if (requiredCapabilities.writeAccess) requiredTools.add("file_write");
  if (requiredCapabilities.network) requiredTools.add("network");

  let taskClass = "general";
  if (/\b(fix|bug|test|refactor|code|repo|npm|build)\b|修复|代码|仓库|测试/.test(text)) taskClass = "code";
  else if (/\b(report|csv|chart|artifact|file|document)\b|报告|图表|文件|文档/.test(text)) taskClass = "artifact";
  else if (/\b(search|summarize|explain|read|analyze)\b|搜索|总结|解释|分析/.test(text)) taskClass = "research";

  return { taskClass, requiredCapabilities, requiredTools: [...requiredTools] };
}

function normalizeToolSet(tools) {
  const out = new Set();
  for (const tool of tools || []) {
    const value = String(tool).toLowerCase();
    out.add(value);
    if (["bash", "shell", "command_execution"].includes(value)) out.add("shell");
    if (["edit", "write", "multiedit", "file_change"].includes(value)) out.add("file_write");
    if (["websearch", "web_search", "http", "network"].includes(value)) out.add("network");
  }
  return out;
}
