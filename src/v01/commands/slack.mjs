import path from "node:path";
import { loadConfig } from "../../config/loadConfig.js";
import { runCommand, openUrl } from "../lib/commands.mjs";
import { defaultConfigPath, expandHome, manifestPath } from "../lib/paths.mjs";
import { writeText } from "../lib/fs.mjs";
import { slackManifest, SLACK_MANIFEST_URL, REQUIRED_SCOPES, REQUIRED_USER_SCOPES } from "../templates/slackManifest.mjs";

export async function runSlack(args) {
  const action = args._[1] || "manifest";
  if (action === "manifest") return writeManifest(args);
  if (action === "open" || action === "open-manifest") {
    openUrl(SLACK_MANIFEST_URL);
    console.log(`Opened ${SLACK_MANIFEST_URL}`);
    return;
  }
  if (action === "scopes") {
    console.log("bot scopes:");
    for (const scope of REQUIRED_SCOPES) console.log(scope);
    console.log("user scopes:");
    for (const scope of REQUIRED_USER_SCOPES) console.log(scope);
    return;
  }
  if (action === "test" || action === "verify") return testSlack(args);
  throw new Error(`Unknown slack action: ${action}`);
}

async function writeManifest(args) {
  const output = args.write || args.o;
  const content = slackManifest({ appName: args.name || "OpenTag", slashCommand: args.command || "/opentag" });
  if (output) {
    const filePath = path.resolve(expandHome(output));
    await writeText(filePath, content);
    console.log(`Wrote Slack manifest: ${filePath}`);
    return;
  }
  if (args.default) {
    await writeText(manifestPath(), content);
    console.log(`Wrote Slack manifest: ${manifestPath()}`);
    return;
  }
  process.stdout.write(content);
}

async function testSlack(args) {
  const configPath = path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath()));
  const config = await loadConfig(configPath);
  const botToken = process.env[config.slack.botTokenEnv];
  const appToken = process.env[config.slack.appTokenEnv];
  if (!botToken) throw new Error(`Missing ${config.slack.botTokenEnv}`);
  if (isPlaceholder(botToken)) throw new Error(`${config.slack.botTokenEnv} still contains the setup placeholder. Fill ${config.slack.botTokenEnv}=xoxb-... in ~/.opentag/.env`);
  if (config.slack.mode === "socket" && !appToken) throw new Error(`Missing ${config.slack.appTokenEnv}`);
  if (config.slack.mode === "socket" && isPlaceholder(appToken)) throw new Error(`${config.slack.appTokenEnv} still contains the setup placeholder. Fill ${config.slack.appTokenEnv}=xapp-... in ~/.opentag/.env`);
  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { authorization: `Bearer ${botToken}`, "content-type": "application/x-www-form-urlencoded" }
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`Slack auth.test failed: ${body.error || "unknown_error"}`);
  console.log(`Slack auth ok: team=${body.team_id} bot=${body.user_id}`);
}

function isPlaceholder(value) {
  return /your-|change-me|placeholder|^xoxb-your|^xapp-your/i.test(String(value || ""));
}
