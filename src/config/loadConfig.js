import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = {
  app: {
    name: "OpenTag",
    dataDir: "./.opentag/data",
    logLevel: "info"
  },
  gateway: "slack",
  slack: {
    mode: "socket",
    botTokenEnv: "SLACK_BOT_TOKEN",
    appTokenEnv: "SLACK_APP_TOKEN",
    signingSecretEnv: "SLACK_SIGNING_SECRET",
    commandName: "/opentag",
    slashCommand: "/opentag",
    processThreadReplies: true,
    processDirectMessages: true,
    hydrateThreadContext: true,
    maxHydratedMessages: 50,
    enableEventDedupe: true,
    dedupeEvents: true,
    streamUpdateMs: 1500,
    maxMessageChars: 3500,
    uploadArtifacts: true,
    maxDownloadBytes: 25_000_000,
    allowedFileTypes: ["csv", "txt", "md", "json", "png", "jpg", "jpeg", "pdf"],
    port: 3000
  },
  admin: {
    enabled: false,
    host: "127.0.0.1",
    port: 8787,
    tokenEnv: "OPENTAG_ADMIN_TOKEN",
    requireToken: true
  },
  mcp: {
    enabled: true,
    name: "opentag-mcp",
    protocolVersion: "2025-06-18",
    allowSlackPost: false,
    requireApprovalForSlackPost: true,
    maxToolResultChars: 12000
  },
  sessions: {
    maxContextMessages: 24,
    maxPromptChars: 60000,
    maxConcurrentTurnsPerSession: 1,
    idleTtlHours: 72
  },
  channelStatus: {
    defaultDays: 14,
    maxThreads: 50,
    historyPageLimit: 100,
    maxRepliesPerThread: 50
  },
  workspaceSearch: {
    enabled: true,
    slackSearchEnabled: false,
    userTokenEnv: "SLACK_USER_TOKEN",
    defaultDays: 14,
    maxChannels: 10,
    maxMessagesPerChannel: 200,
    maxPromptChannelHistoryMessages: 20,
    maxHits: 8,
    slackSearchMaxResults: 10
  },
  sandbox: {
    rootDir: "./.opentag/sandboxes",
    workspaceRoot: null,
    mode: "ephemeral",
    cleanupOnComplete: false,
    retentionHours: 24,
    collectArtifacts: true,
    artifactMaxBytes: 5_000_000,
    artifactInclude: ["*.md", "*.txt", "*.json", "*.patch", "*.diff", "*.log", "*.csv", "*.png", "*.jpg", "*.jpeg", "*.pdf", "*.html", "*.svg"]
  },
  security: {
    redactSecrets: true,
    adminUsers: [],
    defaultDenyPatterns: [
      "rm\\s+-rf\\s+/",
      "mkfs\\.",
      "dd\\s+if=",
      "shutdown\\s+(-h|/s)",
      "drop\\s+database",
      "truncate\\s+table",
      "curl\\s+[^|]+\\|\\s*(sh|bash)",
      "wget\\s+[^|]+\\|\\s*(sh|bash)",
      ":\\s*\\(\\)\\s*\\{\\s*:\\|:&\\s*}"
    ],
    defaultApprovalPatterns: [
      "deploy",
      "production",
      "release",
      "delete",
      "remove",
      "drop\\s+table",
      "migration",
      "write\\s+file",
      "edit\\s+file",
      "commit",
      "push"
    ]
  },
  workspaces: [
    {
      workspaceId: "*",
      channels: [
        {
          channelId: "*",
          name: "default",
          defaultRuntime: "mock",
          allowedRuntimes: ["mock"],
          allowedUsers: [],
          blockedUsers: [],
          approvers: [],
          allowedRoots: [],
          workspaceRoot: null,
          instructions: "",
          memory: {},
          policy: {
            requireApprovalForWriteAccess: true,
            allowSelfApproval: true,
            requireApprovalPatterns: [],
            denyPatterns: []
          }
        }
      ]
    }
  ],
  runtimes: {
    default: "mock",
    adapters: {
      mock: { type: "mock" }
    }
  }
};

export async function loadConfig(configPath, options = {}) {
  const absolutePath = path.resolve(configPath);
  const raw = await readFile(absolutePath, "utf8");
  const userConfig = await parseConfig(raw, absolutePath);
  const config = deepMerge(structuredClone(DEFAULT_CONFIG), userConfig || {});
  config.__configPath = absolutePath;
  config.__configDir = path.dirname(absolutePath);
  normalizeConfigPaths(config);
  validateConfig(config);
  options.logger?.debug?.("config.loaded", { path: absolutePath });
  return config;
}

async function parseConfig(raw, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json" || ext === ".jsonc") {
    return JSON.parse(stripJsonComments(raw));
  }
  if ([".yaml", ".yml"].includes(ext)) {
    try {
      const yaml = await import("yaml");
      return yaml.parse(raw);
    } catch (error) {
      throw new Error(`YAML config requires the optional dependency "yaml". Run npm install or use JSON config. ${error.message}`);
    }
  }
  throw new Error(`Unsupported config format: ${ext}. Use .json, .yaml, or .yml.`);
}

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/g, "$1"))
    .join("\n");
}

function normalizeConfigPaths(config) {
  config.app.dataDir = resolveMaybeRelative(config.app.dataDir, config.__configDir);
  config.sandbox.rootDir = resolveMaybeRelative(config.sandbox.rootDir, config.__configDir);
  if (config.sandbox.workspaceRoot) config.sandbox.workspaceRoot = resolveMaybeRelative(config.sandbox.workspaceRoot, config.__configDir);
  for (const workspace of config.workspaces || []) {
    for (const channel of workspace.channels || []) {
      if (channel.workspaceRoot) channel.workspaceRoot = resolveMaybeRelative(channel.workspaceRoot, config.__configDir);
      if (channel.cwd) channel.cwd = resolveMaybeRelative(channel.cwd, config.__configDir);
      if (Array.isArray(channel.allowedRoots)) channel.allowedRoots = channel.allowedRoots.map((item) => resolveMaybeRelative(item, config.__configDir));
      if (channel.memory?.channelNotesPath) channel.memory.channelNotesPath = resolveMaybeRelative(channel.memory.channelNotesPath, config.__configDir);
      if (channel.memory?.channel_notes_path) channel.memory.channel_notes_path = resolveMaybeRelative(channel.memory.channel_notes_path, config.__configDir);
      if (Array.isArray(channel.memory?.files)) channel.memory.files = channel.memory.files.map((item) => resolveMaybeRelative(item, config.__configDir));
      if (Array.isArray(channel.memoryFiles)) channel.memoryFiles = channel.memoryFiles.map((item) => resolveMaybeRelative(item, config.__configDir));
    }
  }
}

function resolveMaybeRelative(value, baseDir) {
  if (!value || typeof value !== "string") return value;
  if (value.startsWith("~")) return path.join(process.env.HOME || "", value.slice(1));
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

export function validateConfig(config) {
  assertObject(config, "config");
  assertObject(config.app, "config.app");
  assertString(config.app.name, "config.app.name");
  assertString(config.app.dataDir, "config.app.dataDir");
  assertObject(config.runtimes, "config.runtimes");
  assertObject(config.runtimes.adapters, "config.runtimes.adapters");
  assertString(config.runtimes.default, "config.runtimes.default");
  if (!config.runtimes.adapters[config.runtimes.default]) {
    throw new Error(`config.runtimes.default=${config.runtimes.default} is not present in config.runtimes.adapters`);
  }
  for (const [id, spec] of Object.entries(config.runtimes.adapters)) {
    assertObject(spec, `config.runtimes.adapters.${id}`);
    assertString(spec.type, `config.runtimes.adapters.${id}.type`);
    if (!["mock", "claude-code", "codex", "opencode", "generic-cli", "http", "docker"].includes(spec.type)) {
      throw new Error(`Unsupported runtime type for ${id}: ${spec.type}`);
    }
  }
  if (!Array.isArray(config.workspaces) || config.workspaces.length === 0) {
    throw new Error("config.workspaces must contain at least one workspace entry");
  }
  for (const workspace of config.workspaces) {
    assertString(workspace.workspaceId, "workspace.workspaceId");
    if (!Array.isArray(workspace.channels) || workspace.channels.length === 0) {
      throw new Error(`workspace ${workspace.workspaceId} must contain channels`);
    }
    for (const channel of workspace.channels) {
      assertString(channel.channelId, `workspace ${workspace.workspaceId} channel.channelId`);
      if (channel.defaultRuntime && !config.runtimes.adapters[channel.defaultRuntime]) {
        throw new Error(`channel ${channel.channelId} references missing runtime ${channel.defaultRuntime}`);
      }
      for (const runtimeId of channel.allowedRuntimes || []) {
        if (!config.runtimes.adapters[runtimeId]) {
          throw new Error(`channel ${channel.channelId} allowedRuntimes references missing runtime ${runtimeId}`);
        }
      }
      assertArray(channel.allowedUsers || [], `channel ${channel.channelId}.allowedUsers`);
      assertArray(channel.blockedUsers || [], `channel ${channel.channelId}.blockedUsers`);
      assertArray(channel.approvers || [], `channel ${channel.channelId}.approvers`);
    }
  }
  return true;
}

export function resolveChannelConfig(config, { workspaceId, channelId }) {
  const workspace = config.workspaces.find((item) => item.workspaceId === workspaceId) || config.workspaces.find((item) => item.workspaceId === "*");
  if (!workspace) throw new Error(`Workspace is not configured: ${workspaceId}`);
  const channel = workspace.channels.find((item) => item.channelId === channelId) || workspace.channels.find((item) => item.channelId === "*");
  if (!channel) throw new Error(`Channel is not configured: ${workspaceId}/${channelId}`);
  return {
    workspace,
    channel: deepMerge({
      defaultRuntime: config.runtimes.default,
      allowedRuntimes: Object.keys(config.runtimes.adapters),
      allowedUsers: [],
      blockedUsers: [],
      approvers: [],
      allowedRoots: [],
      workspaceRoot: null,
      instructions: "",
      memory: {},
      policy: { requireApprovalForWriteAccess: true, allowSelfApproval: true, requireApprovalPatterns: [], denyPatterns: [] }
    }, channel)
  };
}

export function deepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      target[key] = value.slice();
    } else if (value && typeof value === "object") {
      const base = target[key] && typeof target[key] === "object" && !Array.isArray(target[key]) ? target[key] : {};
      target[key] = deepMerge(base, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
}

function assertString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`);
}

function assertArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
}
