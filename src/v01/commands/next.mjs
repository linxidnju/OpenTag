import path from "node:path";
import { loadConfig } from "../../config/loadConfig.js";
import { defaultConfigPath, envPath, expandHome, manifestPath } from "../lib/paths.mjs";
import { pathExists } from "../lib/fs.mjs";

export async function runNext(args) {
  const configPath = path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath()));
  const actions = [];

  if (!(await pathExists(configPath))) {
    actions.push("Run: opentag init --project . --runtime mock");
    return print(actions);
  }

  let config = null;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    actions.push(`Fix config parse error in ${configPath}: ${error.message}`);
    return print(actions);
  }

  if (!(await pathExists(manifestPath()))) actions.push("Run: opentag slack manifest");
  if (!(await pathExists(envPath()))) actions.push(`Create ${envPath()} with Slack tokens.`);

  const missingSlack = [];
  for (const envName of [config.slack?.botTokenEnv, config.slack?.appTokenEnv].filter(Boolean)) {
    const value = process.env[envName];
    if (!value || isPlaceholder(value)) missingSlack.push(envName);
  }
  if (missingSlack.length) {
    actions.push(`Fill ${missingSlack.join(", ")} in ${envPath()}.`);
    actions.push("Run: opentag doctor --strict");
  } else {
    actions.push("Run: opentag doctor --strict");
    actions.push("Run: opentag daemon start");
  }

  print(actions);
}

function print(actions) {
  console.log("OpenTag next steps:");
  for (const action of [...new Set(actions)]) console.log(`- ${action}`);
}

function isPlaceholder(value) {
  return /your-|change-me|placeholder|^xoxb-your|^xapp-your/i.test(String(value || ""));
}
