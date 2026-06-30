import path from "node:path";
import { loadConfig } from "../../config/loadConfig.js";
import { commandExists, runCommand } from "../lib/commands.mjs";
import { defaultConfigPath, envExamplePath, envPath, expandHome, manifestPath } from "../lib/paths.mjs";
import { pathExists } from "../lib/fs.mjs";

export async function runDoctor(args) {
  const strict = Boolean(args.strict);
  const offline = Boolean(args.offline || args["no-slack"]);
  const configPath = path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath()));
  const checks = [];

  checks.push(check("node", nodeOk(), process.version));
  checks.push(check("env:file", await pathExists(envPath()), envPath(), { required: false }));
  checks.push(check("env:example", await pathExists(envExamplePath()), envExamplePath(), { required: false }));
  checks.push(check("manifest:file", await pathExists(manifestPath()), manifestPath(), { required: false }));
  checks.push(check("config", await pathExists(configPath), configPath));

  let config = null;
  if (await pathExists(configPath)) {
    try {
      config = await loadConfig(configPath);
      checks.push(check("config:parse", true, "valid"));
    } catch (error) {
      checks.push(check("config:parse", false, error.message));
    }
  }

  if (config) {
    checks.push(check("dataDir", true, config.app.dataDir));
    checks.push(check("sandboxRoot", true, config.sandbox.rootDir));
    const projectDir = config.v01?.projectDir || config.sandbox.workspaceRoot || config.workspaces?.[0]?.channels?.[0]?.workspaceRoot;
    checks.push(check("project", Boolean(projectDir && await pathExists(projectDir)), projectDir || "not configured"));
    if (projectDir && await pathExists(projectDir)) {
      const git = await runCommand("git", ["-C", projectDir, "rev-parse", "--is-inside-work-tree"]);
      checks.push(check("project:git", git.code === 0, git.code === 0 ? "git repo" : "not a git repo"));
    }

    if (!offline && config.gateway === "slack") {
      for (const [label, envName, required] of [
        ["slack:bot", config.slack.botTokenEnv, true],
        ["slack:app", config.slack.appTokenEnv, config.slack.mode === "socket"],
        ["slack:signing", config.slack.signingSecretEnv, config.slack.mode === "http"],
        ["slack:user-search", config.workspaceSearch?.userTokenEnv, Boolean(config.workspaceSearch?.slackSearchEnabled)]
      ]) {
        if (!envName) continue;
        const value = process.env[envName];
        const ok = Boolean(value && !isPlaceholder(value));
        const detail = value ? `${envName}=${isPlaceholder(value) ? "placeholder" : "set"}` : `${envName}=missing`;
        checks.push(check(label, ok, detail, { required }));
      }
    } else {
      checks.push(check("slack", true, "skipped by --offline", { required: false }));
    }

    const requiredRuntimes = collectRequiredRuntimes(config);
    for (const [runtimeId, spec] of Object.entries(config.runtimes.adapters || {})) {
      const required = requiredRuntimes.has(runtimeId);
      if (spec.type === "mock" || spec.type === "http") {
        checks.push(check(`runtime:${runtimeId}`, true, spec.type, { required }));
        continue;
      }
      const command = spec.command || defaultCommandFor(spec.type);
      checks.push(check(`runtime:${runtimeId}`, await commandExists(command), command, { required }));
    }
  }

  let ok = true;
  for (const item of checks) {
    if (!item.pass && item.required) ok = false;
  }
  const nextActions = buildNextActions(checks, { offline, configPath });

  if (args.json) {
    console.log(JSON.stringify({ ok, strict, offline, configPath, checks, nextActions }, null, 2));
    if (strict && !ok) process.exitCode = 1;
    return;
  }

  for (const item of checks) {
    const marker = item.pass ? "✓" : item.required ? "✗" : "!";
    const optional = item.required ? "" : " optional";
    console.log(`${marker} ${item.name.padEnd(22)} ${item.detail}${optional}`);
  }

  if (nextActions.length) {
    console.log("\nNext actions:");
    for (const action of nextActions) console.log(`- ${action}`);
  }

  if (strict && !ok) {
    process.exitCode = 1;
  }
}

function check(name, pass, detail, options = {}) {
  return { name, pass, detail, required: options.required !== false };
}

function collectRequiredRuntimes(config) {
  const ids = new Set([config.runtimes.default]);
  for (const workspace of config.workspaces || []) {
    for (const channel of workspace.channels || []) {
      if (channel.defaultRuntime) ids.add(channel.defaultRuntime);
    }
  }
  return ids;
}

function nodeOk() {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 20;
}

function defaultCommandFor(type) {
  if (type === "claude-code") return "claude";
  if (type === "codex") return "codex";
  if (type === "opencode") return "opencode";
  if (type === "docker") return "docker";
  return "sh";
}

function isPlaceholder(value) {
  return /your-|change-me|placeholder|^xoxb-your|^xapp-your/i.test(String(value || ""));
}

function buildNextActions(checks, { offline, configPath }) {
  const byName = new Map(checks.map((item) => [item.name, item]));
  const actions = [];
  if (!byName.get("config")?.pass) actions.push(`Run opentag setup --local --project . --runtime mock or pass --config ${configPath}`);
  if (!byName.get("config:parse")?.pass && byName.has("config:parse")) actions.push("Fix the OpenTag config parse error above.");
  if (!byName.get("env:file")?.pass) actions.push(`Copy ${envExamplePath()} to ${envPath()} and fill Slack tokens.`);
  if (!byName.get("manifest:file")?.pass) actions.push("Run opentag slack manifest to generate the Slack app manifest.");
  if (!offline) {
    for (const name of ["slack:bot", "slack:app", "slack:signing"]) {
      const item = byName.get(name);
      if (item && !item.pass && item.required) actions.push(`Set ${item.detail.split("=")[0]} in ${envPath()}.`);
    }
  }
  for (const item of checks) {
    if (item.name.startsWith("runtime:") && !item.pass && item.required) actions.push(`Install or configure required runtime command: ${item.detail}.`);
  }
  return [...new Set(actions)];
}
