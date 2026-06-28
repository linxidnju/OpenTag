import path from "node:path";
import { createLocalConfig, normalizeRuntimeId } from "../lib/configTemplate.mjs";
import { commandExists, openUrl } from "../lib/commands.mjs";
import { ensureDir, readJson, writeJson, writeText } from "../lib/fs.mjs";
import { defaultConfigPath, envExamplePath, envPath, expandHome, homeDir, manifestPath, projectBindingPath, projectsPath } from "../lib/paths.mjs";
import { slackManifest, SLACK_MANIFEST_URL } from "../templates/slackManifest.mjs";

export async function runSetup(args) {
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
  await writeText(envExamplePath(), localEnvExample(config));
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

  console.log(`OpenTag v0.1 local setup complete.

Config:   ${configPath}
Manifest: ${manifestPath()}
Env:      ${envPath()}
Project:  ${projectBindingPath(projectDir)}
Runtime:  ${runtime}

Next:
  1. Import the Slack manifest from ${manifestPath()}
  2. Copy ${envExamplePath()} to ${envPath()} and fill Slack tokens
  3. Run: opentag doctor --strict
  4. Run: opentag daemon start
`);

  if (args["open-slack"]) openUrl(SLACK_MANIFEST_URL);
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
