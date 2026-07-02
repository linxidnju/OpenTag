export function buildChannelProfiles(config) {
  const runtimeIds = Object.keys(config.runtimes?.adapters || {});
  return (config.workspaces || []).flatMap((workspace) => {
    return (workspace.channels || []).map((channel) => buildChannelProfile({ config, workspace, channel, runtimeIds }));
  });
}

export function buildChannelProfile({ config, workspace, channel, runtimeIds = Object.keys(config.runtimes?.adapters || {}) }) {
  const defaultRuntime = channel.defaultRuntime || config.runtimes?.default;
  const allowedRuntimes = channel.allowedRuntimes?.length ? channel.allowedRuntimes : runtimeIds;
  const policy = channel.policy || {};
  const limits = normalizeLimits(channel);
  return {
    label: channel.profileName || channel.accessBundle || channel.name || channel.channelId,
    workspaceId: workspace.workspaceId,
    channelId: channel.channelId,
    channelName: channel.name || channel.channelId,
    defaultRuntime,
    allowedRuntimes,
    allowedUsers: channel.allowedUsers || [],
    blockedUsers: channel.blockedUsers || [],
    approvers: channel.approvers || [],
    allowedRoots: channel.allowedRoots || [],
    workspaceRoot: channel.workspaceRoot || channel.cwd || null,
    memoryScope: channel.memory?.scope || "auto",
    instructions: channel.instructions || "",
    policy: {
      requireApprovalForWriteAccess: policy.requireApprovalForWriteAccess !== false,
      allowSelfApproval: policy.allowSelfApproval !== false,
      requireApprovalPatterns: policy.requireApprovalPatterns || [],
      denyPatterns: policy.denyPatterns || []
    },
    toolPolicy: channel.toolPolicy || channel.policy?.tools || {},
    limits,
    summary: summarizeProfile({ defaultRuntime, allowedRuntimes, channel, policy, limits })
  };
}

function normalizeLimits(channel) {
  const source = channel.limits || channel.budget || {};
  return {
    maxEstimatedCostUsd: numberOrNull(source.maxEstimatedCostUsd ?? channel.routing?.maxEstimatedCostUsd ?? channel.maxEstimatedCostUsd),
    maxDailyRuns: numberOrNull(source.maxDailyRuns ?? channel.maxDailyRuns),
    maxRuntimeMs: numberOrNull(source.maxRuntimeMs ?? channel.maxRuntimeMs),
    maxArtifactBytes: numberOrNull(source.maxArtifactBytes ?? channel.maxArtifactBytes)
  };
}

function summarizeProfile({ defaultRuntime, allowedRuntimes, channel, policy, limits }) {
  const approval = policy.requireApprovalForWriteAccess !== false ? "write actions require approval" : "write approval is relaxed";
  const roots = channel.allowedRoots?.length ? `${channel.allowedRoots.length} allowed root(s)` : "no root allowlist";
  const users = channel.allowedUsers?.length ? `${channel.allowedUsers.length} allowed user(s)` : "open to channel";
  const runtime = `${defaultRuntime || "default"} runtime, ${allowedRuntimes.length} allowed runtime(s)`;
  const budget = limits.maxDailyRuns ? `, ${limits.maxDailyRuns} run(s)/day` : "";
  return `${runtime}; ${approval}; ${roots}; ${users}${budget}.`;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
