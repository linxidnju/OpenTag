import path from "node:path";
import { loadConfig } from "../../config/loadConfig.js";
import { commandExists } from "../lib/commands.mjs";
import { writeJson } from "../lib/fs.mjs";
import { defaultConfigPath, expandHome } from "../lib/paths.mjs";
import { normalizeRuntimeId } from "../lib/configTemplate.mjs";

export async function runRuntime(args) {
  const action = args._[1] || "list";
  if (action === "list") return listRuntimes(args);
  if (action === "set") return setRuntime(args);
  throw new Error(`Unknown runtime action: ${action}`);
}

async function listRuntimes(args) {
  const configPath = path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath()));
  const config = await loadConfig(configPath);
  for (const [id, spec] of Object.entries(config.runtimes.adapters || {})) {
    const command = spec.command || defaultCommandFor(spec.type);
    const installed = spec.type === "mock" || spec.type === "http" ? true : await commandExists(command);
    const marker = id === config.runtimes.default ? "*" : " ";
    console.log(`${marker} ${id.padEnd(18)} ${spec.type.padEnd(12)} ${installed ? "available" : "missing"} ${command || ""}`);
  }
}

async function setRuntime(args) {
  const runtimeId = normalizeRuntimeId(args._[2] || args.runtime || args.r);
  if (!runtimeId) throw new Error("Usage: opentag runtime set <runtime_id>");
  const configPath = path.resolve(expandHome(args.config || args.c || process.env.OPENTAG_CONFIG || defaultConfigPath()));
  const config = await loadConfig(configPath);
  if (!config.runtimes.adapters[runtimeId]) throw new Error(`Unknown runtime: ${runtimeId}`);
  config.runtimes.default = runtimeId;
  for (const workspace of config.workspaces || []) {
    for (const channel of workspace.channels || []) {
      channel.defaultRuntime = runtimeId;
      if (!channel.allowedRuntimes?.includes(runtimeId)) channel.allowedRuntimes = [...(channel.allowedRuntimes || []), runtimeId];
    }
  }
  delete config.__configPath;
  delete config.__configDir;
  await writeJson(configPath, config);
  console.log(`Default runtime set to ${runtimeId}`);
}

function defaultCommandFor(type) {
  if (type === "claude-code") return "claude";
  if (type === "codex") return "codex";
  if (type === "opencode") return "opencode";
  if (type === "docker") return "docker";
  return "";
}
