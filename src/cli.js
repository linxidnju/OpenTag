import { access, constants } from "node:fs/promises";
import { spawn } from "node:child_process";
import { loadConfig } from "./config/loadConfig.js";
import { buildOpenTag } from "./opentag.js";
import { createLogger } from "./utils/logger.js";
import { redact } from "./utils/redact.js";

export async function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0] || "help";

  if (command === "help" || args.help || args.h) {
    printHelp();
    return;
  }

  const configPath = args.config || args.c || process.env.OPENTAG_CONFIG || "./opentag.config.json";
  const logger = createLogger({ level: args.logLevel || process.env.OPENTAG_LOG_LEVEL || "info" });
  const config = await loadConfig(configPath, { logger });

  if (command === "doctor") {
    await doctor(config, logger);
    return;
  }

  const app = await buildOpenTag(config, { logger });

  if (command === "run") {
    const prompt = args.prompt || args.p || args._.slice(1).join(" ");
    if (!prompt) throw new Error("Missing --prompt for `opentag run`.");
    const runtimeId = args.runtime || args.r || config.runtimes.default;
    await app.engine.runOneShot({ prompt, runtimeId, userId: "cli", workspaceId: "local", channelId: "console", threadId: `console-${Date.now()}` });
    return;
  }

  if (command === "start") {
    if (config.admin?.enabled) await app.adminServer.start();
    const gateway = args.gateway || config.gateway || "slack";
    if (gateway === "console") {
      await app.consoleGateway.start();
      return;
    }
    if (gateway === "slack") {
      await app.slackGateway.start();
      return;
    }
    throw new Error(`Unknown gateway: ${gateway}`);
  }

  if (command === "admin") {
    await app.adminServer.start();
    return new Promise(() => {});
  }

  if (command === "mcp" || command === "mcp-server") {
    await app.mcpStdioServer.start();
    return;
  }

  if (command === "sessions") {
    const sessions = await app.store.listSessions({ status: args.status, limit: Number(args.limit || args.n || 20) });
    printTable(sessions.map((s) => ({ id: s.id, status: s.status, runtime: s.runtimeId, channel: s.channelId, thread: s.threadId, updated: s.updatedAt })));
    return;
  }

  if (command === "audit") {
    const events = await app.store.listAudit({ sessionId: args.session, type: args.type, limit: Number(args.limit || args.n || 50) });
    for (const event of events) console.log(JSON.stringify(event));
    return;
  }

  if (command === "approvals") {
    const approvals = await app.store.listApprovals({ status: args.status, sessionId: args.session, limit: Number(args.limit || args.n || 20) });
    printTable(approvals.map((a) => ({ id: a.id, status: a.status, runtime: a.runtimeId, session: a.sessionId, requestedBy: a.requestedBy, reason: a.reason })));
    return;
  }

  if (command === "runs") {
    const runs = await app.store.listRuns({ sessionId: args.session, limit: Number(args.limit || args.n || 20) });
    printTable(runs.map((r) => ({ id: r.id, status: r.status, runtime: r.runtimeId, session: r.sessionId, artifacts: r.artifactCount ?? "", updated: r.updatedAt })));
    return;
  }

  if (command === "artifacts") {
    const artifacts = await app.store.listArtifacts({ sessionId: args.session, runId: args.run, limit: Number(args.limit || args.n || 20) });
    printTable(artifacts.map((a) => ({ id: a.id, run: a.runId, session: a.sessionId, path: a.relativePath || a.path, size: a.size ?? "" })));
    return;
  }

  if (command === "cancel") {
    const sessionId = args.session || args._[1];
    if (!sessionId) throw new Error("Usage: opentag cancel <session_id>");
    await app.engine.cancelSession(sessionId, "cancelled from CLI");
    console.log(`Cancelled ${sessionId}`);
    return;
  }

  if (command === "cleanup") {
    const result = await app.sandboxManager.cleanupOldSandboxes({ retentionHours: args.retentionHours });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("-")) {
      out._.push(token);
      continue;
    }
    const key = token.replace(/^--?/, "");
    const next = argv[i + 1];
    if (next && !next.startsWith("-")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function printHelp() {
  console.log(`OpenTag MVP\n\nUsage:\n  opentag start --config ./examples/opentag.config.example.json [--gateway slack|console]\n  opentag doctor --config ./examples/opentag.config.example.json\n  opentag run --config ./examples/opentag.config.example.json --runtime mock --prompt "Explain this repo"\n  opentag sessions --config ./examples/opentag.config.example.json [--status active] [--limit 20]\n  opentag approvals --config ./examples/opentag.config.example.json [--status pending]\n  opentag audit --config ./examples/opentag.config.example.json [--session sess_x] [--limit 50]\n  opentag cancel --config ./examples/opentag.config.example.json <session_id>\n  opentag cleanup --config ./examples/opentag.config.example.json --retentionHours 24\n  opentag admin --config ./examples/opentag.config.example.json\n  opentag mcp --config ./examples/opentag.config.example.json\n\nEnvironment for Slack Socket Mode:\n  SLACK_BOT_TOKEN=xoxb-...\n  SLACK_APP_TOKEN=xapp-...\n`);
}

async function doctor(config, logger) {
  const checks = [];
  checks.push(["config", true, `loaded app=${config.app.name}`]);
  checks.push(["dataDir", true, config.app.dataDir]);
  checks.push(["sandboxRoot", true, config.sandbox.rootDir]);

  for (const [label, envName] of [
    ["SLACK_BOT_TOKEN", config.slack.botTokenEnv],
    ["SLACK_APP_TOKEN", config.slack.appTokenEnv],
    ["SLACK_SIGNING_SECRET", config.slack.signingSecretEnv]
  ]) {
    if (!envName) continue;
    const value = process.env[envName];
    checks.push([label, Boolean(value), value ? redact(`${envName}=${value}`) : `missing ${envName}`]);
  }

  try {
    await import("@slack/bolt");
    checks.push(["@slack/bolt", true, "installed"]);
  } catch (error) {
    checks.push(["@slack/bolt", false, "not installed; run npm install before Slack gateway"]);
  }

  try {
    await import("yaml");
    checks.push(["yaml", true, "installed"]);
  } catch {
    checks.push(["yaml", false, "not installed; JSON config still works"]);
  }

  for (const [runtimeId, spec] of Object.entries(config.runtimes.adapters)) {
    if (!["claude-code", "codex", "opencode", "generic-cli", "docker"].includes(spec.type)) continue;
    const command = spec.command || defaultCommandForRuntime(spec.type);
    const found = await commandExists(command);
    checks.push([`runtime:${runtimeId}`, found, found ? `${command} found` : `${command} not found in PATH`]);
  }

  let ok = true;
  for (const [name, pass, detail] of checks) {
    if (!pass) ok = false;
    console.log(`${pass ? "✓" : "✗"} ${name.padEnd(24)} ${detail}`);
  }
  if (!ok) {
    logger.warn("Doctor found missing optional/required dependencies. Mock and console modes can still run without Slack tokens.");
  }
}

function defaultCommandForRuntime(type) {
  if (type === "claude-code") return "claude";
  if (type === "codex") return "codex";
  if (type === "opencode") return "opencode";
  if (type === "docker") return "docker";
  return "sh";
}

async function commandExists(command) {
  if (!command) return false;
  if (command.includes("/") || command.includes("\\")) {
    try {
      await access(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [command] : ["-v", command], {
      shell: process.platform !== "win32",
      stdio: "ignore"
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function printTable(rows) {
  if (!rows.length) {
    console.log("(none)");
    return;
  }
  const headers = Object.keys(rows[0]);
  const widths = headers.map((header) => Math.max(header.length, ...rows.map((row) => String(row[header] ?? "").length)));
  console.log(headers.map((header, i) => header.padEnd(widths[i])).join("  "));
  console.log(headers.map((_, i) => "-".repeat(widths[i])).join("  "));
  for (const row of rows) {
    console.log(headers.map((header, i) => String(row[header] ?? "").padEnd(widths[i])).join("  "));
  }
}
