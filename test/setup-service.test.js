import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { RuntimeRegistry } from "../src/core/RuntimeRegistry.js";
import { loadConfig } from "../src/config/loadConfig.js";
import { scanLocalAgents } from "../src/setup/AgentScanner.js";
import { SetupService } from "../src/setup/SetupService.js";
import { createLocalConfig } from "../src/v01/lib/configTemplate.mjs";
import { createLogger } from "../src/utils/logger.js";

test("scanLocalAgents always exposes the built-in mock runtime", async () => {
  const agents = await scanLocalAgents();
  assert.ok(agents.some((agent) => agent.runtimeId === "mock" && agent.installed === true && agent.version === "built-in"));
});

test("SetupService persists selected runtime into local config", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-setup-"));
  try {
    const configPath = path.join(dir, "config.json");
    const localConfig = createLocalConfig({ projectDir: dir, runtime: "mock", appName: "OpenTag Test" });
    await writeFile(configPath, `${JSON.stringify(localConfig, null, 2)}\n`, "utf8");
    const config = await loadConfig(configPath);
    const logger = createLogger({ level: "silent" });
    const runtimeRegistry = new RuntimeRegistry({ config: config.runtimes, logger });
    const service = new SetupService({ config, runtimeRegistry, logger });

    const state = await service.selectRuntime("codex");
    assert.equal(state.selectedRuntime, "codex");

    const persisted = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(persisted.runtimes.default, "codex");
    assert.equal(persisted.workspaces[0].channels[0].defaultRuntime, "codex");
    assert.ok(persisted.workspaces[0].channels[0].allowedRuntimes.includes("codex"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SetupService saves Slack tokens to local env without returning secret values", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opentag-setup-env-"));
  const oldHome = process.env.OPENTAG_HOME;
  const envNames = {
    bot: "OPENTAG_TEST_SLACK_BOT_TOKEN",
    app: "OPENTAG_TEST_SLACK_APP_TOKEN",
    signing: "OPENTAG_TEST_SLACK_SIGNING_SECRET"
  };
  process.env.OPENTAG_HOME = path.join(dir, "home");
  for (const key of Object.values(envNames)) delete process.env[key];
  try {
    const configPath = path.join(dir, "config.json");
    const localConfig = createLocalConfig({ projectDir: dir, runtime: "mock", appName: "OpenTag Test" });
    localConfig.slack.botTokenEnv = envNames.bot;
    localConfig.slack.appTokenEnv = envNames.app;
    localConfig.slack.signingSecretEnv = envNames.signing;
    await writeFile(configPath, `${JSON.stringify(localConfig, null, 2)}\n`, "utf8");
    const config = await loadConfig(configPath);
    const logger = createLogger({ level: "silent" });
    const runtimeRegistry = new RuntimeRegistry({ config: config.runtimes, logger });
    const service = new SetupService({ config, runtimeRegistry, logger });

    const state = await service.saveSlackTokens({
      botToken: "xoxb-test-token",
      appToken: "xapp-test-token",
      signingSecret: "signing-secret-test"
    });

    assert.equal(state.slack.hasBotToken, true);
    assert.equal(state.slack.hasAppToken, true);
    assert.equal(state.slack.hasSigningSecret, true);
    assert.equal(JSON.stringify(state).includes("xoxb-test-token"), false);
    const diagnostics = await service.diagnostics();
    assert.equal(diagnostics.checks.find((item) => item.name === "slack:bot-token").pass, true);
    assert.equal(diagnostics.checks.find((item) => item.name === "slack:app-token").pass, true);
    assert.equal(diagnostics.checks.find((item) => item.name === "slack:signing-secret").pass, true);
    const envContent = await readFile(path.join(process.env.OPENTAG_HOME, ".env"), "utf8");
    assert.match(envContent, new RegExp(`${envNames.bot}=xoxb-test-token`));
    assert.match(envContent, new RegExp(`${envNames.app}=xapp-test-token`));
    assert.match(envContent, new RegExp(`${envNames.signing}=signing-secret-test`));
  } finally {
    if (oldHome === undefined) delete process.env.OPENTAG_HOME;
    else process.env.OPENTAG_HOME = oldHome;
    for (const key of Object.values(envNames)) delete process.env[key];
    await rm(dir, { recursive: true, force: true });
  }
});
