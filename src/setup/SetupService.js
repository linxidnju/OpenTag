import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { envPath, manifestPath } from "../v01/lib/paths.mjs";
import { ensureDir, pathExists } from "../v01/lib/fs.mjs";
import { scanLocalAgents } from "./AgentScanner.js";

export class SetupService {
  constructor({ config, runtimeRegistry, logger }) {
    this.config = config;
    this.runtimeRegistry = runtimeRegistry;
    this.logger = logger;
  }

  async state() {
    const configuredRuntimes = new Set(Object.keys(this.config.runtimes?.adapters || {}));
    const agents = (await scanLocalAgents()).map((agent) => ({
      ...agent,
      configured: configuredRuntimes.has(agent.runtimeId)
    }));
    const selectedRuntime = this.config.runtimes?.default || "mock";
    return {
      app: this.config.app?.name || "OpenTag",
      configPath: this.config.__configPath || null,
      envPath: envPath(),
      manifestPath: manifestPath(),
      hasManifestFile: await pathExists(manifestPath()),
      selectedRuntime,
      agents,
      slack: {
        mode: this.config.slack?.mode || "socket",
        botTokenEnv: this.config.slack?.botTokenEnv,
        appTokenEnv: this.config.slack?.appTokenEnv,
        signingSecretEnv: this.config.slack?.signingSecretEnv,
        hasBotToken: hasRealEnv(this.config.slack?.botTokenEnv),
        hasAppToken: hasRealEnv(this.config.slack?.appTokenEnv),
        hasSigningSecret: hasRealEnv(this.config.slack?.signingSecretEnv)
      },
      runtimes: this.runtimeRegistry.list()
    };
  }

  identity() {
    return {
      app: this.config.app?.name || "OpenTag",
      configPath: this.config.__configPath || null
    };
  }

  async diagnostics() {
    const state = await this.state();
    const selectedAgent = state.agents.find((agent) => agent.runtimeId === state.selectedRuntime);
    const tokenReady = state.slack.hasBotToken && state.slack.hasAppToken && state.slack.hasSigningSecret;
    const checks = [
      setupCheck("daemon:admin-api", true, "local Admin API is reachable"),
      setupCheck("config:file", Boolean(state.configPath && await pathExists(state.configPath)), state.configPath || "not configured"),
      setupCheck("manifest:file", state.hasManifestFile, state.manifestPath, { required: false }),
      setupCheck("runtime:selected", Boolean(state.selectedRuntime), state.selectedRuntime),
      setupCheck("runtime:installed", Boolean(selectedAgent?.installed && selectedAgent?.configured), selectedAgent ? selectedAgent.name : state.selectedRuntime),
      setupCheck("slack:bot-token", state.slack.hasBotToken, state.slack.botTokenEnv || "not configured"),
      setupCheck("slack:app-token", state.slack.hasAppToken, state.slack.appTokenEnv || "not configured"),
      setupCheck("slack:signing-secret", state.slack.hasSigningSecret, state.slack.signingSecretEnv || "not configured")
    ];
    const runtimeReady = Boolean(selectedAgent?.installed && selectedAgent?.configured);
    const steps = [
      setupStep("agent", runtimeReady ? "done" : "blocked", runtimeReady ? `Runtime ${state.selectedRuntime} is ready.` : "Choose an installed and configured runtime."),
      setupStep("slack-app", state.hasManifestFile ? "done" : "ready", state.hasManifestFile ? "Slack manifest file is ready." : "Generate or copy the Slack manifest from this page."),
      setupStep("tokens", tokenReady ? "done" : "blocked", tokenReady ? "Slack tokens are saved locally." : "Paste the bot token, app token, and signing secret."),
      setupStep("verify", checks.every((item) => item.pass || !item.required) ? "done" : "blocked", "Run opentag doctor --strict after all required checks are green.")
    ];
    return {
      ok: checks.every((item) => item.pass || !item.required),
      checks,
      steps,
      nextActions: diagnosticsNextActions(checks, state)
    };
  }

  async selectRuntime(runtimeId) {
    if (!this.config.runtimes?.adapters?.[runtimeId]) throw new Error(`Runtime is not configured: ${runtimeId}`);
    this.config.runtimes.default = runtimeId;
    for (const workspace of this.config.workspaces || []) {
      for (const channel of workspace.channels || []) {
        channel.defaultRuntime = runtimeId;
        channel.allowedRuntimes = [...new Set([...(channel.allowedRuntimes || []), runtimeId])];
      }
    }
    await persistJsonConfig(this.config);
    return this.state();
  }

  async saveSlackTokens({ botToken, appToken, signingSecret }) {
    const updates = {};
    setToken(updates, this.config.slack?.botTokenEnv, botToken, /^xoxb-/i, "Slack bot token must start with xoxb-.");
    setToken(updates, this.config.slack?.appTokenEnv, appToken, /^xapp-/i, "Slack app token must start with xapp-.");
    setToken(updates, this.config.slack?.signingSecretEnv, signingSecret, /.+/, "Slack signing secret is required.");
    if (!Object.keys(updates).length) throw new Error("No Slack token values were provided.");

    await persistEnv(updates);
    for (const [key, value] of Object.entries(updates)) process.env[key] = value;
    return this.state();
  }
}

async function persistJsonConfig(config) {
  const filePath = config.__configPath;
  if (!filePath) throw new Error("Config path is not available.");
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(stripJsonComments(raw));
  parsed.runtimes = parsed.runtimes || {};
  parsed.runtimes.default = config.runtimes.default;
  for (const workspace of parsed.workspaces || []) {
    for (const channel of workspace.channels || []) {
      channel.defaultRuntime = config.runtimes.default;
      channel.allowedRuntimes = [...new Set([...(channel.allowedRuntimes || []), config.runtimes.default])];
    }
  }
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/g, "$1"))
    .join("\n");
}

function hasRealEnv(envName) {
  if (!envName) return false;
  const value = process.env[envName];
  return Boolean(value && !/your-|change-me|placeholder|^xoxb-your|^xapp-your/i.test(String(value)));
}

function setupCheck(name, pass, detail, options = {}) {
  return { name, pass, detail, required: options.required !== false };
}

function setupStep(id, status, detail) {
  return { id, status, detail };
}

function diagnosticsNextActions(checks, state) {
  const byName = new Map(checks.map((item) => [item.name, item]));
  const actions = [];
  if (!byName.get("config:file")?.pass) actions.push("Run opentag init --project . --runtime mock.");
  if (!byName.get("manifest:file")?.pass) actions.push("Use Copy manifest or Download YAML, then import it in Slack.");
  if (!byName.get("runtime:installed")?.pass) actions.push(`Install or select a configured runtime for ${state.selectedRuntime}.`);
  if (!byName.get("slack:bot-token")?.pass) actions.push(`Paste ${state.slack.botTokenEnv} from Slack OAuth & Permissions.`);
  if (!byName.get("slack:app-token")?.pass) actions.push(`Paste ${state.slack.appTokenEnv} from Slack App-Level Tokens.`);
  if (!byName.get("slack:signing-secret")?.pass) actions.push(`Paste ${state.slack.signingSecretEnv} from Slack Basic Information.`);
  if (!actions.length) actions.push("Run opentag doctor --strict, then mention OpenTag in Slack.");
  return actions;
}

function setToken(updates, envName, value, pattern, message) {
  if (!envName || value === undefined || value === null || String(value).trim() === "") return;
  const normalized = String(value).trim();
  if (!pattern.test(normalized)) throw new Error(message);
  updates[envName] = normalized;
}

async function persistEnv(updates) {
  const filePath = envPath();
  await ensureDir(path.dirname(filePath));
  const existing = await readFile(filePath, "utf8").catch(() => "");
  const seen = new Set();
  const lines = existing.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=)(.*)$/);
    if (!match || !Object.hasOwn(updates, match[2])) return line;
    seen.add(match[2]);
    return `${match[1]}${match[2]}${match[3]}${quoteEnvValue(updates[match[2]])}`;
  });
  const additions = Object.entries(updates)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`);
  const next = [...trimTrailingEmpty(lines), ...additions].join("\n");
  await writeFile(filePath, `${next}\n`, "utf8");
}

function quoteEnvValue(value) {
  const text = String(value);
  if (/^[A-Za-z0-9._:/+=@-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function trimTrailingEmpty(lines) {
  const next = [...lines];
  while (next.length && next[next.length - 1] === "") next.pop();
  return next;
}
