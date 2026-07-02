import path from "node:path";
import { loadConfig } from "../../config/loadConfig.js";
import { createLocalConfig, normalizeRuntimeId } from "../lib/configTemplate.mjs";
import { commandExists, openUrl } from "../lib/commands.mjs";
import { ensureDir, pathExists, readJson, writeJson, writeText } from "../lib/fs.mjs";
import { defaultConfigPath, envExamplePath, envPath, expandHome, homeDir, manifestPath, projectBindingPath, projectsPath } from "../lib/paths.mjs";
import { slackManifest, SLACK_MANIFEST_URL } from "../templates/slackManifest.mjs";
import { runDaemon } from "./daemon.mjs";

export async function runSetup(args) {
  const action = args._[1];
  if (action === "launch") return launchSetupUi(args);
  if (action === "open" || action === "ui") return openSetupUi(args);
  if (action === "url") return printSetupUrl(args);

  const mode = args.local || !args["cloud-relay"] ? "local" : "cloud-relay";
  if (mode !== "local") throw new Error("v0.1 only supports local setup. Hosted relay belongs to v0.2.");

  const projectDir = path.resolve(expandHome(args.project || args.p || process.cwd()));
  const runtime = normalizeRuntimeId(args.runtime || args.r || await detectRuntime());
  const configPath = path.resolve(expandHome(args.config || args.c || defaultConfigPath()));
  const appName = args.name || "OpenTag";
  const config = createLocalConfig({ projectDir, runtime, appName });

  await ensureDir(homeDir());
  await writeJson(configPath, config);
  await writeText(manifestPath(), slackManifest({ appName, slashCommand: config.slack.slashCommand }));
  const envContent = localEnvExample(config);
  await writeText(envExamplePath(), envContent);
  if (!(await pathExists(envPath()))) await writeText(envPath(), envContent);
  await writeText(path.join(process.cwd(), "examples", "slack-app-manifest.generated.yml"), slackManifest({ appName, slashCommand: config.slack.slashCommand }));
  const project = {
    name: path.basename(projectDir),
    path: projectDir,
    defaultRuntime: runtime,
    configPath,
    createdAt: new Date().toISOString()
  };
  await writeJson(projectBindingPath(projectDir), project);
  await upsertProject(project);

  console.log(`OpenTag local init complete.

Config:   ${configPath}
Manifest: ${manifestPath()}
Env:      ${envPath()}
Project:  ${projectBindingPath(projectDir)}
Runtime:  ${runtime}

Next:
  1. Run: opentag setup launch
  2. Follow the local setup page to choose a runtime and install Slack
  3. Run: opentag doctor --strict

Tip: run "opentag next" any time to see the next setup step.
`);

  if (args["open-slack"]) openUrl(SLACK_MANIFEST_URL);
}

async function launchSetupUi(args) {
  const url = await setupUrl(args);
  const configPath = await setupConfigPath(args);
  const match = await setupMatchesConfig(url, configPath);
  if (!match.reachable) {
    console.log("Starting OpenTag daemon...");
    await runDaemon({ ...args, _: ["daemon", "start"] });
    await waitForSetup(url, configPath, 4000);
  } else if (!match.matches) {
    throw new Error(`OpenTag setup UI at ${url} is already running with a different config: ${match.configPath || "unknown"}. Stop that daemon or use a different admin port.`);
  }
  await openSetupUi(args);
}

async function openSetupUi(args) {
  const url = await setupUrl(args);
  const configPath = await setupConfigPath(args);
  console.log(`OpenTag setup UI: ${url}`);
  const match = await setupMatchesConfig(url, configPath);
  if (!match.reachable) console.log("If the page does not load yet, run: opentag setup launch");
  else if (!match.matches) console.log(`Warning: setup UI is using a different config: ${match.configPath || "unknown"}`);
  if (!args["no-open"] && !args.print) openUrl(url);
}

async function printSetupUrl(args) {
  console.log(await setupUrl(args));
}

async function setupUrl(args) {
  const configPath = await setupConfigPath(args);
  if (!(await pathExists(configPath))) return "http://127.0.0.1:8787/setup";
  const config = await loadConfig(configPath);
  const host = ["0.0.0.0", "::"].includes(config.admin?.host) ? "127.0.0.1" : config.admin?.host || "127.0.0.1";
  const port = Number(process.env.OPENTAG_ADMIN_PORT ?? config.admin?.port ?? 8787);
  return `http://${host}:${port}/setup`;
}

async function setupConfigPath(args) {
  const configPath = path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath()));
  return configPath;
}

async function setupMatchesConfig(url, configPath) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(url.replace(/\/setup$/, "/v1/setup/identity"), { signal: controller.signal });
    if (response.status >= 500) return { reachable: false, matches: false, configPath: null };
    if (!response.ok) return { reachable: true, matches: false, configPath: null };
    const state = await response.json();
    const runningConfigPath = state.configPath ? path.resolve(state.configPath) : null;
    return {
      reachable: true,
      matches: runningConfigPath === path.resolve(configPath),
      configPath: runningConfigPath
    };
  } catch {
    return { reachable: false, matches: false, configPath: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForSetup(url, configPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { reachable: false, matches: false, configPath: null };
  while (Date.now() < deadline) {
    last = await setupMatchesConfig(url, configPath);
    if (last.reachable && last.matches) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return last;
}

async function detectRuntime() {
  for (const runtime of ["codex", "opencode", "openclaw", "hermes", "claude"]) {
    if (await commandExists(runtime)) return runtime === "claude" ? "claude-code" : runtime;
  }
  return "mock";
}

async function upsertProject(project) {
  const projects = await readJson(projectsPath(), { current: null, items: [] });
  projects.items = projects.items.filter((item) => item.path !== project.path);
  projects.items.push({ ...project, updatedAt: new Date().toISOString() });
  projects.current = project.path;
  await writeJson(projectsPath(), projects);
}

function localEnvExample(config) {
  return `# Copy this file to ${envPath()} and fill values from your Slack app.
# OpenTag automatically loads ${envPath()} before running CLI, daemon, Slack, Admin, and MCP commands.

${config.slack.botTokenEnv}=xoxb-your-bot-token
${config.slack.appTokenEnv}=xapp-your-app-level-token
${config.slack.signingSecretEnv}=your-signing-secret

# Optional: enables Slack native workspace search with user scope search:read.
${config.workspaceSearch.userTokenEnv}=xoxp-your-user-token

# Optional: protect the local Admin API when you expose it outside localhost.
${config.admin.tokenEnv}=change-me
`;
}
