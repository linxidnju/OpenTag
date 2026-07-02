import { spawn } from "node:child_process";

const AGENTS = [
  { id: "codex", name: "Codex", command: "codex", versionArgs: ["--version"], runtimeId: "codex" },
  { id: "claude-code", name: "Claude Code", command: "claude", versionArgs: ["--version"], runtimeId: "claude-code" },
  { id: "opencode", name: "OpenCode", command: "opencode", versionArgs: ["--version"], runtimeId: "opencode" },
  { id: "openclaw", name: "OpenClaw", command: "openclaw", versionArgs: ["--version"], runtimeId: "openclaw" },
  { id: "hermes", name: "Hermes", command: "hermes", versionArgs: ["--version"], runtimeId: "hermes" },
  { id: "docker", name: "Docker", command: "docker", versionArgs: ["--version"], runtimeId: "docker" },
  { id: "mock", name: "Mock Runtime", command: null, versionArgs: [], runtimeId: "mock", alwaysAvailable: true }
];

export async function scanLocalAgents() {
  const agents = [];
  for (const agent of AGENTS) {
    if (agent.alwaysAvailable) {
      agents.push({ ...publicAgent(agent), installed: true, path: null, version: "built-in" });
      continue;
    }
    const found = await commandPath(agent.command);
    const version = found ? await commandVersion(agent.command, agent.versionArgs) : null;
    agents.push({ ...publicAgent(agent), installed: Boolean(found), path: found, version });
  }
  return agents;
}

export function knownAgentRuntimeIds() {
  return AGENTS.map((agent) => agent.runtimeId);
}

function publicAgent(agent) {
  return { id: agent.id, name: agent.name, command: agent.command, runtimeId: agent.runtimeId };
}

function commandPath(command) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${shellQuote(command)}`], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? stdout.trim().split(/\r?\n/)[0] || null : null));
  });
}

function commandVersion(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(output.trim().split(/\r?\n/)[0]?.slice(0, 160) || null));
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
