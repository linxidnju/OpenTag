import path from "node:path";
import { homeDir } from "./paths.mjs";

export function createLocalConfig({ projectDir, runtime = "codex", appName = "OpenTag" }) {
  const root = homeDir();
  const runtimeId = normalizeRuntimeId(runtime);
  const adapters = {
    mock: { type: "mock", delayMs: 5 },
    codex: {
      type: "codex",
      command: "codex",
      sandbox: "workspace-write",
      askForApproval: "on-request",
      json: true,
      ephemeral: true,
      requiresApproval: true,
      timeoutMs: 900000
    },
    opencode: {
      type: "opencode",
      command: "opencode",
      requiresApproval: true,
      timeoutMs: 900000
    },
    openclaw: {
      type: "generic-cli",
      command: "openclaw",
      args: ["run", "{prompt}"],
      outputMode: "text",
      requiresApproval: true,
      timeoutMs: 900000
    },
    hermes: {
      type: "generic-cli",
      command: "hermes",
      args: ["run", "{prompt}"],
      outputMode: "text",
      requiresApproval: true,
      timeoutMs: 900000
    },
    "claude-code": {
      type: "claude-code",
      command: "claude",
      outputFormat: "stream-json",
      permissionMode: "default",
      timeoutMs: 900000
    }
  };

  return {
    app: {
      name: appName,
      dataDir: path.join(root, "data"),
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
      maxDownloadBytes: 25000000,
      allowedFileTypes: ["csv", "txt", "md", "json", "png", "jpg", "jpeg", "pdf"]
    },
    admin: {
      enabled: true,
      host: "127.0.0.1",
      port: 8787,
      tokenEnv: "OPENTAG_ADMIN_TOKEN",
      requireToken: false
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
      rootDir: path.join(root, "sandboxes"),
      workspaceRoot: projectDir,
      mode: "ephemeral",
      cleanupOnComplete: false,
      retentionHours: 24,
      collectArtifacts: true,
      artifactMaxBytes: 5000000,
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
        "wget\\s+[^|]+\\|\\s*(sh|bash)"
      ],
      defaultApprovalPatterns: [
        "deploy",
        "production",
        "release",
        "delete",
        "remove",
        "migration",
        "commit",
        "push",
        "删除",
        "移除",
        "清空",
        "覆盖",
        "发布",
        "上线",
        "生产"
      ]
    },
    workspaces: [
      {
        workspaceId: "*",
        channels: [
          {
            channelId: "*",
            name: "default",
            defaultRuntime: runtimeId,
            allowedRuntimes: Object.keys(adapters),
            allowedUsers: [],
            blockedUsers: [],
            approvers: [],
            allowedRoots: [projectDir],
            workspaceRoot: projectDir,
            instructions: "Prefer concise, auditable Slack-thread updates. Ask before irreversible actions.",
            memory: {},
            policy: {
              requireApprovalForWriteAccess: false,
              allowSelfApproval: true,
              requireApprovalPatterns: ["deploy", "production", "delete", "drop table", "push", "删除", "移除", "清空", "覆盖", "发布", "上线", "生产"],
              denyPatterns: []
            },
            toolPolicy: {
              allowTools: ["Read", "Glob", "Grep", "LS", "Bash", "Edit", "Write", "MultiEdit", "WebSearch", "web_search", "codex", "opencode", "generic-cli"],
              denyTools: [],
              requireApprovalTools: [],
              requireApprovalPatterns: ["deploy", "production", "delete", "drop table", "push", "删除", "移除", "清空", "覆盖", "发布", "上线", "生产"],
              denyPatterns: ["rm\\s+-rf\\s+/"]
            }
          }
        ]
      }
    ],
    runtimes: {
      default: runtimeId,
      adapters
    },
    v01: {
      projectDir,
      setupMode: "local"
    }
  };
}

export function normalizeRuntimeId(runtime) {
  const value = String(runtime || "codex").trim().toLowerCase();
  if (value === "claude") return "claude-code";
  if (value === "open-code") return "opencode";
  if (value === "open-claw") return "openclaw";
  return value;
}
