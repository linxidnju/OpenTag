import { main as legacyMain } from "../cli.js";
import { runSetup } from "./commands/setup.mjs";
import { runDoctor } from "./commands/doctor.mjs";
import { runDaemon } from "./commands/daemon.mjs";
import { runSlack } from "./commands/slack.mjs";
import { runProject } from "./commands/project.mjs";
import { runRuntime } from "./commands/runtime.mjs";
import { runNext } from "./commands/next.mjs";
import { parseArgs } from "./lib/args.mjs";
import { defaultConfigPath } from "./lib/paths.mjs";
import { loadLocalEnv } from "./lib/env.mjs";

export async function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0] || "help";
  await loadLocalEnv();

  if (command === "help" || args.help || args.h) {
    printHelp();
    return;
  }

  if (command === "setup" || command === "init") return runSetup(args);
  if (command === "doctor") return runDoctor(args);
  if (command === "next") return runNext(args);
  if (command === "daemon") return runDaemon(args);
  if (command === "slack") return runSlack(args);
  if (command === "project") return runProject(args);
  if (command === "runtime") return runRuntime(args);

  const configPath = args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath();
  const forwarded = [...argv];
  if (!argv.includes("--config") && !argv.includes("-c") && !process.env.OPENTAG_CONFIG) {
    forwarded.push("--config", configPath);
  }
  return legacyMain(forwarded);
}

function printHelp() {
  console.log(`OpenTag v0.1

Usage:
  opentag init --project . --runtime codex [--open-slack]
  opentag next
  opentag doctor [--strict] [--offline] [--json]
  opentag daemon start|stop|restart|status|logs|install|uninstall
  opentag slack manifest [--write path]
  opentag slack open|test|scopes
  opentag project add|list|use|bind|remove|allow-root [path]
  opentag runtime list|set [runtime_id]

Existing MVP commands still work:
  opentag start|run|sessions|approvals|audit|runs|artifacts|cancel|admin|mcp
`);
}
